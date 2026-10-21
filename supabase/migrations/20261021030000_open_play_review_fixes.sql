-- Stage B2 final-review fixes.
--
-- 1. A late request takes a free seat when nobody *waiting wants that seat's game* (spec §3 "only if
--    nobody is waiting" read per seat): in a players-choose session, someone waiting for Azul no longer
--    blocks a free Catan seat forever. For a fixed-activity session every waiting player wants the game,
--    so the rule is unchanged there.
-- 2. unoffered_free_seats: free seats of live matched sessions with no pending offer while someone who
--    wants that game is waiting — a hand-off lost to a failure (or never made). The tick offers them on.
-- 3. sessions_due_for_matching: open sessions past their match cut-off with at least enough requests
--    to form the smallest group they could host, so sessions that can't fill don't use up the tick's cap.

-- Does this player want this game? Yes for a fixed-activity session, for a player with no favourites,
-- and for a favourite.
create function private.wants_game(p_profile_id uuid, p_activity_id uuid, p_fixed_activity_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_fixed_activity_id is not null
      or not exists (select 1 from public.profile_activities pa where pa.profile_id = p_profile_id)
      or exists (select 1 from public.profile_activities pa where pa.profile_id = p_profile_id and pa.activity_id = p_activity_id);
$$;

-- Returns: requested | seated | waitlisted | already | closed | invalid
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

-- Free seats of live matched sessions that have no pending offer although someone waiting wants
-- their game. Soonest sessions first.
create function public.unoffered_free_seats(p_limit int)
returns table (group_id uuid, seat_no smallint)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.id, n::smallint
  from public.open_play_sessions s
  join public.groups g on g.session_id = s.id
  cross join lateral generate_series(1, g.capacity) as n
  where s.status = 'matched' and s.starts_at > now()
    and not exists (select 1 from public.bookings b where b.group_id = g.id and b.seat_no = n and b.status <> 'cancelled')
    and not exists (select 1 from public.seat_offers o where o.group_id = g.id and o.seat_no = n and o.status = 'pending')
    and exists (select 1 from public.waitlist_entries w
                where w.session_id = s.id and w.status = 'waiting'
                  and private.wants_game(w.profile_id, g.activity_id, s.activity_id))
  order by s.starts_at, g.id, n
  limit p_limit;
$$;

-- Open sessions past their venue's match cut-off, with at least as many requests as the smallest
-- group they could form (both teams for a team game). Soonest first.
create function public.sessions_due_for_matching(p_limit int)
returns table (session_id uuid, organization_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.organization_id
  from public.open_play_sessions s
  join public.organizations o on o.id = s.organization_id
  where s.status = 'open'
    and s.starts_at > now()
    and s.starts_at - make_interval(mins => o.match_cutoff_minutes) <= now()
    and (select count(*) from public.seat_requests r where r.session_id = s.id) >= (
      select min(case when a.team_mode = 'two_teams' then 2 * a.team_size else a.min_players end)
      from public.activities a
      where case when s.activity_id is null then a.organization_id = s.organization_id and a.active else a.id = s.activity_id end
    )
  order by s.starts_at, s.id
  limit p_limit;
$$;

revoke execute on function
  private.wants_game(uuid, uuid, uuid),
  public.unoffered_free_seats(int),
  public.sessions_due_for_matching(int)
from public, anon, authenticated;

grant execute on function
  private.wants_game(uuid, uuid, uuid),
  public.unoffered_free_seats(int),
  public.sessions_due_for_matching(int)
to service_role;
