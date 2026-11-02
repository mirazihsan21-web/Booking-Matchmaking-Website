-- Players chat (stage C1): "Need players" cards and join requests (spec §2.2–2.3, §9, §10.3, §10.5).
-- Booking cards: the poster's own upcoming confirmed booking, spots 1..min(20, capacity − 1), one active card per
-- booking, 3 open per player; I'm in → the poster accepts or declines; Accept never goes past the spots (the card row
-- is locked). Session cards: the team, or a player who asked for a seat; no requests (seats come from the session page).

create function private.chat_is_muted(p_organization_id uuid, p_profile_id uuid)
returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.chat_mutes mu
    where mu.organization_id = p_organization_id and mu.profile_id = p_profile_id and (mu.until is null or mu.until > now())
  )
$$;

-- The card's room message: a card is shown in the room through a message that points at it.
create function private.post_card_message(p_card public.chat_cards, p_author_kind public.chat_author_kind)
returns void
language sql security invoker set search_path = '' as $$
  insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, card_id)
  values (p_card.organization_id, p_card.poster_user_id, p_card.poster_profile_id, p_author_kind, p_card.poster_name, p_card.id)
$$;

create function public.post_booking_card(p_organization_id uuid, p_user_id uuid, p_booking_id uuid, p_spots int, p_note text)
returns table (status text, card_id uuid)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_author record;
  v_booking record;
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_refusal text;
  v_card public.chat_cards;
begin
  -- One person's posts go one at a time, so the checks below can't be raced by a double tap.
  perform pg_advisory_xact_lock(hashtext('chat:' || p_user_id::text));
  select * into v_author from private.chat_author(p_organization_id, p_user_id) limit 1;
  if not found or v_author.kind = 'team' then
    return query select 'no_profile'::text, null::uuid;
    return;
  end if;
  select rb.id, lower(rb.period) as starts_at, upper(rb.period) as ends_at, r.name as space_name, r.capacity,
         s.id as section_id, s.name as section_name, s.kind as section_kind, coalesce(s.accent, private.kind_accent(s.kind)) as accent
  into v_booking
  from public.resource_bookings rb
  join public.resources r on r.id = rb.resource_id
  join public.sections s on s.id = r.section_id
  where rb.id = p_booking_id and rb.organization_id = p_organization_id and rb.profile_id = v_author.profile_id
    and rb.status = 'confirmed' and lower(rb.period) > now();
  if not found then
    return query select 'not_yours'::text, null::uuid;
    return;
  end if;
  if v_booking.capacity <= 1 then
    return query select 'single_space'::text, null::uuid;
    return;
  end if;
  if p_spots is null or p_spots < 1 or p_spots > least(20, v_booking.capacity - 1) then
    return query select 'bad_spots'::text, null::uuid;
    return;
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from public.chat_cards c where c.resource_booking_id = p_booking_id and c.status in ('open', 'full')) then
    return query select 'already_posted'::text, null::uuid;
    return;
  end if;
  if (select count(*) from public.chat_cards c where c.poster_profile_id = v_author.profile_id and c.status in ('open', 'full')) >= 3 then
    return query select 'too_many_cards'::text, null::uuid;
    return;
  end if;
  v_refusal := private.chat_guard(p_organization_id, p_user_id, v_author.profile_id);
  if v_refusal is not null then
    return query select v_refusal, null::uuid;
    return;
  end if;

  insert into public.chat_cards (organization_id, kind, resource_booking_id, poster_user_id, poster_profile_id, poster_name,
    section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed, note)
  values (p_organization_id, 'booking', p_booking_id, p_user_id, v_author.profile_id, v_author.name,
    v_booking.section_id, v_booking.section_name, v_booking.section_kind, v_booking.accent, v_booking.space_name,
    v_booking.starts_at, v_booking.ends_at, p_spots, v_note)
  returning * into v_card;
  perform private.post_card_message(v_card, 'player');
  return query select 'posted'::text, v_card.id;
end;
$$;

