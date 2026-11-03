-- Paying for online bookings by bKash or Nagad — the team decides, cancelling, the numbers (spec §3, §4.3).
-- All service role only. decide_payment_claim, cancel_resource_booking and submit_payment_claim take the same
-- per-booking advisory lock (as payments and cancel already do), so two people acting at once get one outcome.

-- ── Confirm or reject ───────────────────────────────────────────────────────────────────────────────
-- By an owner or a staff member of the booking's section, on a pending booking whose details were sent.
-- Confirm: booked, a bKash/Nagad payment of the claim's amount recorded (with the transaction ID and who), the
-- player told it's booked. Reject: cancelled, its slot freed, the player told why with the venue's number.
create function public.decide_payment_claim(p_booking_id uuid, p_user_id uuid, p_decision text, p_reason text default null)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.resource_bookings;
  v_claim public.payment_claims;
  v_resource record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_payload jsonb;
begin
  if p_decision not in ('confirm', 'reject') or char_length(coalesce(v_reason, '')) > 200 then
    return 'invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0));
  select * into v_booking from public.resource_bookings where id = p_booking_id for update;
  if not found then
    return 'not_pending';
  end if;
  select r.name, r.section_id, s.name as section_name into v_resource
  from public.resources r join public.sections s on s.id = r.section_id
  where r.id = v_booking.resource_id;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = v_booking.organization_id and m.user_id = p_user_id
      and (m.role = 'owner' or exists (select 1 from public.section_staff ss where ss.section_id = v_resource.section_id and ss.user_id = p_user_id))
  ) then
    return 'not_allowed';
  end if;
  if v_booking.status <> 'pending' then
    return 'not_pending';
  end if;
  select * into v_claim from public.payment_claims where booking_id = p_booking_id and status = 'submitted' for update;
  if not found then
    return 'nothing_sent';
  end if;

  v_payload := jsonb_build_object('booking_id', p_booking_id, 'resource_name', v_resource.name, 'section_name', v_resource.section_name,
                                  'starts_at', lower(v_booking.period), 'ends_at', upper(v_booking.period), 'price_poisha', v_booking.price_poisha);

  if p_decision = 'confirm' then
    update public.resource_bookings set status = 'confirmed' where id = p_booking_id;
    insert into public.payments (resource_booking_id, amount_poisha, method, reference, taken_by)
    values (p_booking_id, v_claim.amount_poisha, v_claim.method, v_claim.trx_id, p_user_id);
    update public.payment_claims set status = 'confirmed', decided_by = p_user_id, decided_at = now() where id = v_claim.id;
    if v_booking.profile_id is not null then
      insert into public.notifications (organization_id, profile_id, kind, payload, link)
      values (v_booking.organization_id, v_booking.profile_id, 'booking_confirmed', v_payload, '/me/bookings');
    end if;
    return 'confirmed';
  end if;

  update public.resource_bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = p_user_id, hold_until = null where id = p_booking_id;
  delete from public.resource_reservations where source = 'booking' and source_id = p_booking_id;
  update public.payment_claims set status = 'rejected', decided_by = p_user_id, decided_at = now(), reason = v_reason where id = v_claim.id;
  if v_booking.profile_id is not null then
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    select v_booking.organization_id, v_booking.profile_id, 'booking_payment_rejected',
           v_payload || jsonb_build_object('reason', v_reason, 'contact_phone', coalesce(o.bkash_number, o.nagad_number)),
           '/me/bookings'
    from public.organizations o where o.id = v_booking.organization_id;
  end if;
  return 'rejected';
end;
$$;
revoke execute on function public.decide_payment_claim(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_payment_claim(uuid, uuid, text, text) to service_role;

-- ── Cancelling ──────────────────────────────────────────────────────────────────────────────────────
-- As before (20261028030000_r3_review_fixes.sql), and a pending booking too: its own player only while it is
-- held (before sending details — after that they contact the venue); anyone else (the app has checked they are on
-- the team) always. Details already sent are kept, marked rejected with the reason "cancelled".
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

  if v_booking.profile_id is not null then
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

-- ── The venue's numbers ─────────────────────────────────────────────────────────────────────────────
-- Owners only. Spaces are dropped and an empty value clears a number; the old values come back so the app can
-- email every owner what changed.
create function public.set_payment_numbers(p_organization_id uuid, p_user_id uuid, p_bkash text, p_nagad text)
returns table (status text, old_bkash text, old_nagad text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_bkash text := nullif(regexp_replace(coalesce(p_bkash, ''), '\s', '', 'g'), '');
  v_nagad text := nullif(regexp_replace(coalesce(p_nagad, ''), '\s', '', 'g'), '');
  v_old record;
begin
  if not exists (
    select 1 from public.organization_members m where m.organization_id = p_organization_id and m.user_id = p_user_id and m.role = 'owner'
  ) then
    return query select 'not_allowed'::text, null::text, null::text;
    return;
  end if;
  if (v_bkash is not null and v_bkash !~ '^01[3-9][0-9]{8}$') or (v_nagad is not null and v_nagad !~ '^01[3-9][0-9]{8}$') then
    return query select 'invalid'::text, null::text, null::text;
    return;
  end if;
  select o.bkash_number, o.nagad_number into v_old from public.organizations o where o.id = p_organization_id for update;
  update public.organizations set bkash_number = v_bkash, nagad_number = v_nagad where id = p_organization_id;
  return query select 'saved'::text, v_old.bkash_number, v_old.nagad_number;
end;
$$;
revoke execute on function public.set_payment_numbers(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_payment_numbers(uuid, uuid, text, text) to service_role;
