-- Stage B1 review fix: booking notifications say which branch.
--
-- A venue with two branches can have "Pitch 1" at both, and each branch keeps its own hours, so the
-- confirmation and cancellation must say where. The payloads gain branch_name and multi_branch (the
-- app shows the branch only when the venue has more than one). Bodies are otherwise unchanged from
-- 20261020200500_resource_bookings.sql; create or replace keeps their service_role-only grants.

create or replace function public.book_resource(
  p_organization_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_slots int,
  p_profile_id uuid,
  p_guest_name text,
  p_guest_phone text,
  p_created_by uuid
)
returns table (status text, booking_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_resource record;
  v_limit int;
  v_upcoming int;
  v_period tstzrange;
  v_price int;
  v_id uuid;
begin
  if p_starts_at is null or p_slots is null or p_slots not between 1 and 4
     or not (
       (p_profile_id is not null and p_guest_name is null and p_guest_phone is null)
       or (p_profile_id is null and nullif(trim(p_guest_name), '') is not null and nullif(trim(p_guest_phone), '') is not null)
     ) then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  select r.name, r.slot_minutes, r.price_per_hour_poisha, b.name as branch_name,
         (select count(*) > 1 from public.branches x where x.organization_id = p_organization_id) as multi_branch
  into v_resource
  from public.resources r
  join public.branches b on b.id = r.branch_id
  where r.id = p_resource_id and r.organization_id = p_organization_id and r.active;
  if not found then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if p_profile_id is not null then
    -- Lock the player so two bookings at once can't both slip under the limit.
    perform 1 from public.player_profiles p
    where p.id = p_profile_id and p.organization_id = p_organization_id
    for update;
    if not found then
      return query select 'invalid'::text, null::uuid;
      return;
    end if;
    select o.max_upcoming_bookings into v_limit from public.organizations o where o.id = p_organization_id;
    select count(*) into v_upcoming
    from public.resource_bookings b
    where b.profile_id = p_profile_id and b.status = 'confirmed' and upper(b.period) > now();
    if v_upcoming >= v_limit then
      return query select 'limit_reached'::text, null::uuid;
      return;
    end if;
  end if;

  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_resource.slot_minutes * p_slots));
  v_price := coalesce(round(v_resource.price_per_hour_poisha * v_resource.slot_minutes * p_slots / 60.0)::int, 0);

  begin
    insert into public.resource_bookings (organization_id, resource_id, profile_id, guest_name, guest_phone, period, price_poisha, created_by)
    values (p_organization_id, p_resource_id, p_profile_id, trim(p_guest_name), trim(p_guest_phone), v_period, v_price, p_created_by)
    returning id into v_id;
    insert into public.resource_reservations (organization_id, resource_id, period, source, source_id)
    values (p_organization_id, p_resource_id, v_period, 'booking', v_id);
  exception when exclusion_violation then
    return query select 'taken'::text, null::uuid;
    return;
  end;

  if p_profile_id is not null then
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    values (
      p_organization_id, p_profile_id, 'booking_confirmed',
      jsonb_build_object('booking_id', v_id, 'resource_name', v_resource.name, 'branch_name', v_resource.branch_name,
                         'multi_branch', v_resource.multi_branch, 'starts_at', lower(v_period),
                         'ends_at', upper(v_period), 'price_poisha', v_price),
      '/me/bookings'
    );
  end if;

  return query select 'booked'::text, v_id;
end;
$$;

create or replace function public.cancel_resource_booking(p_booking_id uuid, p_cancelled_by uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.resource_bookings;
  v_user uuid;
  v_name text;
  v_branch text;
  v_multi boolean;
begin
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

  if v_booking.profile_id is not null then
    select p.user_id into v_user from public.player_profiles p where p.id = v_booking.profile_id;
    select r.name, b.name, (select count(*) > 1 from public.branches x where x.organization_id = v_booking.organization_id)
    into v_name, v_branch, v_multi
    from public.resources r
    join public.branches b on b.id = r.branch_id
    where r.id = v_booking.resource_id;
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    values (
      v_booking.organization_id, v_booking.profile_id, 'booking_cancelled',
      jsonb_build_object('booking_id', p_booking_id, 'resource_name', v_name, 'branch_name', v_branch, 'multi_branch', v_multi, 'starts_at', lower(v_booking.period),
                         'ends_at', upper(v_booking.period), 'by_venue', p_cancelled_by is distinct from v_user),
      '/me/bookings'
    );
  end if;
  return 'cancelled';
end;
$$;