create function public.post_session_card(p_organization_id uuid, p_user_id uuid, p_session_id uuid, p_note text)
returns table (status text, card_id uuid)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_author record;
  v_session record;
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_refusal text;
  v_card public.chat_cards;
begin
  perform pg_advisory_xact_lock(hashtext('chat:' || p_user_id::text));
  select * into v_author from private.chat_author(p_organization_id, p_user_id) limit 1;
  if not found then
    return query select 'no_profile'::text, null::uuid;
    return;
  end if;
  select os.id, os.starts_at, os.ends_at, os.seat_price_poisha, coalesce(a.name, 'Open play') as title,
         s.id as section_id, s.name as section_name, s.kind as section_kind, coalesce(s.accent, private.kind_accent(s.kind)) as accent
  into v_session
  from public.open_play_sessions os
  join public.sections s on s.id = os.section_id
  left join public.activities a on a.id = os.activity_id
  where os.id = p_session_id and os.organization_id = p_organization_id and os.status in ('open', 'matched') and os.starts_at > now();
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if v_author.kind = 'player'
     and not exists (select 1 from public.seat_requests sr where sr.session_id = p_session_id and sr.profile_id = v_author.profile_id)
     and not exists (select 1 from public.bookings bk where bk.session_id = p_session_id and bk.profile_id = v_author.profile_id and bk.status = 'confirmed') then
    return query select 'not_going'::text, null::uuid;
    return;
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from public.chat_cards c where c.session_id = p_session_id and c.poster_user_id = p_user_id and c.status = 'open') then
    return query select 'already_posted'::text, null::uuid;
    return;
  end if;
  if v_author.kind = 'player'
     and (select count(*) from public.chat_cards c where c.poster_profile_id = v_author.profile_id and c.status in ('open', 'full')) >= 3 then
    return query select 'too_many_cards'::text, null::uuid;
    return;
  end if;
  v_refusal := private.chat_guard(p_organization_id, p_user_id, v_author.profile_id);
  if v_refusal is not null then
    return query select v_refusal, null::uuid;
    return;
  end if;

  insert into public.chat_cards (organization_id, kind, session_id, poster_user_id, poster_profile_id, poster_name,
    section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, seat_price_poisha, note)
  values (p_organization_id, 'session', p_session_id, p_user_id, v_author.profile_id, v_author.name,
    v_session.section_id, v_session.section_name, v_session.section_kind, v_session.accent, v_session.title,
    v_session.starts_at, v_session.ends_at, v_session.seat_price_poisha, v_note)
  returning * into v_card;
  perform private.post_card_message(v_card, v_author.kind);
  return query select 'posted'::text, v_card.id;
end;
$$;

-- The poster, or any team member, closes a card; whoever was still waiting is told.
create function public.close_chat_card(p_card_id uuid, p_user_id uuid)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_card public.chat_cards;
begin
  select * into v_card from public.chat_cards where id = p_card_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_card.poster_user_id <> p_user_id
     and not exists (select 1 from public.organization_members m where m.organization_id = v_card.organization_id and m.user_id = p_user_id) then
    return 'not_yours';
  end if;
  if v_card.status not in ('open', 'full') then
    return 'not_open';
  end if;
  perform private.close_card(p_card_id, 'closed', true);
  return 'closed';
end;
$$;

-- I'm in. Asking again is allowed after withdrawing or leaving, not after the poster said no.
create function public.request_to_join(p_card_id uuid, p_user_id uuid)
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
  if v_card.kind <> 'booking' or v_card.status <> 'open' or v_card.starts_at <= now() then
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

  -- A second tap at the same moment waits here and then finds the request already pending.
  insert into public.chat_join_requests as r (organization_id, card_id, profile_id)
  values (v_card.organization_id, p_card_id, v_profile.id)
  on conflict (card_id, profile_id) do update set status = 'pending', created_at = now(), decided_at = null
    where r.status in ('withdrawn', 'left')
  returning true into v_asked;
  if v_asked is null then
    return 'already_asked';
  end if;

  insert into public.notifications (organization_id, profile_id, kind, payload, link)
  values (v_card.organization_id, v_card.poster_profile_id, 'chat_join_request',
          private.chat_card_payload(v_card) || jsonb_build_object('player_name', v_profile.display_name), '/chat/games/' || v_card.id);
  return 'requested';
