-- One Brand R1: games and player ratings per section (spec §2.2, §2.4, §3).
--
-- Each game belongs to one section (activities.section_id). A player's single skill becomes one
-- rating per section (profile_section_skills); existing skills are copied to every section of the
-- player's brand. request_seat asks for a rating first (needs_skill); schedules, matches and the
-- "smallest game" of a players-choose session only consider the session's section, and a player's
-- favourites count per section ("no favourites here" means any game here).

-- ── Games per section ────────────────────────────────────────────────────────
-- A brand with games but no section yet gets one first (none exist today; this keeps the move total).
do $$
declare
  r record;
begin
  for r in
    select distinct a.organization_id, o.business_type
    from public.activities a join public.organizations o on o.id = a.organization_id
    where not exists (select 1 from public.sections s where s.organization_id = a.organization_id)
  loop
    perform public.add_section(r.organization_id, coalesce(r.business_type, 'turf'), 'Main');
  end loop;
end $$;

alter table public.activities add column section_id uuid;
update public.activities a
set section_id = (select s.id from public.sections s where s.organization_id = a.organization_id
                  order by s.position, s.created_at, s.id limit 1);
alter table public.activities
  alter column section_id set not null,
  add constraint activities_section_id_fkey foreign key (section_id, organization_id)
    references public.sections (id, organization_id) on delete no action;
create index activities_section_id_idx on public.activities (section_id);

-- ── Ratings per section ──────────────────────────────────────────────────────
create table public.profile_section_skills (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null,
  section_id uuid not null,
  skill smallint not null check (skill between 1 and 5),
  primary key (profile_id, section_id),
  constraint profile_section_skills_profile_id_fkey foreign key (profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade,
  constraint profile_section_skills_section_id_fkey foreign key (section_id, organization_id)
    references public.sections (id, organization_id) on delete cascade
);
create index profile_section_skills_section_id_idx on public.profile_section_skills (section_id);
create index profile_section_skills_organization_id_idx on public.profile_section_skills (organization_id);

alter table public.profile_section_skills enable row level security;
revoke all on public.profile_section_skills from anon, authenticated;
grant select, insert, delete on public.profile_section_skills to authenticated;
grant update (skill) on public.profile_section_skills to authenticated;
grant all on public.profile_section_skills to service_role;

-- Players manage their own ratings; the brand's owner and staff can read them.
create policy profile_section_skills_select on public.profile_section_skills for select to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)) or (select private.is_org_member(organization_id)));
create policy profile_section_skills_insert on public.profile_section_skills for insert to authenticated
  with check ((select private.is_own_profile(profile_id, organization_id)));
create policy profile_section_skills_update on public.profile_section_skills for update to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)))
  with check ((select private.is_own_profile(profile_id, organization_id)));
create policy profile_section_skills_delete on public.profile_section_skills for delete to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)));

insert into public.profile_section_skills (organization_id, profile_id, section_id, skill)
select p.organization_id, p.id, s.id, p.skill
from public.player_profiles p
join public.sections s on s.organization_id = p.organization_id;
alter table public.player_profiles drop column skill;

