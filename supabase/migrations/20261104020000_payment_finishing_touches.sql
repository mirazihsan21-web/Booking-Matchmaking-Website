-- Paying online by bKash or Nagad — finishing touches (deferred minors from the final review, 2026-11-04).
-- 1. Sending the details after the venue cancelled the request answers `not_pending` (already handled), as the
--    spec says; a hold that ran out (cancelled_by null) or the player's own cancel still answers `hold_over`.
-- 2. A player cancelling their own unpaid hold isn't sent a "Booking cancelled" notice (they just did it); the
--    venue's cancel, and the player's cancel of a booked one, still are.
-- 3. A recorded payment's transaction ID (`reference`) is as fixed as its amount and method — also while voiding.

-- ── 1. Sending the payment details ──────────────────────────────────────────────────────────────────
-- As in 20261104010200_mobile_money_booking_fns.sql, with the venue's cancel told apart from a hold that ended.
create or replace function public.submit_payment_claim(p_booking_id uuid, p_user_id uuid, p_method text, p_sender_phone text, p_trx_id text)
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
    -- Cancelled by someone else (the venue): already handled. Ran out (nobody) or the player's own cancel: over.
    if v_booking.cancelled_by is not null and v_booking.cancelled_by is distinct from p_user_id then
      return 'not_pending';
    end if;
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

-- ── 2. Cancelling ───────────────────────────────────────────────────────────────────────────────────
-- As in 20261104010300_mobile_money_decide_fns.sql; no notice when the player drops their own unpaid hold.
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
  if v_booking.profile_id is not null then
    select p.user_id into v_user from public.player_profiles p where p.id = v_booking.profile_id;
  end if;
  if v_booking.status = 'pending' then
    if p_cancelled_by is not distinct from v_user and v_booking.hold_until is null then
      return 'not_cancellable';
    end if;
  elsif v_booking.status <> 'confirmed' then
    return 'not_cancellable';
  end if;

  update public.resource_bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = p_cancelled_by, hold_until = null
  where id = p_booking_id;
  delete from public.resource_reservations where source = 'booking' and source_id = p_booking_id;
  update public.payments set voided_at = now(), voided_by = p_cancelled_by
  where resource_booking_id = p_booking_id and voided_at is null;
  update public.payment_claims set status = 'rejected', reason = 'cancelled', decided_by = p_cancelled_by, decided_at = now()
  where booking_id = p_booking_id and status = 'submitted';

  if v_booking.profile_id is not null
     and not (v_booking.status = 'pending' and p_cancelled_by is not distinct from v_user) then
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

-- ── 3. The void-only rule covers the transaction ID ─────────────────────────────────────────────────
-- As in 20261031010000_payment_records.sql, with `reference` in both checks.
create or replace function private.payments_void_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A login being deleted: its "on delete set null" only blanks taken_by / voided_by. No signed-in user can
  -- reach this path (they have no auth.uid() of null), so nobody can erase who handled cash by request.
  if (select auth.uid()) is null
     and (new.id, new.organization_id, new.section_id, new.resource_booking_id, new.seat_booking_id, new.amount_poisha, new.method, new.reference, new.taken_at, new.voided_at)
         is not distinct from
         (old.id, old.organization_id, old.section_id, old.resource_booking_id, old.seat_booking_id, old.amount_poisha, old.method, old.reference, old.taken_at, old.voided_at)
     and (new.taken_by is null or new.taken_by is not distinct from old.taken_by)
     and (new.voided_by is null or new.voided_by is not distinct from old.voided_by)
     and (new.taken_by is distinct from old.taken_by or new.voided_by is distinct from old.voided_by) then
    return new;
  end if;
  if old.voided_at is not null or new.voided_at is null
     or (new.id, new.organization_id, new.section_id, new.resource_booking_id, new.seat_booking_id, new.amount_poisha, new.method, new.reference, new.taken_by, new.taken_at)
        is distinct from
        (old.id, old.organization_id, old.section_id, old.resource_booking_id, old.seat_booking_id, old.amount_poisha, old.method, old.reference, old.taken_by, old.taken_at) then
    raise exception 'payment_is_void_only';
  end if;
  new.voided_at := now();
  new.voided_by := coalesce((select auth.uid()), new.voided_by);
  return new;
end;
$$;
