-- R3 (manage area): cash payments, desk check-in timing, section website fields, a bigger photo limit.
-- Functions changed here copy their current definitions (pg_get_functiondef) and edit them.

-- ── Payments ────────────────────────────────────────────────────────────────────────────────────────
-- One row per payment of a space booking or a seat in a game. Undo voids it; nothing is deleted. The
-- brand and section always come from the booking (a trigger fills them), so the access rules below see
-- the booking's real section whatever the request sent.
-- Composite keys (x_id, organization_id) keep every reference inside one brand (06_tenant_refs).
alter table public.resource_bookings add constraint resource_bookings_id_organization_id_key unique (id, organization_id);
alter table public.bookings add constraint bookings_id_organization_id_key unique (id, organization_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  section_id uuid not null,
  resource_booking_id uuid,
  seat_booking_id uuid,
  amount_poisha integer not null check (amount_poisha > 0 and amount_poisha <= 10000000),
  method text not null default 'cash' check (method in ('cash')),
  taken_by uuid references auth.users (id) on delete set null,
  taken_at timestamptz not null default now(),
  voided_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  foreign key (section_id, organization_id) references public.sections (id, organization_id) on delete cascade,
  foreign key (resource_booking_id, organization_id) references public.resource_bookings (id, organization_id) on delete cascade,
  foreign key (seat_booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade,
  check (num_nonnulls(resource_booking_id, seat_booking_id) = 1),
  -- A system cancel (service role) voids without a person; a person is never recorded without a void.
  check (voided_at is not null or voided_by is null)
);
create index payments_organization_id_idx on public.payments (organization_id);
create index payments_section_id_idx on public.payments (section_id);
create index payments_resource_booking_id_idx on public.payments (resource_booking_id);
create index payments_seat_booking_id_idx on public.payments (seat_booking_id);
create index payments_taken_by_idx on public.payments (taken_by);
create index payments_voided_by_idx on public.payments (voided_by);
create index payments_taken_at_idx on public.payments (organization_id, taken_at);
create unique index payments_one_live_space_idx on public.payments (resource_booking_id) where voided_at is null;
create unique index payments_one_live_seat_idx on public.payments (seat_booking_id) where voided_at is null;

-- Fills the brand and section from the booking as the caller sees it (security invoker: a booking the
-- caller can't read is "not payable" too), refuses cancelled bookings, and stamps who and when.
create function private.payments_fill()
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

-- The only change a payment allows: being voided, once.
create function private.payments_void_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.voided_at is not null or new.voided_at is null
     or (new.id, new.organization_id, new.section_id, new.resource_booking_id, new.seat_booking_id, new.amount_poisha, new.method, new.taken_by, new.taken_at)
        is distinct from
        (old.id, old.organization_id, old.section_id, old.resource_booking_id, old.seat_booking_id, old.amount_poisha, old.method, old.taken_by, old.taken_at) then
    raise exception 'payment_is_void_only';
  end if;
  new.voided_by := coalesce((select auth.uid()), new.voided_by);
  return new;
end;
$$;

create trigger payments_fill before insert on public.payments for each row execute function private.payments_fill();
create trigger payments_void_only before update on public.payments for each row execute function private.payments_void_only();
revoke execute on function private.payments_fill(), private.payments_void_only() from public;

alter table public.payments enable row level security;
create policy payments_select on public.payments for select to authenticated
  using ((select private.is_section_staff(section_id)));
create policy payments_insert on public.payments for insert to authenticated
  with check ((select private.is_section_staff(section_id)));
create policy payments_update on public.payments for update to authenticated
  using ((select private.is_section_staff(section_id)))
  with check ((select private.is_section_staff(section_id)));
grant select, insert on public.payments to authenticated;
grant update (voided_by, voided_at) on public.payments to authenticated;
grant all on public.payments to service_role;

-- ── Section website fields and the photo limit ──────────────────────────────────────────────────────
alter table public.sections
  add column description text check (char_length(description) <= 300),
  add column photo_path text;
update storage.buckets set file_size_limit = 5242880 where id = 'org-assets';

-- ── Desk check-in: Arrived from 30 minutes before the start, No-show from the start, both undoable ──
create or replace function public.set_resource_booking_status(p_booking_id uuid, p_status public.resource_booking_status)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.resource_bookings;
begin
  select * into v_booking from public.resource_bookings where id = p_booking_id for update;
  if not found then
    return 'not_found';
  end if;
  if p_status = 'confirmed' then
    if v_booking.status not in ('attended', 'no_show') then
      return 'invalid';
    end if;
  elsif p_status not in ('attended', 'no_show') or v_booking.status <> 'confirmed' then
    return 'invalid';
  elsif p_status = 'attended' and lower(v_booking.period) - interval '30 minutes' > now() then
    return 'not_started';
  elsif p_status = 'no_show' and lower(v_booking.period) > now() then
    return 'not_started';
  end if;
  update public.resource_bookings set status = p_status where id = p_booking_id;
  return 'updated';
end;
$$;

create function public.set_seat_booking_status(p_booking_id uuid, p_status public.booking_status)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_starts timestamptz;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    return 'not_found';
  end if;
  select starts_at into v_starts from public.open_play_sessions where id = v_booking.session_id;
  if p_status = 'confirmed' then
    if v_booking.status not in ('attended', 'no_show') then
      return 'invalid';
    end if;
  elsif p_status not in ('attended', 'no_show') or v_booking.status <> 'confirmed' then
    return 'invalid';
  elsif p_status = 'attended' and v_starts - interval '30 minutes' > now() then
    return 'not_started';
  elsif p_status = 'no_show' and v_starts > now() then
    return 'not_started';
  end if;
  update public.bookings set status = p_status where id = p_booking_id;
  return 'updated';
end;
$$;
revoke execute on function public.set_seat_booking_status(uuid, public.booking_status) from public, anon, authenticated;
grant execute on function public.set_seat_booking_status(uuid, public.booking_status) to service_role;

-- ── Cancelling a paid booking or seat voids its payment in the same step ────────────────────────────
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
