-- Booking-flow RPCs. The only writers of bookings / waitlist_entries / seat_offers / events.
-- Run as service_role from server code (SMS webhook, simulated phones, cron job).
--
-- Lock order, to stay deadlock-free: seat_offers row → groups row → waitlist_entries row.
-- accept_offer is idempotent: a duplicate or concurrent YES blocks on the offer row lock,
-- then sees the committed status and returns 'already_accepted'.
--
-- Who hands a freed seat to the next waitlisted player:
--   expiry                       → expire_offers() returns the seat (the only place offers expire)
--   'declined', 'already_booked' → the caller (SMS reply handler) offers the seat onward
--   'seat_taken'                 → nothing to do; the seat is filled

create function public.cancel_booking(p_booking_id uuid)
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

  if b.status = 'confirmed' then
    update public.bookings set status = 'cancelled', cancelled_at = now() where id = b.id;
    insert into public.events (venue_id, session_id, type, payload)
    values (b.venue_id, b.session_id, 'booking_cancelled',
            jsonb_build_object('booking_id', b.id, 'player_id', b.player_id, 'group_id', b.group_id, 'seat_no', b.seat_no));
  elsif b.status <> 'cancelled' then
    raise exception 'booking_not_cancellable';
  end if;

  return query select b.group_id, b.seat_no, b.session_id;
end;
$$;

create function public.create_offer(p_group_id uuid, p_seat_no smallint, p_waitlist_entry_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  g public.groups;
  e public.waitlist_entries;
  v_expires_at timestamptz;
  v_offer_id uuid;
begin
  select * into g from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group_not_found';
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

  select now() + make_interval(secs => v.offer_ttl_seconds) into v_expires_at
  from public.venues v where v.id = g.venue_id;

  update public.waitlist_entries set status = 'offered' where id = e.id;
  insert into public.seat_offers (venue_id, group_id, seat_no, waitlist_entry_id, expires_at)
  values (g.venue_id, g.id, p_seat_no, e.id, v_expires_at)
  returning id into v_offer_id;
  insert into public.events (venue_id, session_id, type, payload)
  values (g.venue_id, g.session_id, 'offer_created',
          jsonb_build_object('offer_id', v_offer_id, 'player_id', e.player_id, 'group_id', g.id,
                             'seat_no', p_seat_no, 'expires_at', v_expires_at));
  return v_offer_id;
end;
$$;

-- Returns: accepted | already_accepted | declined | expired | seat_taken | already_booked | not_found
create function public.accept_offer(p_offer_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.seat_offers;
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
  elsif o.status = 'declined' then
    return 'declined';
  elsif o.status = 'expired' or o.expires_at <= now() then
    -- Too late. A past-due offer is left pending: expire_offers() is the only place an offer
    -- expires, so the freed seat always comes back to the caller that hands it on.
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
             where session_id = g.session_id and player_id = e.player_id and status <> 'cancelled') then
    update public.seat_offers set status = 'expired' where id = o.id;
    update public.waitlist_entries set status = 'withdrawn' where id = e.id;
    return 'already_booked';
  end if;

  insert into public.bookings (venue_id, session_id, group_id, player_id, seat_no, status, source, price_cents)
  select o.venue_id, g.session_id, g.id, e.player_id, o.seat_no, 'confirmed', 'waitlist', s.seat_price_cents
  from public.sessions s where s.id = g.session_id
  returning id into v_booking_id;

  update public.seat_offers set status = 'accepted', responded_at = now() where id = o.id;
  update public.waitlist_entries set status = 'promoted' where id = e.id;

  select max(cancelled_at) into v_last_cancel from public.bookings
  where group_id = g.id and seat_no = o.seat_no and status = 'cancelled';

  insert into public.events (venue_id, session_id, type, payload) values
    (o.venue_id, g.session_id, 'offer_accepted',
     jsonb_build_object('offer_id', o.id, 'booking_id', v_booking_id, 'player_id', e.player_id)),
    (o.venue_id, g.session_id, 'seat_filled',
     jsonb_build_object('group_id', g.id, 'seat_no', o.seat_no, 'booking_id', v_booking_id,
                        'seconds_since_cancel', floor(extract(epoch from now() - v_last_cancel))::int));
  return 'accepted';
end;
$$;

-- Returns: declined | not_pending | not_found. A NO takes the player off tonight's waitlist.
create function public.decline_offer(p_offer_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.seat_offers;
  e public.waitlist_entries;
begin
  select * into o from public.seat_offers where id = p_offer_id for update;
  if not found then
    return 'not_found';
  elsif o.status <> 'pending' then
    return 'not_pending';
  end if;

  select * into e from public.waitlist_entries where id = o.waitlist_entry_id for update;
  update public.seat_offers set status = 'declined', responded_at = now() where id = o.id;
  update public.waitlist_entries set status = 'withdrawn' where id = e.id;
  insert into public.events (venue_id, session_id, type, payload)
  values (o.venue_id, e.session_id, 'offer_declined', jsonb_build_object('offer_id', o.id, 'player_id', e.player_id));
  return 'declined';
end;
$$;

-- Expires every past-due pending offer; returns the freed seats so the caller can offer them onward.
create function public.expire_offers()
returns table (offer_id uuid, group_id uuid, seat_no smallint)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with expired as (
    update public.seat_offers
    set status = 'expired'
    where status = 'pending' and expires_at <= now()
    returning id, venue_id, group_id, seat_no, waitlist_entry_id
  ),
  entries as (
    update public.waitlist_entries w
    set status = 'expired'
    from expired x
    where w.id = x.waitlist_entry_id
    returning w.session_id, w.player_id, x.id as expired_offer_id, x.venue_id
  ),
  logged as (
    insert into public.events (venue_id, session_id, type, payload)
    select venue_id, session_id, 'offer_expired',
           jsonb_build_object('offer_id', expired_offer_id, 'player_id', player_id)
    from entries
  )
  select id, group_id, seat_no from expired;
end;
$$;

revoke execute on function
  public.cancel_booking(uuid),
  public.create_offer(uuid, smallint, uuid),
  public.accept_offer(uuid),
  public.decline_offer(uuid),
  public.expire_offers()
from public, anon, authenticated;

grant execute on function
  public.cancel_booking(uuid),
  public.create_offer(uuid, smallint, uuid),
  public.accept_offer(uuid),
  public.decline_offer(uuid),
  public.expire_offers()
to service_role;
