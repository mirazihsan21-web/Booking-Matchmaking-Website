-- Paying for online bookings by bKash or Nagad — the functions (spec §4.3). All service role only, like the rest.
-- book_resource copies its current definition (20261025010000_sections.sql) and adds `p_by_player`.

-- ── Booking ─────────────────────────────────────────────────────────────────────────────────────────
-- A player booking online (p_by_player) a space with a price above ৳0: `pending`, held 15 minutes for the
-- payment details, no "booked" notice (that comes with the team's Confirm); refused as `payment_closed` when the
-- brand has no bKash or Nagad number. Everything else (the team, walk-ins, ৳0 spaces) is booked straight away.
-- Pending bookings count toward the limit.
drop function public.book_resource(uuid, uuid, timestamptz, int, uuid, text, text, uuid);
create function public.book_resource(
  p_organization_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_slots int,
  p_profile_id uuid,
  p_guest_name text,
  p_guest_phone text,
  p_created_by uuid,
  p_by_player boolean default false
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
  v_pending boolean;
begin
  if p_starts_at is null or p_slots is null or p_slots not between 1 and 4
     or not (
       (p_profile_id is not null and p_guest_name is null and p_guest_phone is null)
       or (p_profile_id is null and nullif(trim(p_guest_name), '') is not null and nullif(trim(p_guest_phone), '') is not null)
     ) then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  select r.name, r.slot_minutes, r.price_per_hour_poisha, b.id as section_id, b.name as section_name,
         b.max_upcoming_bookings
  into v_resource
  from public.resources r
  join public.sections b on b.id = r.section_id
  where r.id = p_resource_id and r.organization_id = p_organization_id and r.active;
  if not found then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_resource.slot_minutes * p_slots));
  v_price := coalesce(round(v_resource.price_per_hour_poisha * v_resource.slot_minutes * p_slots / 60.0)::int, 0);
  v_pending := coalesce(p_by_player, false) and p_profile_id is not null and v_price > 0;

  if v_pending and not exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and (o.bkash_number is not null or o.nagad_number is not null)
  ) then
    return query select 'payment_closed'::text, null::uuid;
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
    -- The limit is the space's section's, and counts that player's bookings in the same section (pending too).
    v_limit := v_resource.max_upcoming_bookings;
    select count(*) into v_upcoming
    from public.resource_bookings b
    join public.resources rr on rr.id = b.resource_id
    where b.profile_id = p_profile_id and b.status in ('confirmed', 'pending') and upper(b.period) > now()
      and rr.section_id = v_resource.section_id;
    if v_upcoming >= v_limit then
      return query select 'limit_reached'::text, null::uuid;
      return;
    end if;
  end if;

  begin
    insert into public.resource_bookings (organization_id, resource_id, profile_id, guest_name, guest_phone, period, price_poisha, created_by, status, hold_until)
    values (p_organization_id, p_resource_id, p_profile_id, trim(p_guest_name), trim(p_guest_phone), v_period, v_price, p_created_by,
            case when v_pending then 'pending' else 'confirmed' end::public.resource_booking_status,
            case when v_pending then now() + interval '15 minutes' end)
    returning id into v_id;
    insert into public.resource_reservations (organization_id, resource_id, period, source, source_id)
    values (p_organization_id, p_resource_id, v_period, 'booking', v_id);
  exception when exclusion_violation then
    return query select 'taken'::text, null::uuid;
    return;
  end;

  if v_pending then
    return query select 'pending'::text, v_id;
    return;
  end if;

  if p_profile_id is not null then
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    values (
      p_organization_id, p_profile_id, 'booking_confirmed',
      jsonb_build_object('booking_id', v_id, 'resource_name', v_resource.name, 'section_name', v_resource.section_name, 'starts_at', lower(v_period),
                         'ends_at', upper(v_period), 'price_poisha', v_price),
      '/me/bookings'
    );
  end if;

  return query select 'booked'::text, v_id;
end;
$$;
revoke execute on function public.book_resource(uuid, uuid, timestamptz, int, uuid, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.book_resource(uuid, uuid, timestamptz, int, uuid, text, text, uuid, boolean) to service_role;

-- ── Sending the payment details ─────────────────────────────────────────────────────────────────────
-- The booking's own player, while its hold runs, for a service the brand has a number for. The transaction ID is
-- kept upper-case without spaces, once per brand; the amount is the booking's price. The hold then gives way to
-- waiting for the team. A booking whose hold ended (cancelled with no details) answers `hold_over`.
create function public.submit_payment_claim(p_booking_id uuid, p_user_id uuid, p_method text, p_sender_phone text, p_trx_id text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.resource_bookings;
  v_trx text := upper(regexp_replace(coalesce(p_trx_id, ''), '\s', '', 'g'));
  v_phone text := regexp_replace(coalesce(p_sender_phone, ''), '\s', '', 'g');
begin
  perform pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0));
  select * into v_booking from public.resource_bookings where id = p_booking_id for update;
  if not found then
    return 'not_yours';
  end if;
  if not exists (
    select 1 from public.player_profiles p where p.id = v_booking.profile_id and p.user_id = p_user_id
  ) then
    return 'not_yours';
  end if;
  if v_booking.status = 'cancelled' and not exists (select 1 from public.payment_claims c where c.booking_id = p_booking_id) then
    return 'hold_over';
  end if;
  if v_booking.status <> 'pending' or v_booking.hold_until is null then
    return 'not_pending';
  end if;
  if v_booking.hold_until <= now() then
    return 'hold_over';
  end if;
  if p_method not in ('bkash', 'nagad') or v_phone !~ '^01[3-9][0-9]{8}$' or v_trx !~ '^[A-Z0-9]{6,20}$' then
    return 'invalid';
  end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = v_booking.organization_id
      and case p_method when 'bkash' then o.bkash_number is not null else o.nagad_number is not null end
  ) then
    return 'method_closed';
  end if;

  begin
    insert into public.payment_claims (organization_id, booking_id, method, sender_phone, trx_id, amount_poisha)
    values (v_booking.organization_id, p_booking_id, p_method, v_phone, v_trx, v_booking.price_poisha);
  exception when unique_violation then
    return 'trx_used';
  end;
  update public.resource_bookings set hold_until = null where id = p_booking_id;
  return 'submitted';
end;
$$;
revoke execute on function public.submit_payment_claim(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_payment_claim(uuid, uuid, text, text, text) to service_role;

-- ── Holds that end ──────────────────────────────────────────────────────────────────────────────────
-- The every-minute job: pending bookings whose 15 minutes ran out with no details are cancelled (by nobody), their
-- slot freed, and their player told. A booking whose details were sent has no hold and is never ended here.
create function public.expire_payment_holds(p_now timestamptz default now())
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
                              'starts_at', lower(e.period), 'ends_at', upper(e.period)),
           '/me/bookings'
    from ended e
    join public.resources r on r.id = e.resource_id
    join public.sections s on s.id = r.section_id
    where e.profile_id is not null
    returning 1
  )
  select (select count(*) from ended) + 0 * (select count(*) from freed) + 0 * (select count(*) from told) into v_ended;
  return v_ended;
end;
$$;
revoke execute on function public.expire_payment_holds(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_payment_holds(timestamptz) to service_role;
