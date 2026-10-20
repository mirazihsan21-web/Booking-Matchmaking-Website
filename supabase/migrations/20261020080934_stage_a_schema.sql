-- Stage A: the multi-tenant platform schema.
--
-- Replaces the M1 single-venue demo tables (they never held production data). Tenancy:
--   organizations (the tenant, one subdomain) → branches → resources; activities, player profiles and
--   open-play sessions belong to the organization. Every tenant row carries organization_id so RLS and
--   Realtime can filter on it directly.
-- Resource time lives in resource_reservations; its exclusion constraint makes double-booking impossible.
-- The M1 seat invariants (partial unique indexes) and booking RPCs carry over with the new names.
-- RLS is enabled on every table here (deny-all); policies and user grants arrive in the next migration.

-- ── Remove the M1 demo schema ────────────────────────────────────────────────
drop function if exists public.cancel_booking(uuid);
drop function if exists public.create_offer(uuid, smallint, uuid);
drop function if exists public.accept_offer(uuid);
drop function if exists public.decline_offer(uuid);
drop function if exists public.expire_offers();

-- Tables first: their policies depend on the old private helpers.
drop table if exists
  public.events, public.messages, public.seat_offers, public.waitlist_entries, public.bookings,
  public.groups, public.seat_requests, public.sessions, public.availability, public.player_games,
  public.players, public.games, public.venue_tables, public.venues
cascade;

drop function if exists private.is_venue_owner(uuid);
drop function if exists private.is_venue_member(uuid);
drop function if exists private.is_own_player(uuid, uuid);

drop type if exists
  public.session_status, public.booking_status, public.booking_source, public.waitlist_status,
  public.offer_status, public.message_direction;

create extension if not exists btree_gist with schema extensions;

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.business_type as enum ('boardgame_cafe', 'turf', 'gaming_lounge');
create type public.org_status as enum ('onboarding', 'live', 'suspended');
create type public.member_role as enum ('owner', 'staff');
create type public.team_mode as enum ('none', 'two_teams');
create type public.resource_kind as enum ('table', 'pitch', 'court', 'zone', 'pod');
create type public.reservation_source as enum ('session', 'booking');
create type public.session_status as enum ('open', 'matched', 'closed', 'cancelled');
create type public.booking_status as enum ('confirmed', 'cancelled', 'attended', 'no_show');
create type public.booking_source as enum ('matched', 'waitlist');
create type public.waitlist_status as enum ('waiting', 'offered', 'promoted', 'expired', 'withdrawn');
create type public.offer_status as enum ('pending', 'accepted', 'declined', 'expired');
create type public.message_direction as enum ('outbound', 'inbound');

-- ── Tenancy ──────────────────────────────────────────────────────────────────
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$')
    check (slug not in ('www', 'app', 'admin', 'api', 'manage', 'auth', 'static', 't',
                        'help', 'support', 'status', 'docs', 'blog', 'mail')),
  name text not null check (length(trim(name)) between 2 and 80),
  business_type public.business_type not null,
  branding jsonb not null default '{}',
  currency text not null default 'BDT' check (currency = 'BDT'),
  timezone text not null default 'Asia/Dhaka',
  status public.org_status not null default 'onboarding',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index organizations_created_by_idx on public.organizations (created_by);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_id_idx on public.organization_members (user_id);

create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email)),
  role public.member_role not null default 'staff',
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index organization_invites_open_key
  on public.organization_invites (organization_id, email) where accepted_at is null;
create index organization_invites_organization_id_idx on public.organization_invites (organization_id);
create index organization_invites_invited_by_idx on public.organization_invites (invited_by);
create index organization_invites_email_idx on public.organization_invites (email);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ── Places, things to play, schedule ────────────────────────────────────────
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  address text not null default '',
  opening_hours jsonb not null default '{"0":["10:00","23:00"],"1":["10:00","23:00"],"2":["10:00","23:00"],"3":["10:00","23:00"],"4":["10:00","23:00"],"5":["10:00","23:00"],"6":["10:00","23:00"]}',
  offer_ttl_seconds int not null default 900 check (offer_ttl_seconds > 0),
  created_at timestamptz not null default now()
);
create index branches_organization_id_idx on public.branches (organization_id);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  name text not null,
  kind public.resource_kind not null,
  capacity smallint not null check (capacity between 1 and 30),
  price_per_hour_poisha int check (price_per_hour_poisha >= 0),
  active boolean not null default true,
  x real not null default 0,
  y real not null default 0
);
create index resources_organization_id_idx on public.resources (organization_id);
create index resources_branch_id_idx on public.resources (branch_id);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  min_players smallint not null check (min_players >= 1),
  max_players smallint not null,
  duration_min smallint not null check (duration_min > 0),
  popularity real not null default 1 check (popularity > 0),
  team_mode public.team_mode not null default 'none',
  team_size smallint,
  active boolean not null default true,
  check (min_players <= max_players),
  check (
    (team_mode = 'none' and team_size is null)
    -- "is not null" matters: a NULL comparison would make the CHECK pass.
    or (team_mode = 'two_teams' and team_size is not null and team_size >= 1
        and min_players = 2 * team_size and max_players = 2 * team_size)
  )
);
create index activities_organization_id_idx on public.activities (organization_id);

