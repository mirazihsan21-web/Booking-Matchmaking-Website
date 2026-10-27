-- One Brand R1 review minors.
-- 1. The repeat-request priority is earned per section: missing a turf game gives priority at the next
--    turf game, not at the café.
-- 2. The section helpers get the explicit execute grants the older private helpers have (revoked from
--    public, granted to the signed-in role whose policies call them).

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
    -- Priority 1 when the player's last earlier session in this section was played without them.
    select ps.status, exists (select 1 from public.bookings b where b.session_id = ps.id and b.profile_id = p_profile_id) as seated
    into v_prev
    from public.seat_requests r
    join public.open_play_sessions ps on ps.id = r.session_id
    where r.profile_id = p_profile_id and r.organization_id = s.organization_id and ps.section_id = s.section_id
      and ps.starts_at < s.starts_at
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

revoke execute on function private.is_section_staff(uuid), private.is_session_staff(uuid), private.is_resource_staff(uuid) from public;
grant execute on function private.is_section_staff(uuid), private.is_session_staff(uuid), private.is_resource_staff(uuid) to authenticated;
