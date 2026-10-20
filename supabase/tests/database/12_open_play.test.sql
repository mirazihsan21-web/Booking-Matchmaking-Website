-- Open play: request_seat / withdraw_request / apply_match (Stage B2).
-- Org P (…12a0) has Pitch 1 + Pitch 2 (14 each) and Table 1 (4); activities 5-a-side (two teams of 5),
-- Catan (3–4) and Azul (2–4). Players are pg_temp.p(1…21); pg_temp.p(30) belongs to org X.
-- Sessions: S1 5-a-side two days ahead on both pitches; S2 players-choose on Table 1; S3 cancelled;
-- S4 already started; S5 open (no_groups / invalid_match); S0 matched three days ago (priority rule).
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

create function pg_temp.p(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000001201' || lpad(to_hex(n), 2, '0'))::uuid;
$$;
create function pg_temp.s(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000012f' || n)::uuid;
$$;

insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000001200' || lpad(to_hex(n), 2, '0'))::uuid, 'op-' || n || '@test.local'
from generate_series(1, 30) n;
insert into public.organizations (id, slug, name, business_type, status) values
  ('00000000-0000-4000-8000-0000000012a0', 'op-org-p', 'Org P', 'turf', 'live'),
  ('00000000-0000-4000-8000-0000000012a9', 'op-org-x', 'Org X', 'turf', 'live');
insert into public.branches (id, organization_id, name) values
  ('00000000-0000-4000-8000-0000000012b0', '00000000-0000-4000-8000-0000000012a0', 'Main');
insert into public.resources (id, organization_id, branch_id, name, kind, capacity) values
  ('00000000-0000-4000-8000-0000000012c1', '00000000-0000-4000-8000-0000000012a0', '00000000-0000-4000-8000-0000000012b0', 'Pitch 1', 'pitch', 14),
  ('00000000-0000-4000-8000-0000000012c2', '00000000-0000-4000-8000-0000000012a0', '00000000-0000-4000-8000-0000000012b0', 'Pitch 2', 'pitch', 14),
  ('00000000-0000-4000-8000-0000000012c3', '00000000-0000-4000-8000-0000000012a0', '00000000-0000-4000-8000-0000000012b0', 'Table 1', 'table', 4);
insert into public.activities (id, organization_id, name, min_players, max_players, duration_min, team_mode, team_size) values
  ('00000000-0000-4000-8000-0000000012d1', '00000000-0000-4000-8000-0000000012a0', '5-a-side', 10, 10, 60, 'two_teams', 5),
  ('00000000-0000-4000-8000-0000000012d2', '00000000-0000-4000-8000-0000000012a0', 'Catan', 3, 4, 90, 'none', null),
  ('00000000-0000-4000-8000-0000000012d3', '00000000-0000-4000-8000-0000000012a0', 'Azul', 2, 4, 45, 'none', null);
insert into public.player_profiles (id, organization_id, user_id, display_name, skill)
select pg_temp.p(n), '00000000-0000-4000-8000-0000000012a0',
       ('00000000-0000-4000-8000-0000001200' || lpad(to_hex(n), 2, '0'))::uuid, 'P' || n, 1 + n % 5
from generate_series(1, 21) n;
insert into public.player_profiles (id, organization_id, user_id, display_name, skill)
values (pg_temp.p(30), '00000000-0000-4000-8000-0000000012a9', '00000000-0000-4000-8000-00000012001e', 'X', 3);
insert into public.profile_activities (organization_id, profile_id, activity_id, rank)
values ('00000000-0000-4000-8000-0000000012a0', pg_temp.p(16), '00000000-0000-4000-8000-0000000012d3', 1);

insert into public.open_play_sessions (id, organization_id, branch_id, activity_id, starts_at, ends_at, seat_price_poisha, status)
select pg_temp.s(n), '00000000-0000-4000-8000-0000000012a0', '00000000-0000-4000-8000-0000000012b0', act,
       now() + starts, now() + starts + interval '1 hour', 30000, st::public.session_status
from (values
  (1, '00000000-0000-4000-8000-0000000012d1'::uuid, interval '2 days', 'open'),
  (2, null, interval '2 days', 'open'),
  (3, '00000000-0000-4000-8000-0000000012d1', interval '2 days', 'cancelled'),
  (4, '00000000-0000-4000-8000-0000000012d1', interval '-10 minutes', 'open'),
  (5, '00000000-0000-4000-8000-0000000012d1', interval '3 days', 'open'),
  (0, '00000000-0000-4000-8000-0000000012d1', interval '-3 days', 'matched')
) as v(n, act, starts, st);
insert into public.open_play_session_resources (organization_id, session_id, resource_id) values
  ('00000000-0000-4000-8000-0000000012a0', pg_temp.s(1), '00000000-0000-4000-8000-0000000012c1'),
  ('00000000-0000-4000-8000-0000000012a0', pg_temp.s(1), '00000000-0000-4000-8000-0000000012c2'),
  ('00000000-0000-4000-8000-0000000012a0', pg_temp.s(2), '00000000-0000-4000-8000-0000000012c3'),
  ('00000000-0000-4000-8000-0000000012a0', pg_temp.s(5), '00000000-0000-4000-8000-0000000012c1');
-- P17 asked for S0, which matched three days ago without seating them.
insert into public.seat_requests (organization_id, session_id, profile_id)
values ('00000000-0000-4000-8000-0000000012a0', pg_temp.s(0), pg_temp.p(17));

-- ── request_seat before matching ─────────────────────────────────────────────
select is(public.request_seat(pg_temp.s(1), pg_temp.p(1)), 'requested', 'a player asks for a seat');
select is(public.request_seat(pg_temp.s(1), pg_temp.p(1)), 'already', 'asking twice answers already');
select is(public.request_seat(pg_temp.s(1), pg_temp.p(30)), 'invalid', 'another venue''s player is refused');
select is(public.request_seat(pg_temp.s(3), pg_temp.p(1)), 'closed', 'a cancelled session is closed');
select is(public.request_seat(pg_temp.s(4), pg_temp.p(1)), 'closed', 'a session that has started is closed');
select is(public.request_seat(pg_temp.s(5), pg_temp.p(17)), 'requested', 'the unlucky player asks for the next session');
select is((select priority::int from public.seat_requests where session_id = pg_temp.s(5) and profile_id = pg_temp.p(17)), 1,
  'missing out on the last matched session gives priority 1');
select is((select priority::int from public.seat_requests where session_id = pg_temp.s(1) and profile_id = pg_temp.p(1)), 0,
  'a first request has priority 0');

do $$ begin perform public.request_seat(pg_temp.s(1), pg_temp.p(n)) from generate_series(2, 13) n; end $$;

-- ── apply_match ─────────────────────────────────────────────────────────────
create temp table plan1 as select
  jsonb_build_array(jsonb_build_object(
    'resource_id', '00000000-0000-4000-8000-0000000012c1', 'activity_id', '00000000-0000-4000-8000-0000000012d1', 'capacity', 10,
    'seats', (select jsonb_agg(jsonb_build_object('profile_id', pg_temp.p(n), 'seat_no', n, 'team', case when n <= 5 then 1 else 2 end) order by n)
              from generate_series(1, 10) n))) as groups,
  jsonb_build_array(pg_temp.p(11), pg_temp.p(12)) as waitlist;

select is(public.apply_match(pg_temp.s(1), (select groups from plan1), (select waitlist from plan1)), 'matched', 'a valid plan is applied');
select is((select count(*)::int from public.bookings where session_id = pg_temp.s(1) and source = 'matched' and price_poisha = 30000), 10,
  'ten seats are booked at the seat price');
select is((select count(*)::int from public.bookings
           where session_id = pg_temp.s(1) and team = case when seat_no <= 5 then 1 else 2 end), 10,
  'seats 1–5 are team 1 and seats 6–10 team 2');
select results_eq(
  $$ select profile_id, queue_position from public.waitlist_entries where session_id = pg_temp.s(1) order by queue_position $$,
  $$ values (pg_temp.p(11), 1), (pg_temp.p(12), 2), (pg_temp.p(13), 3) $$,
  'the waitlist keeps the plan''s order, and a request the plan missed is appended'
);
select ok((select status = 'matched' and matched_at is not null from public.open_play_sessions where id = pg_temp.s(1)),
  'the session is matched');
select is((select count(*)::int from public.notifications where kind = 'seat_confirmed' and payload->>'session_id' = pg_temp.s(1)::text), 10,
  'each seated player is notified');
select is((select count(*)::int from public.notifications where kind = 'waitlisted' and payload->>'session_id' = pg_temp.s(1)::text), 3,
  'each waitlisted player is notified, including the appended one');
select is(
  (select payload->>'team' || ' ' || (payload->>'via') || ' ' || (payload->>'resource_name') || ' ' || (payload->>'activity_name') || ' ' || link
   from public.notifications where kind = 'seat_confirmed' and profile_id = pg_temp.p(6)),
  '2 matched Pitch 1 5-a-side /sessions/' || pg_temp.s(1),
  'the confirmation names the team, pitch and activity, and links to the session'
);
select is(public.apply_match(pg_temp.s(1), (select groups from plan1), (select waitlist from plan1)), 'already_matched',
  'applying twice answers already_matched');
select is(public.apply_match(pg_temp.s(5), '[]', '[]'), 'no_groups', 'an empty plan answers no_groups');
select ok((select status = 'open' and matched_at is null from public.open_play_sessions where id = pg_temp.s(5))
          and not exists (select 1 from public.groups where session_id = pg_temp.s(5)),
  'and writes nothing');
select throws_ok(
  format($$ select public.apply_match(%L, %L, '[]') $$, pg_temp.s(5), jsonb_build_array(jsonb_build_object(
    'resource_id', '00000000-0000-4000-8000-0000000012c1', 'activity_id', '00000000-0000-4000-8000-0000000012d1', 'capacity', 10,
    'seats', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.p(1), 'seat_no', 1, 'team', 1))))),
  'P0001', 'invalid_match', 'a plan seating someone who did not ask is refused'
);

