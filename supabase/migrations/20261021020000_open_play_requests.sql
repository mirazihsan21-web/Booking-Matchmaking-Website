-- Stage B2: open-play requests and match application (spec §2.5, §3 B2).
--
-- A player asks for a seat (request_seat). At the venue's cut-off, or on "Match now", the app runs the
-- engine over the requests and hands the plan to apply_match, which writes groups, seats (with teams)
-- and the waitlist in one transaction. Requests made after matching take a free seat directly when
-- nobody is waiting, else join the waitlist. All writes go through these service_role functions.
--
-- Seats and teams: in a two-team group, team 1 sits in seats 1…team_size and team 2 in the rest, so a
-- seat that is refilled keeps its team. Lock order (extends M1): session → offer → group → entry.

alter table public.open_play_sessions add column matched_at timestamptz;
alter table public.bookings add column team smallint check (team in (1, 2));
alter type public.booking_source add value 'direct';

-- Requests and withdrawals go through the server so their rules can't be bypassed (spec §2.5).
drop policy seat_requests_insert on public.seat_requests;
drop policy seat_requests_delete on public.seat_requests;
revoke insert, delete on public.seat_requests from authenticated;

-- ── Shared helpers (service_role only) ──────────────────────────────────────
grant usage on schema private to service_role;

-- The team a seat belongs to: null for free-for-all games.
create function private.seat_team(p_group_id uuid, p_seat_no smallint)
returns smallint
language sql
stable
security invoker
set search_path = ''
as $$
  select case when a.team_mode = 'two_teams' then case when p_seat_no <= a.team_size then 1 else 2 end end::smallint
  from public.groups g
  join public.activities a on a.id = g.activity_id
  where g.id = p_group_id;
$$;

-- What a seat notification says: the session, game, space (and branch when the venue has several),
-- time, team and price. The words are rendered by the app.
create function private.seat_payload(p_group_id uuid, p_seat_no smallint)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'session_id', s.id, 'activity_name', a.name, 'resource_name', r.name, 'branch_name', br.name,
    'multi_branch', (select count(*) > 1 from public.branches x where x.organization_id = s.organization_id),
    'starts_at', s.starts_at, 'ends_at', s.ends_at, 'team', private.seat_team(g.id, p_seat_no),
    'price_poisha', s.seat_price_poisha)
  from public.groups g
  join public.open_play_sessions s on s.id = g.session_id
  join public.activities a on a.id = g.activity_id
  join public.resources r on r.id = g.resource_id
  join public.branches br on br.id = s.branch_id
  where g.id = p_group_id;
$$;

