-- Players chat (stage C1): posting and removing messages, and the helpers the card and moderation functions share.
-- Every function here runs as service_role (the server calls it after checking who is asking) and is security
-- invoker; the browser cannot call any of them.

-- Who is posting: a team member always speaks as the brand (even if they also have a player profile); otherwise
-- their player profile. No row when they are neither.
create function private.chat_author(p_organization_id uuid, p_user_id uuid)
returns table (kind public.chat_author_kind, profile_id uuid, name text)
language sql stable security invoker set search_path = '' as $$
  select 'team'::public.chat_author_kind, null::uuid, o.name
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.organization_id = p_organization_id and m.user_id = p_user_id
  union all
  select 'player'::public.chat_author_kind, p.id, p.display_name
  from public.player_profiles p
  where p.organization_id = p_organization_id and p.user_id = p_user_id
    and not exists (select 1 from public.organization_members m where m.organization_id = p_organization_id and m.user_id = p_user_id)
$$;

-- May this person send something now? Null when yes, else 'muted' or 'too_fast' (1 message every 3 seconds, 30 every
-- 10 minutes; card posts count). The per-person lock makes two quick sends count each other.
create function private.chat_guard(p_organization_id uuid, p_user_id uuid, p_profile_id uuid)
returns text
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('chat:' || p_user_id::text));
  if p_profile_id is not null and exists (
    select 1 from public.chat_mutes mu
    where mu.organization_id = p_organization_id and mu.profile_id = p_profile_id and (mu.until is null or mu.until > now())
  ) then
    return 'muted';
  end if;
  if exists (select 1 from public.chat_messages c where c.author_user_id = p_user_id and c.created_at > now() - interval '3 seconds')
     or (select count(*) from public.chat_messages c where c.author_user_id = p_user_id and c.created_at > now() - interval '10 minutes') >= 30 then
    return 'too_fast';
  end if;
  return null;
end;
$$;

-- What every card notification carries (ids, names and times only; the words come from the app).
create function private.chat_card_payload(p_card public.chat_cards)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'card_id', p_card.id, 'poster_name', p_card.poster_name, 'resource_name', p_card.title,
    'section_name', p_card.section_name, 'starts_at', p_card.starts_at, 'ends_at', p_card.ends_at
  )
$$;

-- Takes a message's text out of the room: the text moves to the team-only archive (an existing copy is kept).
create function private.archive_message(p_message_id uuid, p_state public.chat_message_state)
returns void
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.chat_message_archive (message_id, organization_id, body)
  select m.id, m.organization_id, m.body from public.chat_messages m where m.id = p_message_id and m.body is not null
  on conflict (message_id) do nothing;
  update public.chat_messages set body = null, state = p_state where id = p_message_id;
end;
$$;

-- Moves a card to `p_status`. Pending requests expire; with `p_notify` each of those players hears the card closed
-- ('full' or 'closed'). 'full' is not final (someone leaving reopens it), so it doesn't set closed_at.
create function private.close_card(p_card_id uuid, p_status public.chat_card_status, p_notify boolean)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_card public.chat_cards;
begin
  update public.chat_cards
  set status = p_status,
      closed_at = case when p_status in ('closed', 'cancelled', 'started') then coalesce(closed_at, now()) else closed_at end
  where id = p_card_id
  returning * into v_card;
  if not found then
    return;
  end if;
  with expired as (
    update public.chat_join_requests set status = 'expired', decided_at = now()
    where card_id = p_card_id and status = 'pending'
    returning profile_id
  )
  insert into public.notifications (organization_id, profile_id, kind, payload, link)
  select v_card.organization_id, e.profile_id, 'chat_card_closed',
         private.chat_card_payload(v_card) || jsonb_build_object('reason', case when p_status = 'full' then 'full' else 'closed' end),
         '/chat/games/' || v_card.id
  from expired e
  where p_notify;
end;
$$;

-- A message in the room. The text arrives already filtered for bad words; it is trimmed and must be 1–500 characters.
create function public.post_chat_message(p_organization_id uuid, p_user_id uuid, p_body text)
returns table (status text, message_id uuid)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_author record;
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_refusal text;
  v_id uuid;
begin
  select * into v_author from private.chat_author(p_organization_id, p_user_id) limit 1;
  if not found then
    return query select 'no_profile'::text, null::uuid;
    return;
  end if;
  if char_length(v_body) not between 1 and 500 then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  v_refusal := private.chat_guard(p_organization_id, p_user_id, v_author.profile_id);
  if v_refusal is not null then
    return query select v_refusal, null::uuid;
    return;
  end if;
  insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, body)
  values (p_organization_id, p_user_id, v_author.profile_id, v_author.kind, v_author.name, v_body)
  returning id into v_id;
  return query select 'posted'::text, v_id;
end;
$$;

-- Removes a message. The author removes their own plain message; a card's message is closed through the card
-- instead. The venue (any team member) removes anything, and removing a card's message closes the card.
create function public.remove_chat_message(p_message_id uuid, p_user_id uuid, p_by_venue boolean)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_message public.chat_messages;
begin
  select * into v_message from public.chat_messages where id = p_message_id for update;
  if not found then
    return 'not_found';
  end if;

  if p_by_venue then
    if not exists (select 1 from public.organization_members m where m.organization_id = v_message.organization_id and m.user_id = p_user_id) then
      return 'not_allowed';
    end if;
    if v_message.state <> 'removed_by_venue' then
      perform private.archive_message(v_message.id, 'removed_by_venue');
    end if;
    if v_message.card_id is not null and exists (select 1 from public.chat_cards c where c.id = v_message.card_id and c.status in ('open', 'full')) then
      perform private.close_card(v_message.card_id, 'closed', true);
    end if;
    return 'removed';
  end if;

  if v_message.author_user_id <> p_user_id or v_message.card_id is not null then
    return 'not_allowed';
  end if;
  if v_message.state not in ('removed_by_author', 'removed_by_venue') then
    perform private.archive_message(v_message.id, 'removed_by_author');
  end if;
  return 'removed';
end;
$$;

revoke execute on function
  private.chat_author(uuid, uuid),
  private.chat_guard(uuid, uuid, uuid),
  private.chat_card_payload(public.chat_cards),
  private.archive_message(uuid, public.chat_message_state),
  private.close_card(uuid, public.chat_card_status, boolean),
  public.post_chat_message(uuid, uuid, text),
  public.remove_chat_message(uuid, uuid, boolean)
from public, anon, authenticated;

grant execute on function
  private.chat_author(uuid, uuid),
  private.chat_guard(uuid, uuid, uuid),
  private.chat_card_payload(public.chat_cards),
  private.archive_message(uuid, public.chat_message_state),
  private.close_card(uuid, public.chat_card_status, boolean),
  public.post_chat_message(uuid, uuid, text),
  public.remove_chat_message(uuid, uuid, boolean)
to service_role;