-- ── after matching ──────────────────────────────────────────────────────────
select is(public.request_seat(pg_temp.s(1), pg_temp.p(14)), 'waitlisted', 'a late request joins the waitlist while people wait');
select is((select queue_position from public.waitlist_entries where session_id = pg_temp.s(1) and profile_id = pg_temp.p(14)), 4,
  'at the back');
select is(public.withdraw_request(pg_temp.s(1), pg_temp.p(11)), 'withdrawn', 'a waiting player can withdraw');
do $$ begin perform public.withdraw_request(pg_temp.s(1), pg_temp.p(n)) from generate_series(12, 14) n; end $$;
select is(public.withdraw_request(pg_temp.s(1), pg_temp.p(16)), 'not_found', 'withdrawing without a request answers not_found');
update public.bookings set status = 'cancelled', cancelled_at = now() where session_id = pg_temp.s(1) and profile_id = pg_temp.p(6);
select is(public.request_seat(pg_temp.s(1), pg_temp.p(15)), 'seated', 'with nobody waiting, a late request takes the free seat');
select is((select source::text || ' ' || seat_no || ' ' || team from public.bookings
           where session_id = pg_temp.s(1) and profile_id = pg_temp.p(15) and status = 'confirmed'),
  'direct 6 2', 'directly, in the vacated seat and its team');
