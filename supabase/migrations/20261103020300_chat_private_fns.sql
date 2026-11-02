-- Players chat (stage C2, spec §7): private messages and blocks. Only players with profiles message each other; a
-- block either way stops messages (even in an existing conversation) and join requests both ways; muted players
-- can't send; the photo checks, filter and rate limits are the room's. The unread count runs under the caller's own
-- row rules, so the browser can ask for it.

-- Has either of these two players blocked the other?
create function private.is_blocked(p_organization_id uuid, p_a uuid, p_b uuid)
returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.chat_blocks b
    where b.organization_id = p_organization_id
      and ((b.blocker_profile_id = p_a and b.blocked_profile_id = p_b) or (b.blocker_profile_id = p_b and b.blocked_profile_id = p_a))
  )
$$;

create function public.post_private_message(p_organization_id uuid, p_user_id uuid, p_to_profile_id uuid, p_body text, p_photo_path text default null)
returns table (status text, message_id uuid, conversation_id uuid)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_sender record;
  v_body text := nullif(btrim(coalesce(p_body, ''), E' \t\r\n'), '');
  v_refusal text;
  v_conversation uuid;
  v_id uuid;
begin
  select * into v_sender from private.chat_author(p_organization_id, p_user_id) limit 1;
  if not found or v_sender.kind = 'team' then
    return query select 'no_profile'::text, null::uuid, null::uuid;
    return;
  end if;
  if p_to_profile_id is null or p_to_profile_id = v_sender.profile_id or not exists (
    select 1 from public.player_profiles p
    where p.id = p_to_profile_id and p.organization_id = p_organization_id
      and not exists (select 1 from public.organization_members m where m.organization_id = p_organization_id and m.user_id = p.user_id)
  ) then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;
  if private.is_blocked(p_organization_id, v_sender.profile_id, p_to_profile_id) then
    return query select 'blocked'::text, null::uuid, null::uuid;
    return;
  end if;
  if private.chat_is_muted(p_organization_id, v_sender.profile_id) then
    return query select 'muted'::text, null::uuid, null::uuid;
    return;
  end if;
  if (v_body is null and p_photo_path is null) or (v_body is not null and char_length(v_body) > 500) then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;
  if p_photo_path is not null then
    v_refusal := private.chat_photo_check(p_user_id, p_photo_path);
    if v_refusal is not null then
      return query select v_refusal, null::uuid, null::uuid;
      return;
    end if;
  end if;
  v_refusal := private.chat_guard(p_organization_id, p_user_id, v_sender.profile_id);
  if v_refusal is not null then
    return query select v_refusal, null::uuid, null::uuid;
    return;
  end if;

  insert into public.chat_conversations as c (organization_id, profile_low, profile_high)
  values (p_organization_id, least(v_sender.profile_id, p_to_profile_id), greatest(v_sender.profile_id, p_to_profile_id))
  on conflict (organization_id, profile_low, profile_high) do update set last_message_at = now()
  returning c.id into v_conversation;
  insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, body, photo_path, conversation_id)
  values (p_organization_id, p_user_id, v_sender.profile_id, 'player', v_sender.name, v_body, p_photo_path, v_conversation)
  returning id into v_id;
  -- The sender has read everything up to their own message.
  insert into public.chat_conversation_reads as r (conversation_id, organization_id, profile_id, read_at)
  values (v_conversation, p_organization_id, v_sender.profile_id, now())
  on conflict (conversation_id, profile_id) do update set read_at = excluded.read_at;
  return query select 'posted'::text, v_id, v_conversation;
end;
$$;

create function public.block_chat_player(p_organization_id uuid, p_user_id uuid, p_profile_id uuid)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_me record;
begin
  select * into v_me from private.chat_author(p_organization_id, p_user_id) limit 1;
  if not found or v_me.kind = 'team' then
    return 'no_profile';
  end if;
  if p_profile_id = v_me.profile_id
     or not exists (select 1 from public.player_profiles p where p.id = p_profile_id and p.organization_id = p_organization_id) then
    return 'not_found';
  end if;
  insert into public.chat_blocks (organization_id, blocker_profile_id, blocked_profile_id)
  values (p_organization_id, v_me.profile_id, p_profile_id)
  on conflict (blocker_profile_id, blocked_profile_id) do nothing;
  return 'blocked';
end;
$$;

create function public.unblock_chat_player(p_organization_id uuid, p_user_id uuid, p_profile_id uuid)
returns text
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.chat_blocks b
  using public.player_profiles me
  where me.organization_id = p_organization_id and me.user_id = p_user_id
    and b.blocker_profile_id = me.id and b.blocked_profile_id = p_profile_id;
  return case when found then 'unblocked' else 'not_found' end;
end;
$$;

