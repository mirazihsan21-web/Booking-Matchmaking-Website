-- Open-play scheduling. service_role only (called from server actions after a role check).
--
-- schedule_open_play is all-or-nothing: every start gets a session, its session-resources and one
-- resource_reservations row per resource. If any start overlaps existing reserved time, the exclusion
-- constraint raises 23P01 and nothing from this call is kept.

create function public.schedule_open_play(
  p_organization_id uuid,
  p_branch_id uuid,
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

  if not exists (select 1 from public.branches where id = p_branch_id and organization_id = p_organization_id) then
    raise exception 'invalid_reference';
  end if;
  if p_activity_id is not null
     and not exists (select 1 from public.activities where id = p_activity_id and organization_id = p_organization_id) then
    raise exception 'invalid_reference';
  end if;
  if (select count(*) from public.resources
      where id = any (v_resources) and organization_id = p_organization_id
        and branch_id = p_branch_id and active) <> cardinality(v_resources) then
    raise exception 'invalid_reference';
  end if;

  foreach v_start in array p_starts_at loop
    v_end := v_start + make_interval(mins => p_duration_min);

    insert into public.open_play_sessions (organization_id, branch_id, activity_id, starts_at, ends_at, seat_price_poisha)
    values (p_organization_id, p_branch_id, p_activity_id, v_start, v_end, p_seat_price_poisha)
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

-- Returns: cancelled | not_open | not_found. Cancelling releases the session's reserved time.
create function public.cancel_open_play_session(p_session_id uuid)
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
  elsif s.status <> 'open' then
    return 'not_open';
  end if;

  update public.open_play_sessions set status = 'cancelled' where id = s.id;
  delete from public.resource_reservations where source = 'session' and source_id = s.id;
  return 'cancelled';
end;
$$;

revoke execute on function
  public.schedule_open_play(uuid, uuid, uuid, uuid[], timestamptz[], int, int),
  public.cancel_open_play_session(uuid)
from public, anon, authenticated;

grant execute on function
  public.schedule_open_play(uuid, uuid, uuid, uuid[], timestamptz[], int, int),
  public.cancel_open_play_session(uuid)
to service_role;
