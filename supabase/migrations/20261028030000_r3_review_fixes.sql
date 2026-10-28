-- R3 final review fixes.
-- 1. Cancelling a whole game voids its seats' cash, as cancelling one seat or booking already does.
-- 2. A payment and a cancel on the same booking take turns: both take the same transaction lock on the booking,
--    so a payment made while a cancel is in flight waits, then sees the booking cancelled and is refused, and a
--    cancel made while a payment is being recorded waits, then voids it. Never a live payment on a cancelled
--    booking (Review Focus 1, now also when two people press at the same moment).

create or replace function private.payments_fill()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_section uuid;
  v_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended(coalesce(new.resource_booking_id, new.seat_booking_id)::text, 0));
  if new.resource_booking_id is not null then
    select b.organization_id, r.section_id, b.status::text into v_org, v_section, v_status
    from public.resource_bookings b
    join public.resources r on r.id = b.resource_id
    where b.id = new.resource_booking_id;
  else
    select b.organization_id, s.section_id, b.status::text into v_org, v_section, v_status
    from public.bookings b
    join public.open_play_sessions s on s.id = b.session_id
    where b.id = new.seat_booking_id;
  end if;
  if v_org is null or v_status = 'cancelled' then
    raise exception 'booking_not_payable';
  end if;
  new.organization_id := v_org;
  new.section_id := v_section;
  new.taken_by := coalesce((select auth.uid()), new.taken_by);
  new.taken_at := now();
  new.voided_by := null;
  new.voided_at := null;
  return new;
end;
$$;

create or replace function public.cancel_resource_booking(p_booking_id uuid, p_cancelled_by uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_booking public.resource_bookings;
  v_user uuid;
  v_name text;
  v_section text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0));
  select * into v_booking from public.resource_bookings where id = p_booking_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_booking.status <> 'confirmed' then
    return 'not_cancellable';
  end if;

  update public.resource_bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = p_cancelled_by
  where id = p_booking_id;
  delete from public.resource_reservations where source = 'booking' and source_id = p_booking_id;
  update public.payments set voided_at = now(), voided_by = p_cancelled_by
  where resource_booking_id = p_booking_id and voided_at is null;

  if v_booking.profile_id is not null then
    select p.user_id into v_user from public.player_profiles p where p.id = v_booking.profile_id;
    select r.name, b.name
    into v_name, v_section
    from public.resources r
    join public.sections b on b.id = r.section_id
    where r.id = v_booking.resource_id;
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    values (
      v_booking.organization_id, v_booking.profile_id, 'booking_cancelled',
      jsonb_build_object('booking_id', p_booking_id, 'resource_name', v_name, 'section_name', v_section, 'starts_at', lower(v_booking.period),
                         'ends_at', upper(v_booking.period), 'by_venue', p_cancelled_by is distinct from v_user),
      '/me/bookings'
    );
  end if;
  return 'cancelled';
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid, p_by_venue boolean default false)
returns table (group_id uuid, seat_no smallint, session_id uuid)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  b public.bookings;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0));
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.open_play_sessions where id = b.session_id and status in ('open', 'matched')) then
    return;
  end if;

  if b.status = 'confirmed' then
    update public.bookings set status = 'cancelled', cancelled_at = now() where id = b.id;
    update public.payments set voided_at = now(), voided_by = (select auth.uid())
    where seat_booking_id = b.id and voided_at is null;
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
  -- Every seat's lock, in one order, so a payment on any of them waits for this cancel (see payments_fill).
  perform pg_advisory_xact_lock(hashtextextended(b.id::text, 0))
  from (select id from public.bookings where session_id = s.id and status = 'confirmed' order by id) b;

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
  update public.payments p set voided_at = now(), voided_by = (select auth.uid())
  from public.bookings b
  where p.seat_booking_id = b.id and b.session_id = s.id and p.voided_at is null;
  update public.seat_offers o set status = 'expired'
  from public.groups g
  where g.id = o.group_id and g.session_id = s.id and o.status = 'pending';
  update public.waitlist_entries set status = 'withdrawn' where session_id = s.id and status in ('waiting', 'offered');
  delete from public.resource_reservations where source = 'session' and source_id = s.id;
  return 'cancelled';
end;
$$;
