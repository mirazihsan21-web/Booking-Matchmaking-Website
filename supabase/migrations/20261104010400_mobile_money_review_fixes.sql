-- Paying online by bKash or Nagad — fixes from the final review.
-- 1. A pending online request could be paid in cash at the desk (the phone's Today view offered it): Confirm then hit
--    the one-live-payment index, and Reject or the job left a live cash payment on a cancelled booking. Payments now
--    refuse pending bookings as they refuse cancelled ones.
-- 2. A player whose hold ended may already have sent money: the hold-ended notice carries the venue's number
--    (`contact_phone`), like the rejected one.

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
  -- Not on a cancelled booking, nor on an online request still waiting for its payment check (decide_payment_claim
  -- books it before recording its bKash/Nagad payment).
  if v_org is null or v_status in ('cancelled', 'pending') then
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

create or replace function public.expire_payment_holds(p_now timestamptz default now())
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ended int;
begin
  with due as (
    select b.id from public.resource_bookings b
    where b.status = 'pending' and b.hold_until is not null and b.hold_until < p_now
    order by b.hold_until
    limit 200
    for update skip locked
  ),
  ended as (
    update public.resource_bookings b
    set status = 'cancelled', cancelled_at = p_now, cancelled_by = null, hold_until = null
    from due where b.id = due.id
    returning b.id, b.organization_id, b.profile_id, b.resource_id, b.period
  ),
  freed as (
    delete from public.resource_reservations rr using ended e where rr.source = 'booking' and rr.source_id = e.id
    returning 1
  ),
  told as (
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    select e.organization_id, e.profile_id, 'booking_hold_expired',
           jsonb_build_object('booking_id', e.id, 'resource_name', r.name, 'section_name', s.name,
                              'starts_at', lower(e.period), 'ends_at', upper(e.period),
                              'contact_phone', coalesce(o.bkash_number, o.nagad_number)),
           '/me/bookings'
    from ended e
    join public.resources r on r.id = e.resource_id
    join public.sections s on s.id = r.section_id
    join public.organizations o on o.id = e.organization_id
    where e.profile_id is not null
    returning 1
  )
  select (select count(*) from ended) + 0 * (select count(*) from freed) + 0 * (select count(*) from told) into v_ended;
  return v_ended;
end;
$$;