-- Unread private messages for the signed-in player (the Chat link's number). Runs under their own row rules.
create function public.chat_private_unread(p_organization_id uuid)
returns int
language sql stable security invoker set search_path = '' as $$
  select count(*)::int
  from public.chat_messages m
  join public.chat_conversations c on c.id = m.conversation_id
  join public.player_profiles me
    on me.organization_id = c.organization_id and me.user_id = (select auth.uid()) and me.id in (c.profile_low, c.profile_high)
  left join public.chat_conversation_reads r on r.conversation_id = c.id and r.profile_id = me.id
  where c.organization_id = p_organization_id
    and m.state = 'visible'
    and m.author_profile_id is distinct from me.id
    and (r.read_at is null or m.created_at > r.read_at)
$$;

-- As before (a hidden card takes no requests; the poster hears at most once an hour), and blocked players can't ask
-- to join each other's games.
create or replace function public.request_to_join(p_card_id uuid, p_user_id uuid)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_card public.chat_cards;
  v_profile record;
  v_previous public.chat_join_status;
  v_asked boolean;
begin
  select * into v_card from public.chat_cards where id = p_card_id;
  if not found then
    return 'not_found';
  end if;
  select p.id, p.display_name into v_profile
  from public.player_profiles p
  where p.organization_id = v_card.organization_id and p.user_id = p_user_id
    and not exists (select 1 from public.organization_members m where m.organization_id = v_card.organization_id and m.user_id = p_user_id);
  if not found then
    return 'no_profile';
  end if;
  if v_card.kind <> 'booking' or v_card.status <> 'open' or v_card.starts_at <= now()
     or exists (select 1 from public.chat_messages msg where msg.card_id = p_card_id and msg.state <> 'visible') then
    return 'not_open';
  end if;
  if v_card.poster_profile_id = v_profile.id then
    return 'own_card';
  end if;
  if private.is_blocked(v_card.organization_id, v_card.poster_profile_id, v_profile.id) then
    return 'blocked';
  end if;
  if private.chat_is_muted(v_card.organization_id, v_profile.id) then
    return 'muted';
  end if;
  select r.status into v_previous from public.chat_join_requests r where r.card_id = p_card_id and r.profile_id = v_profile.id;
  if found and v_previous not in ('withdrawn', 'left') then
    return 'already_asked';
  end if;
  if (select count(*) from public.chat_join_requests r where r.profile_id = v_profile.id and r.status = 'pending') >= 10 then
    return 'too_many_waiting';
  end if;

  insert into public.chat_join_requests as r (organization_id, card_id, profile_id)
  values (v_card.organization_id, p_card_id, v_profile.id)
  on conflict (card_id, profile_id) do update set status = 'pending', created_at = now(), decided_at = null
    where r.status in ('withdrawn', 'left')
  returning true into v_asked;
  if v_asked is null then
    return 'already_asked';
  end if;

  if not exists (
    select 1 from public.notifications n
    where n.profile_id = v_card.poster_profile_id and n.kind = 'chat_join_request'
      and n.payload ->> 'card_id' = p_card_id::text and n.payload ->> 'player_id' = v_profile.id::text
      and n.created_at > now() - interval '1 hour'
  ) then
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    values (v_card.organization_id, v_card.poster_profile_id, 'chat_join_request',
            private.chat_card_payload(v_card) || jsonb_build_object('player_name', v_profile.display_name, 'player_id', v_profile.id),
            '/chat/games/' || v_card.id);
  end if;
  return 'requested';
end;
$$;

-- As before, and a private message can be reported only by the two people in it.
create or replace function public.report_chat_message(p_message_id uuid, p_user_id uuid, p_reason public.chat_report_reason, p_note text)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_message public.chat_messages;
  v_reporter uuid;
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_archived text;
  v_copy text;
begin
  select * into v_message from public.chat_messages where id = p_message_id for update;
  if not found then
    return 'not_found';
  end if;
  select p.id into v_reporter
  from public.player_profiles p
  where p.organization_id = v_message.organization_id and p.user_id = p_user_id
    and not exists (select 1 from public.organization_members m where m.organization_id = v_message.organization_id and m.user_id = p_user_id);
  if not found then
    return 'no_profile';
  end if;
  if v_message.conversation_id is not null and not exists (
    select 1 from public.chat_conversations c where c.id = v_message.conversation_id and v_reporter in (c.profile_low, c.profile_high)
  ) then
    return 'not_found';
  end if;
  if v_message.author_user_id = p_user_id then
    return 'own_message';
  end if;
  if exists (select 1 from public.chat_reports r where r.message_id = p_message_id and r.reporter_profile_id = v_reporter) then
    return 'already_reported';
  end if;
  if (select count(*) from public.chat_reports r where r.reporter_profile_id = v_reporter and r.created_at > now() - interval '24 hours') >= 20 then
    return 'too_many_reports';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    return 'invalid';
  end if;

  select a.body into v_archived from public.chat_message_archive a where a.message_id = p_message_id;
  if v_message.card_id is not null then
    select c.title || coalesce(', ' || coalesce(c.note, v_archived), '') into v_copy from public.chat_cards c where c.id = v_message.card_id;
  else
    v_copy := coalesce(v_message.body, v_archived);
  end if;
  insert into public.chat_reports (organization_id, message_id, reporter_profile_id, reason, note, body_copy, author_name_copy)
  values (v_message.organization_id, p_message_id, v_reporter, p_reason, v_note, v_copy, v_message.author_name);

  if v_message.state = 'visible'
     and (select count(distinct r.reporter_profile_id) from public.chat_reports r where r.message_id = p_message_id and r.status = 'open') >= 3 then
    perform private.archive_message(p_message_id, 'hidden_by_reports');
  end if;
  return 'reported';
end;
$$;

revoke execute on function
  private.is_blocked(uuid, uuid, uuid),
  public.post_private_message(uuid, uuid, uuid, text, text),
  public.block_chat_player(uuid, uuid, uuid),
  public.unblock_chat_player(uuid, uuid, uuid),
  public.chat_private_unread(uuid)
from public, anon, authenticated;

grant execute on function
  private.is_blocked(uuid, uuid, uuid),
  public.post_private_message(uuid, uuid, uuid, text, text),
  public.block_chat_player(uuid, uuid, uuid),
  public.unblock_chat_player(uuid, uuid, uuid),
  public.chat_private_unread(uuid)
to service_role;

-- The unread count is the browser's to ask (it reads only the caller's own rows).
grant execute on function public.chat_private_unread(uuid) to authenticated;