select is((select count(*)::int from public.notifications where kind = 'seat_confirmed' and profile_id = pg_temp.p(15) and payload->>'via' = 'direct'), 1,
  'and is notified');
select is(public.request_seat(pg_temp.s(1), pg_temp.p(11)), 'waitlisted', 'asking again after withdrawing works');
select is((select status::text || ' ' || queue_position from public.waitlist_entries where session_id = pg_temp.s(1) and profile_id = pg_temp.p(11)),
  'waiting 5', 'the same entry goes to the back of the queue');

-- ── players-choose session: late requests fit by favourites ────────────────
do $$ begin perform public.request_seat(pg_temp.s(2), pg_temp.p(n)) from generate_series(18, 19) n; end $$;
do $$ begin perform public.apply_match(pg_temp.s(2), jsonb_build_array(jsonb_build_object(
  'resource_id', '00000000-0000-4000-8000-0000000012c3', 'activity_id', '00000000-0000-4000-8000-0000000012d2', 'capacity', 4,
  'seats', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.p(18), 'seat_no', 1, 'team', null),
                             jsonb_build_object('profile_id', pg_temp.p(19), 'seat_no', 2, 'team', null)))), '[]'); end $$;
select is(public.request_seat(pg_temp.s(2), pg_temp.p(15)), 'seated', 'a player with no favourites can take any game''s free seat');
select is((select team from public.bookings where session_id = pg_temp.s(2) and profile_id = pg_temp.p(15) and status = 'confirmed'),
  null::smallint, 'a free-for-all seat has no team');
select is(public.request_seat(pg_temp.s(2), pg_temp.p(16)), 'waitlisted', 'a free seat at a game the player did not pick is not taken');

-- ── grants ──────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000120014","role":"authenticated"}';
select throws_ok(
  format($$ insert into public.seat_requests (organization_id, session_id, profile_id) values ('00000000-0000-4000-8000-0000000012a0', %L, %L) $$,
         pg_temp.s(5), pg_temp.p(20)),
  '42501', null, 'players cannot write requests directly'
);
reset role;
select is_empty(
  $$ select f from unnest(array['public.request_seat(uuid, uuid)', 'public.withdraw_request(uuid, uuid)',
                                'public.apply_match(uuid, jsonb, jsonb)']) as f
     where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
        or not has_function_privilege('service_role', f, 'execute') $$,
  'the open-play functions are service_role only'
);

select * from finish();
rollback;