-- What a session-level notification says: the session, its fixed game (null when players choose) and time.
create function private.session_payload(p_session_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('session_id', s.id, 'activity_name', a.name, 'starts_at', s.starts_at)
  from public.open_play_sessions s
  left join public.activities a on a.id = s.activity_id
  where s.id = p_session_id;
$$;

-- Puts a player at the back of the session's waitlist (re-using their old entry) and tells them.
-- The caller holds the session lock.
create function private.join_waitlist(p_session public.open_play_sessions, p_profile_id uuid, p_priority smallint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_position int;
  v_shown int;
begin
  select coalesce(max(queue_position), 0) + 1 into v_position
  from public.waitlist_entries where session_id = p_session.id;

  insert into public.waitlist_entries (organization_id, session_id, profile_id, priority, queue_position, status)
  values (p_session.organization_id, p_session.id, p_profile_id, p_priority, v_position, 'waiting')
  on conflict (session_id, profile_id)
  do update set status = 'waiting', queue_position = excluded.queue_position, created_at = now();

  select count(*) into v_shown from public.waitlist_entries
  where session_id = p_session.id and status in ('waiting', 'offered') and queue_position <= v_position;

  insert into public.notifications (organization_id, profile_id, kind, payload, link)
  values (p_session.organization_id, p_profile_id, 'waitlisted',
          private.session_payload(p_session.id) || jsonb_build_object('position', v_shown),
          '/sessions/' || p_session.id);
end;
$$;

-- Books a seat in a group and tells the player. `via` is matched | direct | offer.
create function private.take_seat(p_group_id uuid, p_seat_no smallint, p_profile_id uuid, p_source public.booking_source, p_via text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking_id uuid;
  v_session public.open_play_sessions;
begin
  select s.* into v_session from public.open_play_sessions s join public.groups g on g.session_id = s.id where g.id = p_group_id;

  insert into public.bookings (organization_id, session_id, group_id, profile_id, seat_no, status, source, price_poisha, team)
  values (v_session.organization_id, v_session.id, p_group_id, p_profile_id, p_seat_no, 'confirmed', p_source,
          v_session.seat_price_poisha, private.seat_team(p_group_id, p_seat_no))
  returning id into v_booking_id;

  insert into public.notifications (organization_id, profile_id, kind, payload, link)
  values (v_session.organization_id, p_profile_id, 'seat_confirmed',
          private.seat_payload(p_group_id, p_seat_no) || jsonb_build_object('booking_id', v_booking_id, 'via', p_via),
          '/sessions/' || v_session.id);
  return v_booking_id;
end;
$$;

-- ── request_seat ─────────────────────────────────────────────────────────────
-- Returns: requested | seated | waitlisted | already | closed | invalid
create function public.request_seat(p_session_id uuid, p_profile_id uuid)
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

  -- After matching: a free seat goes to a late request only when nobody is waiting for one.
  if not exists (select 1 from public.waitlist_entries where session_id = s.id and status = 'waiting') then
    perform 1 from public.groups where session_id = s.id order by id for update;
    select g.id, n::smallint into v_group_id, v_seat
    from public.groups g
    cross join lateral generate_series(1, g.capacity) as n
    where g.session_id = s.id
      and (s.activity_id is not null
           or not exists (select 1 from public.profile_activities pa where pa.profile_id = p_profile_id)
           or exists (select 1 from public.profile_activities pa where pa.profile_id = p_profile_id and pa.activity_id = g.activity_id))
      and not exists (select 1 from public.bookings b where b.group_id = g.id and b.seat_no = n and b.status <> 'cancelled')
      and not exists (select 1 from public.seat_offers o where o.group_id = g.id and o.seat_no = n and o.status = 'pending')
    order by g.id, n
    limit 1;
    if found then
      perform private.take_seat(v_group_id, v_seat, p_profile_id, 'direct', 'direct');
      return 'seated';
    end if;
  end if;

  perform private.join_waitlist(s, p_profile_id, 0::smallint);
  return 'waitlisted';
end;
$$;

-- ── withdraw_request ─────────────────────────────────────────────────────────
-- Returns: withdrawn | has_offer | closed | not_found. A seated player cancels their booking instead.
create function public.withdraw_request(p_session_id uuid, p_profile_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.open_play_sessions;
  e public.waitlist_entries;
begin
  select * into s from public.open_play_sessions where id = p_session_id for update;
  if not found then
    return 'not_found';
  elsif s.status not in ('open', 'matched') or s.starts_at <= now() then
    return 'closed';
  end if;

  if s.status = 'open' then
    delete from public.seat_requests where session_id = s.id and profile_id = p_profile_id;
    return case when found then 'withdrawn' else 'not_found' end;
  end if;

  select * into e from public.waitlist_entries where session_id = s.id and profile_id = p_profile_id for update;
  if not found or e.status not in ('waiting', 'offered') then
    return 'not_found';
  elsif e.status = 'offered' then
    return 'has_offer';
  end if;
  update public.waitlist_entries set status = 'withdrawn' where id = e.id;
  return 'withdrawn';
end;
$$;

-- ── apply_match ──────────────────────────────────────────────────────────────
-- p_groups: [{resource_id, activity_id, capacity, seats: [{profile_id, seat_no, team}]}]
-- p_waitlist: [profile_id, …] in queue order.
-- Returns: matched | already_matched | not_open | no_groups. A plan that breaks the rules raises invalid_match.
create function public.apply_match(p_session_id uuid, p_groups jsonb, p_waitlist jsonb)
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

revoke execute on function
  private.seat_team(uuid, smallint),
  private.seat_payload(uuid, smallint),
  private.session_payload(uuid),
  private.join_waitlist(public.open_play_sessions, uuid, smallint),
  private.take_seat(uuid, smallint, uuid, public.booking_source, text),
  public.request_seat(uuid, uuid),
  public.withdraw_request(uuid, uuid),
  public.apply_match(uuid, jsonb, jsonb)
from public, anon, authenticated;

grant execute on function
  private.seat_team(uuid, smallint),
  private.seat_payload(uuid, smallint),
  private.session_payload(uuid),
  private.join_waitlist(public.open_play_sessions, uuid, smallint),
  private.take_seat(uuid, smallint, uuid, public.booking_source, text),
  public.request_seat(uuid, uuid),
  public.withdraw_request(uuid, uuid),
  public.apply_match(uuid, jsonb, jsonb)
to service_role;
