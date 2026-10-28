-- Launch on Vercel (spec docs/superpowers/specs/2026-10-29-vercel-launch-design.md §4).
-- 1. The job tick runs every minute instead of every 10 seconds: on Vercel's free plan each tick is a function
--    call, and a minute keeps matching, offer expiry, closing and email delivery timely at a fraction of the
--    calls. Local and hosted use the same schedule.
-- 2. Games whose start has passed but are still open or matched are closed quietly, once, before the live tick
--    starts — public.close_started_sessions() would otherwise tell their players "no seat" weeks late.

select cron.schedule('tick', '* * * * *', 'select private.trigger_tick()');

-- What close_started_sessions() does at a game's start, without any notification: the game closes, pending
-- seat offers and waiting places expire. Returns how many games it closed.
create function private.close_past_sessions_quietly()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_closed integer;
begin
  with past as (
    update public.open_play_sessions
    set status = 'closed'
    where status in ('open', 'matched') and starts_at <= now()
    returning id
  ), offers as (
    update public.seat_offers o set status = 'expired'
    from public.groups g
    where g.id = o.group_id and g.session_id in (select id from past) and o.status = 'pending'
  ), places as (
    update public.waitlist_entries set status = 'expired'
    where session_id in (select id from past) and status in ('waiting', 'offered')
  )
  select count(*)::integer into v_closed from past;
  return v_closed;
end;
$$;

revoke execute on function private.close_past_sessions_quietly() from public, anon, authenticated;

select private.close_past_sessions_quietly();