create table public.open_play_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  activity_id uuid references public.activities (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  seat_price_poisha int not null check (seat_price_poisha >= 0),
  status public.session_status not null default 'open',
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create index open_play_sessions_organization_id_starts_at_idx on public.open_play_sessions (organization_id, starts_at);
create index open_play_sessions_branch_id_idx on public.open_play_sessions (branch_id);
create index open_play_sessions_activity_id_idx on public.open_play_sessions (activity_id);

create table public.open_play_session_resources (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.open_play_sessions (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete restrict,
  primary key (session_id, resource_id)
);
create index open_play_session_resources_organization_id_idx on public.open_play_session_resources (organization_id);
create index open_play_session_resources_resource_id_idx on public.open_play_session_resources (resource_id);

create table public.resource_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  period tstzrange not null check (not isempty(period) and lower_inc(period) and not upper_inc(period)),
  source public.reservation_source not null,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  constraint resource_reservations_no_overlap exclude using gist (resource_id with =, period with &&)
);
create index resource_reservations_organization_id_idx on public.resource_reservations (organization_id);
create index resource_reservations_resource_id_idx on public.resource_reservations (resource_id);
create index resource_reservations_source_idx on public.resource_reservations (source, source_id);

-- ── Players ──────────────────────────────────────────────────────────────────
create table public.player_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 60),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  skill smallint not null check (skill between 1 and 5),
  email_opt_in boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, phone)
);
create index player_profiles_user_id_idx on public.player_profiles (user_id);

create table public.profile_activities (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.player_profiles (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  rank smallint not null check (rank >= 1),
  primary key (profile_id, activity_id),
  unique (profile_id, rank)
);
create index profile_activities_organization_id_idx on public.profile_activities (organization_id);
create index profile_activities_activity_id_idx on public.profile_activities (activity_id);

create table public.availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.player_profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time)
);
create index availability_organization_id_idx on public.availability (organization_id);
create index availability_profile_id_idx on public.availability (profile_id);

-- ── Booking flow (M1 invariants, re-keyed) ──────────────────────────────────
create table public.seat_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.open_play_sessions (id) on delete cascade,
  profile_id uuid not null references public.player_profiles (id) on delete cascade,
  priority smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (session_id, profile_id)
);
create index seat_requests_organization_id_idx on public.seat_requests (organization_id);
create index seat_requests_profile_id_idx on public.seat_requests (profile_id);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.open_play_sessions (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  capacity smallint not null check (capacity > 0),
  unique (session_id, resource_id)
);
create index groups_organization_id_idx on public.groups (organization_id);
create index groups_resource_id_idx on public.groups (resource_id);
create index groups_activity_id_idx on public.groups (activity_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.open_play_sessions (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  profile_id uuid not null references public.player_profiles (id) on delete cascade,
  seat_no smallint not null check (seat_no >= 1),
  status public.booking_status not null default 'confirmed',
  source public.booking_source not null default 'matched',
  price_poisha int not null check (price_poisha >= 0),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create unique index bookings_live_profile_per_session_key
  on public.bookings (session_id, profile_id) where status <> 'cancelled';
create unique index bookings_live_seat_key
  on public.bookings (group_id, seat_no) where status <> 'cancelled';
create index bookings_organization_id_idx on public.bookings (organization_id);
create index bookings_session_id_idx on public.bookings (session_id);
create index bookings_group_id_idx on public.bookings (group_id);
create index bookings_profile_id_idx on public.bookings (profile_id);

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.open_play_sessions (id) on delete cascade,
  profile_id uuid not null references public.player_profiles (id) on delete cascade,
  priority smallint not null default 0,
  queue_position int not null check (queue_position >= 1),
  status public.waitlist_status not null default 'waiting',
  created_at timestamptz not null default now(),
  unique (session_id, profile_id)
);
create index waitlist_entries_organization_id_idx on public.waitlist_entries (organization_id);
create index waitlist_entries_profile_id_idx on public.waitlist_entries (profile_id);

create table public.seat_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  seat_no smallint not null check (seat_no >= 1),
  waitlist_entry_id uuid not null references public.waitlist_entries (id) on delete cascade,
  status public.offer_status not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index seat_offers_one_pending_per_seat_key
  on public.seat_offers (group_id, seat_no) where status = 'pending';
create index seat_offers_organization_id_idx on public.seat_offers (organization_id);
create index seat_offers_group_id_idx on public.seat_offers (group_id);
create index seat_offers_waitlist_entry_id_idx on public.seat_offers (waitlist_entry_id);
create index seat_offers_status_expires_at_idx on public.seat_offers (status, expires_at);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid references public.player_profiles (id) on delete set null,
  direction public.message_direction not null,
  body text not null,
  provider text not null check (provider in ('simulated', 'twilio')),
  provider_sid text,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);
