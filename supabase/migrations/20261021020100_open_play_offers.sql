-- Stage B2: offers with email tokens, session-aware accepts, cancellations and closing (spec §2.5, §3).
--
-- Offer links: the token is minted by the email step (app) and only its SHA-256 is stored, so a link
-- can't be rebuilt from the database. A new offer gets the hash of random bytes nobody keeps (the
-- column default); issue_offer_token swaps in the hash of the token that goes into the email.
--
-- A session is live while it is open or matched and hasn't started. Offers, accepts and cancels only
-- act on live sessions; close_started_sessions closes them at the start and tells whoever is left.
-- Lock order: session → offer → group → waitlist entry (M1's offer → group → entry, session first).
-- Notification payloads come from the private helpers in 20261021020000_open_play_requests.sql.

-- A volatile default, so existing rows each get their own value too.
alter table public.seat_offers
  add column token_hash text not null default encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex'),
  add constraint seat_offers_token_hash_key unique (token_hash);

-- Serves the tick: sessions to match and sessions to close.
create index open_play_sessions_live_starts_at_idx on public.open_play_sessions (starts_at) where status in ('open', 'matched');

-- ── create_offer ─────────────────────────────────────────────────────────────
create or replace function public.create_offer(p_group_id uuid, p_seat_no smallint, p_waitlist_entry_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.open_play_sessions;
  g public.groups;
  e public.waitlist_entries;
  v_expires_at timestamptz;
  v_offer_id uuid;
begin
  select * into s from public.open_play_sessions
  where id = (select session_id from public.groups where id = p_group_id)
  for share;
  select * into g from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group_not_found';
  end if;
  if s.status not in ('open', 'matched') or s.starts_at <= now() then
    raise exception 'session_closed';
  end if;
  if p_seat_no < 1 or p_seat_no > g.capacity then
    raise exception 'seat_out_of_range';
  end if;
  if exists (select 1 from public.bookings
             where group_id = g.id and seat_no = p_seat_no and status <> 'cancelled') then
    raise exception 'seat_not_free';
  end if;
  if exists (select 1 from public.seat_offers
             where group_id = g.id and seat_no = p_seat_no and status = 'pending') then
    raise exception 'offer_pending';
  end if;

  select * into e from public.waitlist_entries where id = p_waitlist_entry_id for update;
  if not found or e.status <> 'waiting' or e.session_id <> g.session_id then
    raise exception 'entry_not_waiting';
  end if;

  -- Never past the start: a seat can't be taken once the game is on.
  select least(now() + make_interval(secs => b.offer_ttl_seconds), s.starts_at) into v_expires_at
  from public.branches b where b.id = s.branch_id;

  update public.waitlist_entries set status = 'offered' where id = e.id;
  insert into public.seat_offers (organization_id, group_id, seat_no, waitlist_entry_id, expires_at)
  values (g.organization_id, g.id, p_seat_no, e.id, v_expires_at)
  returning id into v_offer_id;
  insert into public.events (organization_id, session_id, type, payload)
  values (g.organization_id, g.session_id, 'offer_created',
          jsonb_build_object('offer_id', v_offer_id, 'profile_id', e.profile_id, 'group_id', g.id,
                             'seat_no', p_seat_no, 'expires_at', v_expires_at));
  insert into public.notifications (organization_id, profile_id, kind, payload, link)
  values (g.organization_id, e.profile_id, 'offer',
          private.seat_payload(g.id, p_seat_no) || jsonb_build_object('offer_id', v_offer_id, 'expires_at', v_expires_at),
          '/me/offers/' || v_offer_id);
  return v_offer_id;
end;
$$;

-- ── issue_offer_token ────────────────────────────────────────────────────────
-- Returns: issued | not_pending. Called by the email step with the hash of the token it is sending.
create function public.issue_offer_token(p_offer_id uuid, p_token_hash text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.seat_offers;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token_hash';
  end if;
  select * into o from public.seat_offers where id = p_offer_id for update;
  if not found or o.status <> 'pending' or o.expires_at <= now() then
    return 'not_pending';
  end if;
  update public.seat_offers set token_hash = p_token_hash where id = o.id;
  return 'issued';
end;
$$;

-- ── accept_offer ─────────────────────────────────────────────────────────────
-- Returns: accepted | already_accepted | closed | declined | expired | seat_taken | already_booked | not_found
create or replace function public.accept_offer(p_offer_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.seat_offers;
  s public.open_play_sessions;
  g public.groups;
  e public.waitlist_entries;
  v_booking_id uuid;
  v_last_cancel timestamptz;
begin
  select * into o from public.seat_offers where id = p_offer_id for update;
  if not found then
    return 'not_found';
  elsif o.status = 'accepted' then
    return 'already_accepted';
  end if;

  select ps.* into s from public.groups pg join public.open_play_sessions ps on ps.id = pg.session_id where pg.id = o.group_id;
  if s.status not in ('open', 'matched') or s.starts_at <= now() then
    if o.status = 'pending' then
      update public.seat_offers set status = 'expired' where id = o.id;
      update public.waitlist_entries set status = 'expired' where id = o.waitlist_entry_id and status = 'offered';
    end if;
    return 'closed';
  elsif o.status = 'declined' then
    return 'declined';
  elsif o.status = 'expired' or o.expires_at <= now() then
    -- Too late. A past-due offer is left pending: expire_offers() is the only place an offer of a
    -- live session expires, so the freed seat always comes back to the caller that hands it on.
    return 'expired';
  end if;

  select * into g from public.groups where id = o.group_id for update;
  select * into e from public.waitlist_entries where id = o.waitlist_entry_id for update;

  if exists (select 1 from public.bookings
             where group_id = g.id and seat_no = o.seat_no and status <> 'cancelled') then
    -- Someone else holds the seat now; the player keeps their place for the next one.
    update public.seat_offers set status = 'expired' where id = o.id;
    update public.waitlist_entries set status = 'waiting' where id = e.id;
    return 'seat_taken';
  end if;

  if exists (select 1 from public.bookings
             where session_id = g.session_id and profile_id = e.profile_id and status <> 'cancelled') then
    update public.seat_offers set status = 'expired' where id = o.id;
    update public.waitlist_entries set status = 'withdrawn' where id = e.id;
    return 'already_booked';
  end if;

  v_booking_id := private.take_seat(g.id, o.seat_no, e.profile_id, 'waitlist', 'offer');
  update public.seat_offers set status = 'accepted', responded_at = now() where id = o.id;
  update public.waitlist_entries set status = 'promoted' where id = e.id;

  select max(cancelled_at) into v_last_cancel from public.bookings
  where group_id = g.id and seat_no = o.seat_no and status = 'cancelled';

  insert into public.events (organization_id, session_id, type, payload) values
    (o.organization_id, g.session_id, 'offer_accepted',
     jsonb_build_object('offer_id', o.id, 'booking_id', v_booking_id, 'profile_id', e.profile_id)),
    (o.organization_id, g.session_id, 'seat_filled',
     jsonb_build_object('group_id', g.id, 'seat_no', o.seat_no, 'booking_id', v_booking_id,
                        'seconds_since_cancel', floor(extract(epoch from now() - v_last_cancel))::int));
  return 'accepted';
end;
$$;

-- ── decline_offer ────────────────────────────────────────────────────────────
-- Returns: declined | closed | not_pending | not_found. Declining takes the player off that session's waitlist.
create or replace function public.decline_offer(p_offer_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.seat_offers;
  s public.open_play_sessions;
  e public.waitlist_entries;
begin
  select * into o from public.seat_offers where id = p_offer_id for update;
  if not found then
    return 'not_found';
  end if;
  select ps.* into s from public.groups pg join public.open_play_sessions ps on ps.id = pg.session_id where pg.id = o.group_id;
  if s.status not in ('open', 'matched') or s.starts_at <= now() then
    return 'closed';
  elsif o.status <> 'pending' then
    return 'not_pending';
  end if;

  select * into e from public.waitlist_entries where id = o.waitlist_entry_id for update;
  update public.seat_offers set status = 'declined', responded_at = now() where id = o.id;
  update public.waitlist_entries set status = 'withdrawn' where id = e.id;
  insert into public.events (organization_id, session_id, type, payload)
  values (o.organization_id, e.session_id, 'offer_declined', jsonb_build_object('offer_id', o.id, 'profile_id', e.profile_id));
  return 'declined';
end;
$$;

-- ── expire_offers ────────────────────────────────────────────────────────────
-- Expires every past-due pending offer of a live session and returns the freed seats so the caller
-- can offer them onward. Offers of sessions that have started are left to close_started_sessions,
-- which tells their players there was no seat.
create or replace function public.expire_offers()
returns table (offer_id uuid, group_id uuid, seat_no smallint)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with expired as (
    update public.seat_offers o
    set status = 'expired'
    from public.groups g
    join public.open_play_sessions s on s.id = g.session_id
    where o.group_id = g.id and o.status = 'pending' and o.expires_at <= now()
      and s.status in ('open', 'matched') and s.starts_at > now()
    returning o.id, o.organization_id, o.group_id, o.seat_no, o.waitlist_entry_id
  ),
  entries as (
    update public.waitlist_entries w
    set status = 'expired'
    from expired x
    where w.id = x.waitlist_entry_id
    returning w.session_id, w.profile_id, x.id as expired_offer_id, x.organization_id
  ),
  logged as (
    insert into public.events (organization_id, session_id, type, payload)
    select organization_id, session_id, 'offer_expired',
           jsonb_build_object('offer_id', expired_offer_id, 'profile_id', profile_id)
    from entries
  ),
  notified as (
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    select organization_id, profile_id, 'offer_expired', private.session_payload(session_id), '/sessions/' || session_id
    from entries
  )
  select id, group_id, seat_no from expired;
end;
$$;

-- ── cancel_booking ───────────────────────────────────────────────────────────
-- Cancels a seat and returns it so the caller can offer it onward. Nothing happens (no row) once the
-- session is closed or cancelled. p_by_venue says who cancelled, for the player's notification.
drop function public.cancel_booking(uuid);
create function public.cancel_booking(p_booking_id uuid, p_by_venue boolean default false)
returns table (group_id uuid, seat_no smallint, session_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.open_play_sessions where id = b.session_id and status in ('open', 'matched')) then
    return;
  end if;

  if b.status = 'confirmed' then
    update public.bookings set status = 'cancelled', cancelled_at = now() where id = b.id;
    insert into public.events (organization_id, session_id, type, payload)
    values (b.organization_id, b.session_id, 'booking_cancelled',
            jsonb_build_object('booking_id', b.id, 'profile_id', b.profile_id, 'group_id', b.group_id, 'seat_no', b.seat_no));
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    values (b.organization_id, b.profile_id, 'seat_cancelled',
            private.seat_payload(b.group_id, b.seat_no) || jsonb_build_object('booking_id', b.id, 'by_venue', coalesce(p_by_venue, false)),
            '/me/bookings');
  elsif b.status <> 'cancelled' then
    raise exception 'booking_not_cancellable';
  end if;

  return query select b.group_id, b.seat_no, b.session_id;
end;
$$;

-- ── close_started_sessions ───────────────────────────────────────────────────
-- At the start, a session closes: pending offers expire and whoever is still waiting hears there was
-- no seat. A session that never matched tells everyone who asked that it didn't fill.
create function public.close_started_sessions()
returns setof uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.open_play_sessions;
begin
  for s in
    select * from public.open_play_sessions
    where status in ('open', 'matched') and starts_at <= now()
    order by starts_at
    for update skip locked
  loop
    update public.open_play_sessions set status = 'closed' where id = s.id;
    update public.seat_offers o set status = 'expired'
    from public.groups g
    where g.id = o.group_id and g.session_id = s.id and o.status = 'pending';

    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    select s.organization_id, w.profile_id, 'no_seat', private.session_payload(s.id) || jsonb_build_object('reason', 'waitlist'), '/'
    from public.waitlist_entries w
    where w.session_id = s.id and w.status in ('waiting', 'offered');
    update public.waitlist_entries set status = 'expired' where session_id = s.id and status in ('waiting', 'offered');

    if s.status = 'open' then
      insert into public.notifications (organization_id, profile_id, kind, payload, link)
      select s.organization_id, r.profile_id, 'no_seat',
             private.session_payload(s.id) || jsonb_build_object('reason', 'not_enough_players'), '/'
      from public.seat_requests r
      where r.session_id = s.id;
    end if;
    return next s.id;
  end loop;
end;
$$;

-- ── cancel_open_play_session ─────────────────────────────────────────────────
-- Returns: cancelled | not_open | not_found. An open or matched session can be cancelled: seats are
-- cancelled, offers and the waitlist withdrawn, the time freed, and every player involved told once.
create or replace function public.cancel_open_play_session(p_session_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.open_play_sessions;
begin
  select * into s from public.open_play_sessions where id = p_session_id for update;
  if not found then
    return 'not_found';
  elsif s.status not in ('open', 'matched') then
    return 'not_open';
  end if;

  insert into public.notifications (organization_id, profile_id, kind, payload, link)
  select s.organization_id, who.profile_id, 'session_cancelled', private.session_payload(s.id), '/'
  from (
    select profile_id from public.bookings where session_id = s.id and status = 'confirmed'
    union
    select profile_id from public.waitlist_entries where session_id = s.id and status in ('waiting', 'offered')
    union
    select profile_id from public.seat_requests where session_id = s.id and s.status = 'open'
  ) who;

  update public.open_play_sessions set status = 'cancelled' where id = s.id;
  update public.bookings set status = 'cancelled', cancelled_at = now() where session_id = s.id and status = 'confirmed';
  update public.seat_offers o set status = 'expired'
  from public.groups g
  where g.id = o.group_id and g.session_id = s.id and o.status = 'pending';
  update public.waitlist_entries set status = 'withdrawn' where session_id = s.id and status in ('waiting', 'offered');
  delete from public.resource_reservations where source = 'session' and source_id = s.id;
  return 'cancelled';
end;
$$;

revoke execute on function
  public.issue_offer_token(uuid, text),
  public.cancel_booking(uuid, boolean),
  public.close_started_sessions()
from public, anon, authenticated;

grant execute on function
  public.issue_offer_token(uuid, text),
  public.cancel_booking(uuid, boolean),
  public.close_started_sessions()
to service_role;
