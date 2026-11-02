-- Players chat (stage C1): reports, mutes and the venue's own word list (spec §3, §4, §6, §9).

-- A player reports a message (or a card, through its message). The report keeps its own copy of what was said, and
-- when 3 different players have open reports on a visible message it is hidden at once until the team decides.
create function public.report_chat_message(p_message_id uuid, p_user_id uuid, p_reason public.chat_report_reason, p_note text)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_message public.chat_messages;
  v_reporter uuid;
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_copy text;
begin
  -- Locked, so reports arriving together count each other before deciding to hide.
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

  if v_message.card_id is not null then
    select c.title || coalesce(', ' || c.note, '') into v_copy from public.chat_cards c where c.id = v_message.card_id;
  else
    v_copy := coalesce(v_message.body, (select a.body from public.chat_message_archive a where a.message_id = p_message_id));
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

-- The team acts on a message's open reports: 'remove' takes it down (a card's message also closes the card) or
-- 'dismiss' keeps it (a message hidden by reports comes back).
create function public.resolve_chat_reports(p_message_id uuid, p_user_id uuid, p_action text)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_message public.chat_messages;
begin
  select * into v_message from public.chat_messages where id = p_message_id for update;
  if not found then
    return 'not_found';
  end if;
  if not exists (select 1 from public.organization_members m where m.organization_id = v_message.organization_id and m.user_id = p_user_id) then
    return 'not_allowed';
  end if;
  if p_action not in ('remove', 'dismiss') then
    return 'invalid';
  end if;
  if not exists (select 1 from public.chat_reports r where r.message_id = p_message_id and r.status = 'open') then
    return 'nothing_open';
  end if;

  if p_action = 'remove' then
    if v_message.state <> 'removed_by_venue' then
      perform private.archive_message(p_message_id, 'removed_by_venue');
    end if;
    if v_message.card_id is not null and exists (select 1 from public.chat_cards c where c.id = v_message.card_id and c.status in ('open', 'full')) then
      perform private.close_card(v_message.card_id, 'closed', true);
    end if;
  elsif v_message.state = 'hidden_by_reports' then
    update public.chat_messages m
    set body = (select a.body from public.chat_message_archive a where a.message_id = p_message_id), state = 'visible'
    where m.id = p_message_id;
    delete from public.chat_message_archive where message_id = p_message_id;
  end if;

  update public.chat_reports
  set status = case when p_action = 'remove' then 'removed'::public.chat_report_status else 'dismissed'::public.chat_report_status end,
      resolved_by = p_user_id, resolved_at = now()
  where message_id = p_message_id and status = 'open';
  return 'resolved';
end;
$$;

-- The team mutes a player for 1 day, 7 days or (null) until unmuted. Muting again replaces the old mute.
create function public.mute_chat_player(p_organization_id uuid, p_user_id uuid, p_profile_id uuid, p_days int)
returns text
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.organization_members m where m.organization_id = p_organization_id and m.user_id = p_user_id) then
    return 'not_allowed';
  end if;
  if p_days is not null and p_days not in (1, 7) then
    return 'invalid';
  end if;
  if not exists (select 1 from public.player_profiles p where p.id = p_profile_id and p.organization_id = p_organization_id) then
    return 'not_found';
  end if;
  insert into public.chat_mutes (organization_id, profile_id, until, muted_by)
  values (p_organization_id, p_profile_id, case when p_days is null then null else now() + p_days * interval '1 day' end, p_user_id)
  on conflict (organization_id, profile_id) do update set until = excluded.until, muted_by = excluded.muted_by, created_at = now();
  return 'muted';
end;
$$;

create function public.unmute_chat_player(p_organization_id uuid, p_user_id uuid, p_profile_id uuid)
returns text
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.organization_members m where m.organization_id = p_organization_id and m.user_id = p_user_id) then
    return 'not_allowed';
  end if;
  delete from public.chat_mutes where organization_id = p_organization_id and profile_id = p_profile_id;
  return case when found then 'unmuted' else 'not_found' end;
end;
$$;

-- The venue's own words for the filter (up to 500; lower-case, single spaces, 2–40 characters).
create function public.set_chat_blocked_word(p_organization_id uuid, p_user_id uuid, p_word text, p_add boolean)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_word text := lower(regexp_replace(btrim(coalesce(p_word, '')), '\s+', ' ', 'g'));
begin
  if not exists (select 1 from public.organization_members m where m.organization_id = p_organization_id and m.user_id = p_user_id) then
    return 'not_allowed';
  end if;
  if char_length(v_word) not between 2 and 40 then
    return 'invalid';
  end if;
  if not p_add then
    delete from public.chat_blocked_words where organization_id = p_organization_id and word = v_word;
    return case when found then 'removed' else 'not_found' end;
  end if;
  if exists (select 1 from public.chat_blocked_words w where w.organization_id = p_organization_id and w.word = v_word) then
    return 'exists';
  end if;
  if (select count(*) from public.chat_blocked_words w where w.organization_id = p_organization_id) >= 500 then
    return 'too_many_words';
  end if;
  insert into public.chat_blocked_words (organization_id, word) values (p_organization_id, v_word);
  return 'added';
end;
$$;

revoke execute on function
  public.report_chat_message(uuid, uuid, public.chat_report_reason, text),
  public.resolve_chat_reports(uuid, uuid, text),
  public.mute_chat_player(uuid, uuid, uuid, int),
  public.unmute_chat_player(uuid, uuid, uuid),
  public.set_chat_blocked_word(uuid, uuid, text, boolean)
from public, anon, authenticated;

grant execute on function
  public.report_chat_message(uuid, uuid, public.chat_report_reason, text),
  public.resolve_chat_reports(uuid, uuid, text),
  public.mute_chat_player(uuid, uuid, uuid, int),
  public.unmute_chat_player(uuid, uuid, uuid),
  public.set_chat_blocked_word(uuid, uuid, text, boolean)
to service_role;