create index messages_organization_id_created_at_idx on public.messages (organization_id, created_at);
create index messages_profile_id_idx on public.messages (profile_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid references public.open_play_sessions (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_organization_id_created_at_idx on public.events (organization_id, created_at);
create index events_session_id_idx on public.events (session_id);

-- ── Deny by default: RLS on, no user grants (the RLS migration adds them) ───
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'organization_members', 'organization_invites', 'platform_admins',
    'branches', 'resources', 'activities', 'open_play_sessions', 'open_play_session_resources',
    'resource_reservations', 'player_profiles', 'profile_activities', 'availability',
    'seat_requests', 'groups', 'bookings', 'waitlist_entries', 'seat_offers', 'messages', 'events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;

-- ── Booking-flow RPCs (M1 contracts, Stage A names) ─────────────────────────
-- The only writers of bookings / waitlist_entries / seat_offers / events. service_role only.
-- Lock order, to stay deadlock-free: seat_offers row → groups row → waitlist_entries row.
-- accept_offer is idempotent: a duplicate or concurrent accept blocks on the offer row lock,
-- then sees the committed status and returns 'already_accepted'.
-- Who hands a freed seat to the next waitlisted player:
--   expiry                       → expire_offers() returns the seat (the only place offers expire)
--   'declined', 'already_booked' → the caller offers the seat onward
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
    insert into public.events (organization_id, session_id, type, payload)
    values (b.organization_id, b.session_id, 'booking_cancelled',
            jsonb_build_object('booking_id', b.id, 'profile_id', b.profile_id, 'group_id', b.group_id, 'seat_no', b.seat_no));
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

  select now() + make_interval(secs => b.offer_ttl_seconds) into v_expires_at
  from public.open_play_sessions s
  join public.branches b on b.id = s.branch_id
  where s.id = g.session_id;

  update public.waitlist_entries set status = 'offered' where id = e.id;
  insert into public.seat_offers (organization_id, group_id, seat_no, waitlist_entry_id, expires_at)
  values (g.organization_id, g.id, p_seat_no, e.id, v_expires_at)
  returning id into v_offer_id;
  insert into public.events (organization_id, session_id, type, payload)
  values (g.organization_id, g.session_id, 'offer_created',
          jsonb_build_object('offer_id', v_offer_id, 'profile_id', e.profile_id, 'group_id', g.id,
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
             where session_id = g.session_id and profile_id = e.profile_id and status <> 'cancelled') then
    update public.seat_offers set status = 'expired' where id = o.id;
    update public.waitlist_entries set status = 'withdrawn' where id = e.id;
    return 'already_booked';
  end if;

  insert into public.bookings (organization_id, session_id, group_id, profile_id, seat_no, status, source, price_poisha)
  select o.organization_id, g.session_id, g.id, e.profile_id, o.seat_no, 'confirmed', 'waitlist', s.seat_price_poisha
  from public.open_play_sessions s where s.id = g.session_id
  returning id into v_booking_id;

  update public.seat_offers set status = 'accepted', responded_at = now() where id = o.id;
  update public.waitlist_entries set status = 'promoted' where id = e.id;

  select max(cancelled_at) into v_last_cancel from public.bookings
  where group_id = g.id and seat_no = o.seat_no and status = 'cancelled';

  insert into public.events (organization_id, session_id, type, payload) values
    (o.organization_id, g.session_id, 'offer_accepted',
     jsonb_build_object('offer_id', o.id, 'booking_id', v_booking_id, 'profile_id', e.profile_id)),
    (o.organization_id, g.session_id, 'seat_filled',
     jsonb_build_object('group_id', g.id, 'seat_no', o.seat_no, 'booking_id', v_booking_id,
                        'seconds_since_cancel', floor(extract(epoch from now() - v_last_cancel))::int));
  return 'accepted';
end;
$$;

-- Returns: declined | not_pending | not_found. Declining takes the player off that session's waitlist.
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
  insert into public.events (organization_id, session_id, type, payload)
  values (o.organization_id, e.session_id, 'offer_declined', jsonb_build_object('offer_id', o.id, 'profile_id', e.profile_id));
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
    returning id, organization_id, group_id, seat_no, waitlist_entry_id
  ),
  entries as (
    update public.waitlist_entries w
    set status = 'expired'
    from expired x
    where w.id = x.waitlist_entry_id
    returning w.session_id, w.profile_id, x.id as expired_offer_id, x.organization_id
  ),
  logged as (
    insert into public.events (organization_id, session_id, type, payload)
    select organization_id, session_id, 'offer_expired',
           jsonb_build_object('offer_id', expired_offer_id, 'profile_id', profile_id)
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