-- ── Favourites count per section ─────────────────────────────────────────────
-- Does this player want this game? Yes for a fixed-activity session, for a favourite, and when the
-- player has no favourites among this game's section (favourites elsewhere don't narrow it down).
create or replace function private.wants_game(p_profile_id uuid, p_activity_id uuid, p_fixed_activity_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_fixed_activity_id is not null
      or exists (select 1 from public.profile_activities pa where pa.profile_id = p_profile_id and pa.activity_id = p_activity_id)
      or not exists (
        select 1
        from public.profile_activities pa
        join public.activities fav on fav.id = pa.activity_id
        join public.activities game on game.id = p_activity_id
        where pa.profile_id = p_profile_id and fav.section_id = game.section_id
      );
$$;

-- ── Functions that now look at the section ───────────────────────────────────
create or replace function public.request_seat(p_session_id uuid, p_profile_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.open_play_sessions;
  v_priority smallint := 0;
  v_prev record;
  v_group_id uuid;
  v_seat smallint;
begin
  select * into s from public.open_play_sessions where id = p_session_id for update;
  if not found then
    return 'invalid';
  elsif s.status not in ('open', 'matched') or s.starts_at <= now() then
    return 'closed';
  end if;
  if not exists (select 1 from public.player_profiles where id = p_profile_id and organization_id = s.organization_id) then
    return 'invalid';
  end if;
  if exists (select 1 from public.bookings where session_id = s.id and profile_id = p_profile_id and status <> 'cancelled')
     or exists (select 1 from public.waitlist_entries
                where session_id = s.id and profile_id = p_profile_id and status in ('waiting', 'offered')) then
    return 'already';
  end if;
  -- Matching and refills use the player's rating for this section; ask for one first.
  if not exists (select 1 from public.profile_section_skills where profile_id = p_profile_id and section_id = s.section_id) then
    return 'needs_skill';
  end if;

  if s.status = 'open' then
    if exists (select 1 from public.seat_requests where session_id = s.id and profile_id = p_profile_id) then
      return 'already';
    end if;
    -- Priority 1 when the player's last earlier session here was played without them.
    select ps.status, exists (select 1 from public.bookings b where b.session_id = ps.id and b.profile_id = p_profile_id) as seated
    into v_prev
    from public.seat_requests r
    join public.open_play_sessions ps on ps.id = r.session_id
    where r.profile_id = p_profile_id and r.organization_id = s.organization_id and ps.starts_at < s.starts_at
    order by ps.starts_at desc
    limit 1;
    if found and v_prev.status in ('matched', 'closed') and not v_prev.seated then
      v_priority := 1;
    end if;
    insert into public.seat_requests (organization_id, session_id, profile_id, priority)
    values (s.organization_id, s.id, p_profile_id, v_priority);
    return 'requested';
  end if;

  -- After matching: a free seat goes to a late request only when nobody waiting wants that game.
  perform 1 from public.groups where session_id = s.id order by id for update;
  select g.id, n::smallint into v_group_id, v_seat
  from public.groups g
  cross join lateral generate_series(1, g.capacity) as n
  where g.session_id = s.id
    and private.wants_game(p_profile_id, g.activity_id, s.activity_id)
    and not exists (select 1 from public.waitlist_entries w
                    where w.session_id = s.id and w.status = 'waiting'
                      and private.wants_game(w.profile_id, g.activity_id, s.activity_id))
    and not exists (select 1 from public.bookings b where b.group_id = g.id and b.seat_no = n and b.status <> 'cancelled')
    and not exists (select 1 from public.seat_offers o where o.group_id = g.id and o.seat_no = n and o.status = 'pending')
  order by g.id, n
  limit 1;
  if found then
    perform private.take_seat(v_group_id, v_seat, p_profile_id, 'direct', 'direct');
    return 'seated';
  end if;

  perform private.join_waitlist(s, p_profile_id, 0::smallint);
  return 'waitlisted';
end;
$$;

create or replace function public.schedule_open_play(
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
     and not exists (select 1 from public.activities where id = p_activity_id and organization_id = p_organization_id
                            and section_id = p_section_id) then
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

create or replace function public.apply_match(p_session_id uuid, p_groups jsonb, p_waitlist jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.open_play_sessions;
  g jsonb;
  seat jsonb;
  v_group_id uuid;
  v_seat smallint;
  v_profile uuid;
  v_priority smallint;
  v_people uuid[];
begin
  select * into s from public.open_play_sessions where id = p_session_id for update;
  if not found then
    return 'not_open';
  elsif s.status = 'matched' then
    return 'already_matched';
  elsif s.status <> 'open' or s.starts_at <= now() then
    return 'not_open';
  elsif p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    return 'no_groups';
  end if;

  -- Everyone in the plan asked for this session, and appears once.
  select coalesce(array_agg(p), '{}') into v_people from (
    select (x ->> 'profile_id')::uuid as p from jsonb_array_elements(p_groups) gr, jsonb_array_elements(gr -> 'seats') x
    union all
    select (w #>> '{}')::uuid from jsonb_array_elements(coalesce(p_waitlist, '[]')) w
  ) people;
  if cardinality(v_people) <> (select count(distinct p) from unnest(v_people) p)
     or exists (select p from unnest(v_people) p
                except select profile_id from public.seat_requests where session_id = s.id) then
    raise exception 'invalid_match';
  end if;

  for g in select * from jsonb_array_elements(p_groups) loop
    -- The space is one of the session's, the game is the venue's (and the session's, when fixed),
    -- the size fits the space (and is exactly two teams for team games), and seats are in range.
    if not exists (select 1 from public.open_play_session_resources sr
                   join public.resources r on r.id = sr.resource_id
                   join public.activities a on a.id = (g ->> 'activity_id')::uuid and a.organization_id = s.organization_id
                                                and a.section_id = s.section_id
                   where sr.session_id = s.id and sr.resource_id = (g ->> 'resource_id')::uuid
                     and (s.activity_id is null or a.id = s.activity_id)
                     and (g ->> 'capacity')::int between 1 and r.capacity
                     and (a.team_mode = 'none' or (g ->> 'capacity')::int = 2 * a.team_size))
       or exists (select 1 from jsonb_array_elements(g -> 'seats') x
                  where (x ->> 'seat_no')::int not between 1 and (g ->> 'capacity')::int) then
      raise exception 'invalid_match';
    end if;

    insert into public.groups (organization_id, session_id, resource_id, activity_id, capacity)
    values (s.organization_id, s.id, (g ->> 'resource_id')::uuid, (g ->> 'activity_id')::uuid, (g ->> 'capacity')::smallint)
    returning id into v_group_id;

    for seat in select * from jsonb_array_elements(g -> 'seats') loop
      v_seat := (seat ->> 'seat_no')::smallint;
      if (seat ->> 'team')::smallint is distinct from private.seat_team(v_group_id, v_seat) then
        raise exception 'invalid_match';
      end if;
      perform private.take_seat(v_group_id, v_seat, (seat ->> 'profile_id')::uuid, 'matched', 'matched');
    end loop;
  end loop;

  -- The waitlist in the plan's order, then anyone the plan didn't mention (a request that raced the match).
  for v_profile, v_priority in
    select (w #>> '{}')::uuid, r.priority
    from jsonb_array_elements(coalesce(p_waitlist, '[]')) with ordinality as t(w, ord)
    join public.seat_requests r on r.session_id = s.id and r.profile_id = (w #>> '{}')::uuid
    order by ord
  loop
    perform private.join_waitlist(s, v_profile, v_priority);
  end loop;
  for v_profile, v_priority in
    select r.profile_id, r.priority from public.seat_requests r
    where r.session_id = s.id and r.profile_id <> all (v_people)
    order by r.priority desc, r.created_at, r.id
  loop
    perform private.join_waitlist(s, v_profile, v_priority);
  end loop;

  update public.open_play_sessions set status = 'matched', matched_at = now() where id = s.id;
  return 'matched';
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
      where case when s.activity_id is null then a.section_id = s.section_id and a.active else a.id = s.activity_id end
    )
  order by s.starts_at, s.id
  limit p_limit;
$$;
