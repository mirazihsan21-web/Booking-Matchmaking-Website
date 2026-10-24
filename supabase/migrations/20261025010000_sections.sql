-- One Brand R1: branches become sections, each with its own booking rules (spec §2.1–2.2).
--
-- The brand is one organizations row; its sections (turf, board-game café, gaming lounge) each have a
-- kind, a web address (slug), opening hours, booking rules, an offer time, an accent colour and a
-- display order. The four booking rules move here from the organization, and the address moves the
-- other way (all sections are in one place). Every function whose body named branches is recreated
-- below (renames don't rewrite function source); they now read each section's rules, and payloads
-- carry section_name instead of branch_name/multi_branch.

-- ── Rename ───────────────────────────────────────────────────────────────────
alter table public.branches rename to sections;
alter table public.resources rename column branch_id to section_id;
alter table public.open_play_sessions rename column branch_id to section_id;

-- Constraint, index and policy names follow (constraints first: renaming one renames its index).
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conname ~ 'branch'
  loop
    execute format('alter table %s rename constraint %I to %I', r.tbl, r.conname, replace(r.conname, 'branch', 'section'));
  end loop;
  for r in select indexname from pg_indexes where schemaname = 'public' and indexname ~ 'branch' loop
    execute format('alter index public.%I rename to %I', r.indexname, replace(r.indexname, 'branch', 'section'));
  end loop;
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and policyname ~ 'branch' loop
    execute format('alter policy %I on public.%I rename to %I', r.policyname, r.tablename, replace(r.policyname, 'branch', 'section'));
  end loop;
end $$;

-- ── Section kinds: default slug and accent ───────────────────────────────────
create function private.kind_accent(p_kind public.business_type)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_kind when 'turf' then '#15803D' when 'boardgame_cafe' then '#0F766E' else '#7C3AED' end;
$$;

-- The first free web address for a new section of this kind: turf, turf-2, turf-3…
create function private.section_slug(p_organization_id uuid, p_kind public.business_type)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_base text := case p_kind when 'turf' then 'turf' when 'boardgame_cafe' then 'cafe' else 'lounge' end;
  v_slug text := v_base;
  v_n int := 1;
begin
  while exists (select 1 from public.sections where organization_id = p_organization_id and slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

-- ── New section columns, filled from the organization ────────────────────────
alter table public.sections
  add column kind public.business_type,
  add column slug text,
  add column booking_horizon_days smallint,
  add column cancel_cutoff_minutes int,
  add column match_cutoff_minutes int,
  add column max_upcoming_bookings smallint,
  add column accent text,
  add column position smallint;

do $$
declare
  r record;
begin
  for r in
    select s.id, s.organization_id, o.business_type
    from public.sections s join public.organizations o on o.id = s.organization_id
    order by s.organization_id, s.created_at, s.id
  loop
    update public.sections
    set kind = r.business_type, slug = private.section_slug(r.organization_id, r.business_type)
    where id = r.id;
  end loop;
end $$;

update public.sections s
set booking_horizon_days = o.booking_horizon_days,
    cancel_cutoff_minutes = o.cancel_cutoff_minutes,
    match_cutoff_minutes = o.match_cutoff_minutes,
    max_upcoming_bookings = o.max_upcoming_bookings,
    accent = private.kind_accent(s.kind),
    position = x.n
from public.organizations o,
     (select id, row_number() over (partition by organization_id order by created_at, id) as n from public.sections) x
where o.id = s.organization_id and x.id = s.id;

alter table public.sections
  alter column kind set not null,
  alter column slug set not null,
  alter column booking_horizon_days set default 14,
  alter column booking_horizon_days set not null,
  alter column cancel_cutoff_minutes set default 120,
  alter column cancel_cutoff_minutes set not null,
  alter column match_cutoff_minutes set default 360,
  alter column match_cutoff_minutes set not null,
  alter column max_upcoming_bookings set default 3,
  alter column max_upcoming_bookings set not null,
  alter column accent set default '#15803D',
  alter column accent set not null,
  alter column position set default 0,
  alter column position set not null,
  add constraint sections_slug_check check (
    slug ~ '^[a-z][a-z0-9-]{1,30}$'
    and slug not in ('me', 'signin', 'offers', 'sessions', 'manage', 'auth', 'api', 'book')
  ),
  add constraint sections_organization_id_slug_key unique (organization_id, slug),
  add constraint sections_booking_horizon_days_check check (booking_horizon_days between 1 and 90),
  add constraint sections_cancel_cutoff_minutes_check check (cancel_cutoff_minutes between 0 and 10080),
  add constraint sections_match_cutoff_minutes_check check (match_cutoff_minutes between 0 and 10080),
  add constraint sections_max_upcoming_bookings_check check (max_upcoming_bookings between 1 and 20),
  add constraint sections_cutoffs_check check (match_cutoff_minutes > cancel_cutoff_minutes),
  add constraint sections_accent_check check (accent ~ '^#[0-9A-Fa-f]{6}$');

-- ── The brand keeps the address; the rules leave it ──────────────────────────
alter table public.organizations add column address text not null default '';
update public.organizations o
set address = first.address
from (select distinct on (organization_id) organization_id, address from public.sections order by organization_id, created_at, id) first
where first.organization_id = o.id;
alter table public.sections drop column address;
alter table public.organizations
  drop column booking_horizon_days,
  drop column cancel_cutoff_minutes,
  drop column match_cutoff_minutes,
  drop column max_upcoming_bookings,
  alter column business_type drop not null;
grant select (address) on public.organizations to anon;
grant update (address) on public.organizations to authenticated;

-- ── add_section ──────────────────────────────────────────────────────────────
-- A new section of a kind: the next free slug, the kind's accent, the next position, default rules.
-- Locks the organization so two at once can't take the same slug or position.
create function public.add_section(p_organization_id uuid, p_kind public.business_type, p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform 1 from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'invalid_reference';
  end if;
  insert into public.sections (organization_id, name, kind, slug, accent, position)
  values (p_organization_id, p_name, p_kind, private.section_slug(p_organization_id, p_kind), private.kind_accent(p_kind),
          coalesce((select max(position) from public.sections where organization_id = p_organization_id), 0) + 1)
  returning id into v_id;
  return v_id;
end;
$$;

-- ── Functions that named branches, now on sections ───────────────────────────
create or replace function private.seat_payload(p_group_id uuid, p_seat_no smallint)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'session_id', s.id, 'activity_name', a.name, 'resource_name', r.name, 'section_name', br.name,
    'starts_at', s.starts_at, 'ends_at', s.ends_at, 'team', private.seat_team(g.id, p_seat_no),
    'price_poisha', s.seat_price_poisha)
  from public.groups g
  join public.open_play_sessions s on s.id = g.session_id
  join public.activities a on a.id = g.activity_id
  join public.resources r on r.id = g.resource_id
  join public.sections br on br.id = s.section_id
  where g.id = p_group_id;
$$;

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

  if p_profile_id is not null then
    -- Lock the player so two bookings at once can't both slip under the limit.
    perform 1 from public.player_profiles p
    where p.id = p_profile_id and p.organization_id = p_organization_id
    for update;
    if not found then
      return query select 'invalid'::text, null::uuid;
      return;
    end if;
    -- The limit is the space's section's, and counts that player's bookings in the same section.
    v_limit := v_resource.max_upcoming_bookings;
    select count(*) into v_upcoming
    from public.resource_bookings b
    join public.resources rr on rr.id = b.resource_id
    where b.profile_id = p_profile_id and b.status = 'confirmed' and upper(b.period) > now()
      and rr.section_id = v_resource.section_id;
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
      jsonb_build_object('booking_id', v_id, 'resource_name', v_resource.name, 'section_name', v_resource.section_name, 'starts_at', lower(v_period),
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

create or replace function public.create_offer(p_group_id uuid, p_seat_no smallint, p_waitlist_entry_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.open_play_sessions;
  g public.groups;
  e public.waitlist_entries;
  v_expires_at timestamptz;
  v_offer_id uuid;
begin
  select * into s from public.open_play_sessions
  where id = (select session_id from public.groups where id = p_group_id)
  for share;
  select * into g from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group_not_found';
  end if;
  if s.status not in ('open', 'matched') or s.starts_at <= now() then
    raise exception 'session_closed';
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

  -- Never past the start: a seat can't be taken once the game is on.
  select least(now() + make_interval(secs => b.offer_ttl_seconds), s.starts_at) into v_expires_at
  from public.sections b where b.id = s.section_id;

  update public.waitlist_entries set status = 'offered' where id = e.id;
  insert into public.seat_offers (organization_id, group_id, seat_no, waitlist_entry_id, expires_at)
  values (g.organization_id, g.id, p_seat_no, e.id, v_expires_at)
  returning id into v_offer_id;
  insert into public.events (organization_id, session_id, type, payload)
  values (g.organization_id, g.session_id, 'offer_created',
          jsonb_build_object('offer_id', v_offer_id, 'profile_id', e.profile_id, 'group_id', g.id,
                             'seat_no', p_seat_no, 'expires_at', v_expires_at));
  insert into public.notifications (organization_id, profile_id, kind, payload, link)
  values (g.organization_id, e.profile_id, 'offer',
          private.seat_payload(g.id, p_seat_no) || jsonb_build_object('offer_id', v_offer_id, 'expires_at', v_expires_at),
          '/me/offers/' || v_offer_id);
  return v_offer_id;
end;
$$;

-- The parameter is renamed (p_branch_id → p_section_id), which create or replace can't do.
drop function public.schedule_open_play(uuid, uuid, uuid, uuid[], timestamptz[], int, int);
create function public.schedule_open_play(
  p_organization_id uuid,
  p_section_id uuid,
  p_activity_id uuid,
  p_resource_ids uuid[],
  p_starts_at timestamptz[],
  p_duration_min int,
  p_seat_price_poisha int
)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_resources uuid[];
  v_start timestamptz;
  v_end timestamptz;
  v_session_id uuid;
  v_ids uuid[] := '{}';
begin
  select coalesce(array_agg(distinct r), '{}') into v_resources from unnest(p_resource_ids) as r;
  if cardinality(v_resources) = 0 then
    raise exception 'no_resources';
  end if;
  if coalesce(cardinality(p_starts_at), 0) = 0 then
    raise exception 'no_starts';
  end if;

  if not exists (select 1 from public.sections where id = p_section_id and organization_id = p_organization_id) then
    raise exception 'invalid_reference';
  end if;
  if p_activity_id is not null
     and not exists (select 1 from public.activities where id = p_activity_id and organization_id = p_organization_id) then
    raise exception 'invalid_reference';
  end if;
  if (select count(*) from public.resources
      where id = any (v_resources) and organization_id = p_organization_id
        and section_id = p_section_id and active) <> cardinality(v_resources) then
    raise exception 'invalid_reference';
  end if;

  foreach v_start in array p_starts_at loop
    v_end := v_start + make_interval(mins => p_duration_min);

    insert into public.open_play_sessions (organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha)
    values (p_organization_id, p_section_id, p_activity_id, v_start, v_end, p_seat_price_poisha)
    returning id into v_session_id;

    insert into public.open_play_session_resources (organization_id, session_id, resource_id)
    select p_organization_id, v_session_id, r from unnest(v_resources) as r;

    insert into public.resource_reservations (organization_id, resource_id, period, source, source_id)
    select p_organization_id, r, tstzrange(v_start, v_end, '[)'), 'session', v_session_id
    from unnest(v_resources) as r;

    v_ids := v_ids || v_session_id;
  end loop;

  return v_ids;
end;
$$;

create or replace function public.sessions_due_for_matching(p_limit int)
returns table (session_id uuid, organization_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.organization_id
  from public.open_play_sessions s
  join public.sections sec on sec.id = s.section_id
  where s.status = 'open'
    and s.starts_at > now()
    and s.starts_at - make_interval(mins => sec.match_cutoff_minutes) <= now()
    and (select count(*) from public.seat_requests r where r.session_id = s.id) >= (
      select min(case when a.team_mode = 'two_teams' then 2 * a.team_size else a.min_players end)
      from public.activities a
      where case when s.activity_id is null then a.organization_id = s.organization_id and a.active else a.id = s.activity_id end
    )
  order by s.starts_at, s.id
  limit p_limit;
$$;

revoke execute on function
  private.kind_accent(public.business_type),
  private.section_slug(uuid, public.business_type),
  public.add_section(uuid, public.business_type, text),
  public.schedule_open_play(uuid, uuid, uuid, uuid[], timestamptz[], int, int)
from public, anon, authenticated;

grant execute on function
  private.kind_accent(public.business_type),
  private.section_slug(uuid, public.business_type),
  public.add_section(uuid, public.business_type, text),
  public.schedule_open_play(uuid, uuid, uuid, uuid[], timestamptz[], int, int)
to service_role;
