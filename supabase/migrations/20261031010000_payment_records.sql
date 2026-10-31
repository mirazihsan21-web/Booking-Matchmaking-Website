-- Cash records keep their history (website fixes after the R3 review).
-- 1. Staff cancelling a seat or a whole game are recorded as who voided its cash: the app cancels with the service
--    role (no auth.uid()), so it now names the person (p_cancelled_by).
-- 2. Deleting a login that took or voided cash works: the "on delete set null" of taken_by / voided_by is allowed
--    through the void-only rule — only for the database itself (no signed-in user), never for a request.
-- 3. The void time is the database's (now()), whatever the request sends.
-- 4. A booking, seat or section with cash records can't be deleted (it used to take them with it).

-- ── 1. Who voided ───────────────────────────────────────────────────────────
drop function public.cancel_booking(uuid, boolean);
create function public.cancel_booking(p_booking_id uuid, p_by_venue boolean default false, p_cancelled_by uuid default null)
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
    update public.payments set voided_at = now(), voided_by = coalesce(p_cancelled_by, (select auth.uid()))
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
revoke execute on function public.cancel_booking(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid, boolean, uuid) to service_role;

drop function public.cancel_open_play_session(uuid);
create function public.cancel_open_play_session(p_session_id uuid, p_cancelled_by uuid default null)
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
  update public.payments p set voided_at = now(), voided_by = coalesce(p_cancelled_by, (select auth.uid()))
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
revoke execute on function public.cancel_open_play_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_open_play_session(uuid, uuid) to service_role;

-- ── 2 and 3. The void-only rule ─────────────────────────────────────────────
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
     and (new.id, new.organization_id, new.section_id, new.resource_booking_id, new.seat_booking_id, new.amount_poisha, new.method, new.taken_at, new.voided_at)
         is not distinct from
         (old.id, old.organization_id, old.section_id, old.resource_booking_id, old.seat_booking_id, old.amount_poisha, old.method, old.taken_at, old.voided_at)
     and (new.taken_by is null or new.taken_by is not distinct from old.taken_by)
     and (new.voided_by is null or new.voided_by is not distinct from old.voided_by)
     and (new.taken_by is distinct from old.taken_by or new.voided_by is distinct from old.voided_by) then
    return new;
  end if;
  if old.voided_at is not null or new.voided_at is null
     or (new.id, new.organization_id, new.section_id, new.resource_booking_id, new.seat_booking_id, new.amount_poisha, new.method, new.taken_by, new.taken_at)
        is distinct from
        (old.id, old.organization_id, old.section_id, old.resource_booking_id, old.seat_booking_id, old.amount_poisha, old.method, old.taken_by, old.taken_at) then
    raise exception 'payment_is_void_only';
  end if;
  new.voided_at := now();
  new.voided_by := coalesce((select auth.uid()), new.voided_by);
  return new;
end;
$$;

-- ── 4. Cash records outlive nothing by accident ─────────────────────────────
alter table public.payments
  drop constraint payments_resource_booking_id_organization_id_fkey,
  drop constraint payments_seat_booking_id_organization_id_fkey,
  drop constraint payments_section_id_organization_id_fkey,
  add constraint payments_resource_booking_id_organization_id_fkey
    foreign key (resource_booking_id, organization_id) references public.resource_bookings (id, organization_id),
  add constraint payments_seat_booking_id_organization_id_fkey
    foreign key (seat_booking_id, organization_id) references public.bookings (id, organization_id),
  add constraint payments_section_id_organization_id_fkey
    foreign key (section_id, organization_id) references public.sections (id, organization_id);