end;
$$;

create function public.withdraw_join_request(p_card_id uuid, p_user_id uuid)
returns text
language plpgsql security invoker set search_path = '' as $$
begin
  update public.chat_join_requests r
  set status = 'withdrawn', decided_at = now()
  from public.chat_cards c, public.player_profiles p
  where r.card_id = p_card_id and c.id = r.card_id and p.id = r.profile_id and p.user_id = p_user_id and r.status = 'pending';
  return case when found then 'withdrawn' else 'not_found' end;
end;
$$;

-- The poster accepts or declines a waiting player. The card row is locked first, so two quick Accepts can never
-- take more spots than the card has: the second finds it full.
create function public.decide_join_request(p_card_id uuid, p_user_id uuid, p_profile_id uuid, p_accept boolean)
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
  if v_card.kind <> 'booking' or v_card.status not in ('open', 'full') or v_card.starts_at <= now() then
    return 'not_open';
  end if;
  if p_accept and v_card.spots_taken >= v_card.spots_needed then
    return 'full';
  end if;
  update public.chat_join_requests
  set status = case when p_accept then 'accepted'::public.chat_join_status else 'declined'::public.chat_join_status end, decided_at = now()
  where card_id = p_card_id and profile_id = p_profile_id and status = 'pending';
  if not found then
    return 'not_found';
  end if;

  if not p_accept then
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    values (v_card.organization_id, p_profile_id, 'chat_join_declined',
            private.chat_card_payload(v_card) || jsonb_build_object('after_accept', false), '/chat/games/' || v_card.id);
    return 'declined';
  end if;

  update public.chat_cards set spots_taken = spots_taken + 1 where id = p_card_id returning * into v_card;
  insert into public.notifications (organization_id, profile_id, kind, payload, link)
  values (v_card.organization_id, p_profile_id, 'chat_join_accepted', private.chat_card_payload(v_card), '/chat/games/' || v_card.id);
  if v_card.spots_taken >= v_card.spots_needed then
    perform private.close_card(p_card_id, 'full', true);
  end if;
  return 'accepted';
end;
$$;

-- An accepted player can't make it after all: the spot opens again (a full card reopens) and the poster is told.
create function public.leave_card(p_card_id uuid, p_user_id uuid)
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
  if v_card.status not in ('open', 'full') or v_card.starts_at <= now() then
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

-- The poster takes an accepted player off their game: the spot opens again and the player is told.
create function public.remove_from_card(p_card_id uuid, p_user_id uuid, p_profile_id uuid)
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
  if v_card.status not in ('open', 'full') or v_card.starts_at <= now() then
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

revoke execute on function
  private.chat_is_muted(uuid, uuid),
  private.post_card_message(public.chat_cards, public.chat_author_kind),
  public.post_booking_card(uuid, uuid, uuid, int, text),
  public.post_session_card(uuid, uuid, uuid, text),
  public.close_chat_card(uuid, uuid),
  public.request_to_join(uuid, uuid),
  public.withdraw_join_request(uuid, uuid),
  public.decide_join_request(uuid, uuid, uuid, boolean),
  public.leave_card(uuid, uuid),
  public.remove_from_card(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  private.chat_is_muted(uuid, uuid),
  private.post_card_message(public.chat_cards, public.chat_author_kind),
  public.post_booking_card(uuid, uuid, uuid, int, text),
  public.post_session_card(uuid, uuid, uuid, text),
  public.close_chat_card(uuid, uuid),
  public.request_to_join(uuid, uuid),
  public.withdraw_join_request(uuid, uuid),
  public.decide_join_request(uuid, uuid, uuid, boolean),
  public.leave_card(uuid, uuid),
  public.remove_from_card(uuid, uuid, uuid)
to service_role;
