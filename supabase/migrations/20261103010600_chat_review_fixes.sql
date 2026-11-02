-- Players chat (stage C1): fixes from the final review.
-- 1. Asking, withdrawing and asking again told the poster (bell + email) every time: now once an hour per player and card.
-- 2. A card the poster had closed never told its accepted players when the booking was then cancelled.
-- 3. A card hidden by reports (or removed) kept its note readable through the API, and a hidden card stayed joinable:
--    the note now moves to the archive with the message (dismiss puts it back), and hidden cards take no requests.
-- 4. Once the poster closed a card, an accepted player couldn't drop out (nor the poster take someone off) before the game.

-- 3: a card's note goes to the archive with its message.
create or replace function private.archive_message(p_message_id uuid, p_state public.chat_message_state)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_message public.chat_messages;
begin
  select * into v_message from public.chat_messages where id = p_message_id;
  if not found then
    return;
  end if;
  if v_message.card_id is not null then
    insert into public.chat_message_archive (message_id, organization_id, body)
    select v_message.id, v_message.organization_id, c.note from public.chat_cards c where c.id = v_message.card_id and c.note is not null
    on conflict (message_id) do nothing;
    update public.chat_cards set note = null where id = v_message.card_id;
  elsif v_message.body is not null then
    insert into public.chat_message_archive (message_id, organization_id, body)
    values (v_message.id, v_message.organization_id, v_message.body)
    on conflict (message_id) do nothing;
  end if;
  update public.chat_messages set body = null, state = p_state where id = p_message_id;
end;
$$;

-- 3: a report on a hidden card still copies its note (from the archive).
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

-- 3: dismissing puts a card's note back on the card (its message never has text of its own).
create or replace function public.resolve_chat_reports(p_message_id uuid, p_user_id uuid, p_action text)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_message public.chat_messages;
  v_archived text;
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
    select a.body into v_archived from public.chat_message_archive a where a.message_id = p_message_id;
    if v_message.card_id is not null then
      update public.chat_cards set note = v_archived where id = v_message.card_id;
      update public.chat_messages set state = 'visible' where id = p_message_id;
    else
      update public.chat_messages set body = v_archived, state = 'visible' where id = p_message_id;
    end if;
    delete from public.chat_message_archive where message_id = p_message_id;
  end if;

  update public.chat_reports
  set status = case when p_action = 'remove' then 'removed'::public.chat_report_status else 'dismissed'::public.chat_report_status end,
      resolved_by = p_user_id, resolved_at = now()
  where message_id = p_message_id and status = 'open';
  return 'resolved';
end;
$$;

-- 1 and 3: a hidden card takes no requests; the poster hears about a player's request at most once an hour.
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

-- 2: a closed card (still with accepted players, game not started) is cancelled too when its booking or session is.
create or replace function public.close_due_chat_cards()
returns table (card_id uuid, outcome text)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_due record;
begin
  for v_due in
    select c.id, c.organization_id, (rb.status = 'cancelled' or os.status = 'cancelled') is true as cancelled
    from public.chat_cards c
    left join public.resource_bookings rb on rb.id = c.resource_booking_id
    left join public.open_play_sessions os on os.id = c.session_id
    where (c.status in ('open', 'full') and (c.starts_at <= now() or rb.status = 'cancelled' or os.status = 'cancelled'))
       or (c.status = 'closed' and c.starts_at > now() and (rb.status = 'cancelled' or os.status = 'cancelled')
           and exists (select 1 from public.chat_join_requests r where r.card_id = c.id and r.status = 'accepted'))
    order by c.starts_at
    limit 200
    for update of c skip locked
  loop
    if v_due.cancelled then
      insert into public.notifications (organization_id, profile_id, kind, payload, link)
      select v_due.organization_id, r.profile_id, 'chat_game_cancelled', private.chat_card_payload(c), '/chat/games/' || c.id
      from public.chat_join_requests r
      join public.chat_cards c on c.id = r.card_id
      where r.card_id = v_due.id and r.status in ('accepted', 'pending');
      perform private.close_card(v_due.id, 'cancelled', false);
      card_id := v_due.id;
      outcome := 'cancelled';
    else
      perform private.close_card(v_due.id, 'started', false);
      card_id := v_due.id;
      outcome := 'started';
    end if;
    return next;
  end loop;
end;
$$;

-- 4: dropping out of, or being taken off, a closed card before the game (it stays closed).
create or replace function public.leave_card(p_card_id uuid, p_user_id uuid)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_card public.chat_cards;
  v_profile record;
begin
  select * into v_card from public.chat_cards where id = p_card_id for update;
  if not found then
    return 'not_found';
  end if;
  select p.id, p.display_name into v_profile from public.player_profiles p where p.organization_id = v_card.organization_id and p.user_id = p_user_id;
  if not found then
    return 'not_found';
  end if;
  if v_card.status not in ('open', 'full', 'closed') or v_card.starts_at <= now() then
    return 'not_open';
  end if;
  update public.chat_join_requests set status = 'left', decided_at = now()
  where card_id = p_card_id and profile_id = v_profile.id and status = 'accepted';
  if not found then
    return 'not_found';
  end if;
  update public.chat_cards
  set spots_taken = spots_taken - 1, status = case when status = 'full' then 'open'::public.chat_card_status else status end
  where id = p_card_id
  returning * into v_card;
  insert into public.notifications (organization_id, profile_id, kind, payload, link)
  values (v_card.organization_id, v_card.poster_profile_id, 'chat_join_left',
          private.chat_card_payload(v_card) || jsonb_build_object('player_name', v_profile.display_name), '/chat/games/' || v_card.id);
  return 'left';
end;
$$;

create or replace function public.remove_from_card(p_card_id uuid, p_user_id uuid, p_profile_id uuid)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_card public.chat_cards;
begin
  select * into v_card from public.chat_cards where id = p_card_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_card.poster_user_id <> p_user_id then
    return 'not_yours';
  end if;
  if v_card.status not in ('open', 'full', 'closed') or v_card.starts_at <= now() then
    return 'not_open';
  end if;
  update public.chat_join_requests set status = 'removed', decided_at = now()
  where card_id = p_card_id and profile_id = p_profile_id and status = 'accepted';
  if not found then
    return 'not_found';
  end if;
  update public.chat_cards
  set spots_taken = spots_taken - 1, status = case when status = 'full' then 'open'::public.chat_card_status else status end
  where id = p_card_id
  returning * into v_card;
  insert into public.notifications (organization_id, profile_id, kind, payload, link)
  values (v_card.organization_id, p_profile_id, 'chat_join_declined',
          private.chat_card_payload(v_card) || jsonb_build_object('after_accept', true), '/chat/games/' || v_card.id);
  return 'removed';
end;
$$;
