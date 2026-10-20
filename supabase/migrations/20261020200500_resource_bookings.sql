-- Stage B1: whole-space bookings (spec §2.4, §3 B1).
--
-- A confirmed booking owns one resource_reservations row, so the existing exclusion constraint makes
-- an overlap with another booking or an open-play session impossible. Every write goes through these
-- service_role-only functions, which also write the player's notification in the same transaction
-- (the outbox). Opening hours, the slot grid, the booking window and the cancel cut-off are checked in
-- TypeScript (apps/web/lib/bookings) before calling them.

create type public.resource_booking_status as enum ('confirmed', 'cancelled', 'attended', 'no_show');

create table public.resource_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  resource_id uuid not null,
  profile_id uuid,
  guest_name text check (guest_name is null or length(trim(guest_name)) between 1 and 60),
  guest_phone text,
  period tstzrange not null check (not isempty(period)),
  price_poisha int not null check (price_poisha >= 0),
  status public.resource_booking_status not null default 'confirmed',
  created_by uuid references auth.users (id) on delete set null,
  cancelled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  -- Either a player with an account, or a walk-in with a name and a phone — never both.
  constraint resource_bookings_who_check check (
    (profile_id is not null and guest_name is null and guest_phone is null)
    or (profile_id is null and guest_name is not null and guest_phone is not null)
  ),
  constraint resource_bookings_resource_id_fkey foreign key (resource_id, organization_id)
    references public.resources (id, organization_id) on delete no action,
  constraint resource_bookings_profile_id_fkey foreign key (profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete no action
);
create index resource_bookings_organization_id_idx on public.resource_bookings (organization_id);
create index resource_bookings_resource_id_idx on public.resource_bookings (resource_id, organization_id);
create index resource_bookings_profile_id_idx on public.resource_bookings (profile_id, organization_id);
create index resource_bookings_created_by_idx on public.resource_bookings (created_by);
create index resource_bookings_cancelled_by_idx on public.resource_bookings (cancelled_by);

alter table public.resource_bookings enable row level security;
revoke all on public.resource_bookings from anon, authenticated;
grant select on public.resource_bookings to authenticated;

create policy resource_bookings_select on public.resource_bookings for select to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)) or (select private.is_org_member(organization_id)));

-- Book 1–4 slots of a space for a player (counts toward the venue's upcoming-bookings limit) or a
-- walk-in (doesn't). Returns booked + id, taken, limit_reached or invalid.
create function public.book_resource(
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

  select r.name, r.slot_minutes, r.price_per_hour_poisha into v_resource
  from public.resources r
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
      jsonb_build_object('booking_id', v_id, 'resource_name', v_resource.name, 'starts_at', lower(v_period),
                         'ends_at', upper(v_period), 'price_poisha', v_price),
      '/me/bookings'
    );
  end if;

  return query select 'booked'::text, v_id;
end;
$$;

-- Cancel a confirmed booking and free its time. The player is told, including whether the venue did it.
create function public.cancel_resource_booking(p_booking_id uuid, p_cancelled_by uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.resource_bookings;
  v_user uuid;
  v_name text;
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
    select r.name into v_name from public.resources r where r.id = v_booking.resource_id;
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    values (
      v_booking.organization_id, v_booking.profile_id, 'booking_cancelled',
      jsonb_build_object('booking_id', p_booking_id, 'resource_name', v_name, 'starts_at', lower(v_booking.period),
                         'ends_at', upper(v_booking.period), 'by_venue', p_cancelled_by is distinct from v_user),
      '/me/bookings'
    );
  end if;
  return 'cancelled';
end;
$$;

-- Staff mark attendance: only a confirmed booking can become attended or no_show.
create function public.set_resource_booking_status(p_booking_id uuid, p_status public.resource_booking_status)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status in ('attended', 'no_show') then
    update public.resource_bookings set status = p_status where id = p_booking_id and status = 'confirmed';
    if found then
      return 'updated';
    end if;
  end if;
  return case when exists (select 1 from public.resource_bookings where id = p_booking_id) then 'invalid' else 'not_found' end;
end;
$$;

revoke execute on function
  public.book_resource(uuid, uuid, timestamptz, int, uuid, text, text, uuid),
  public.cancel_resource_booking(uuid, uuid),
  public.set_resource_booking_status(uuid, public.resource_booking_status)
from public, anon, authenticated;
grant execute on function
  public.book_resource(uuid, uuid, timestamptz, int, uuid, text, text, uuid),
  public.cancel_resource_booking(uuid, uuid),
  public.set_resource_booking_status(uuid, public.resource_booking_status)
to service_role;
