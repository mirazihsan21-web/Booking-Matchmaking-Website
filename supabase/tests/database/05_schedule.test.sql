-- Scheduling open play: all-or-nothing, on reserved resource time.
-- Every count is scoped to org X so the test also passes on a database that already holds venues.
-- Org X (…0aa): branch …0e1, Pitch 1 …0d1, Pitch 2 …0d2, inactive Pitch 3 …0d3, activity …0a1. Org Y (…0bb): Pitch …0d4, activity …0a2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.organizations (id, slug, name, business_type, status) values
  ('00000000-0000-4000-8000-0000000000aa', 'org-x', 'Org X', 'turf', 'live'),
  ('00000000-0000-4000-8000-0000000000bb', 'org-y', 'Org Y', 'turf', 'live');
insert into public.sections (id, organization_id, name, kind, slug) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', 'X main', 'turf', 'x-main'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000bb', 'Y main', 'turf', 'y-main');
insert into public.resources (id, organization_id, section_id, name, kind, capacity, active) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', 'Pitch 1', 'pitch', 14, true),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', 'Pitch 2', 'pitch', 14, true),
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', 'Pitch 3', 'pitch', 14, false),
  ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000e2', 'Y Pitch', 'pitch', 14, true);
insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min, team_mode, team_size) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', '5-a-side', 10, 10, 60, 'two_teams', 5),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000e2', '5-a-side', 10, 10, 60, 'two_teams', 5);

-- Three Fridays on two pitches
select is(
  array_length(public.schedule_open_play(
    '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1',
    array['00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2']::uuid[],
    array['2026-11-06 20:00+06', '2026-11-13 20:00+06', '2026-11-20 20:00+06']::timestamptz[], 60, 30000), 1),
  3, 'schedules three weekly sessions and returns their ids'
);
select is((select count(*)::int from public.open_play_sessions where organization_id = '00000000-0000-4000-8000-0000000000aa'), 3, 'three sessions exist');
select is((select count(*)::int from public.open_play_session_resources where organization_id = '00000000-0000-4000-8000-0000000000aa'), 6, 'each session uses both pitches');
select is((select count(*)::int from public.resource_reservations where source = 'session' and organization_id = '00000000-0000-4000-8000-0000000000aa'), 6, 'each pitch-hour is reserved');

-- Review Focus 4: one clashing week means nothing is created
insert into public.resource_reservations (organization_id, resource_id, period, source, source_id)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000d1',
        tstzrange('2026-12-11 20:00+06', '2026-12-11 21:00+06'), 'booking', gen_random_uuid());
select throws_ok(
  $$ select public.schedule_open_play(
       '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1',
       array['00000000-0000-4000-8000-0000000000d1']::uuid[],
       array['2026-12-04 20:00+06', '2026-12-11 20:00+06', '2026-12-18 20:00+06']::timestamptz[], 60, 30000) $$,
  '23P01', null, 'a repeat that clashes in week 2 is refused'
);
select is((select count(*)::int from public.open_play_sessions where organization_id = '00000000-0000-4000-8000-0000000000aa'), 3, 'and creates nothing for the other weeks');

select lives_ok(
  $$ select public.schedule_open_play(
       '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', null,
       array['00000000-0000-4000-8000-0000000000d1']::uuid[], array['2026-11-06 21:00+06']::timestamptz[], 60, 30000) $$,
  'a back-to-back session is allowed (and the activity may be left to players)'
);

-- References must belong to the organization, the branch, and be active
select throws_ok(
  $$ select public.schedule_open_play(
       '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1',
       array['00000000-0000-4000-8000-0000000000d4']::uuid[], array['2027-01-08 20:00+06']::timestamptz[], 60, 30000) $$,
  'P0001', 'invalid_reference', 'another venue''s pitch is rejected'
);
select throws_ok(
  $$ select public.schedule_open_play(
       '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a2',
       array['00000000-0000-4000-8000-0000000000d1']::uuid[], array['2027-01-08 20:00+06']::timestamptz[], 60, 30000) $$,
  'P0001', 'invalid_reference', 'another venue''s activity is rejected'
);
select throws_ok(
  $$ select public.schedule_open_play(
       '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1',
       array['00000000-0000-4000-8000-0000000000d3']::uuid[], array['2027-01-08 20:00+06']::timestamptz[], 60, 30000) $$,
  'P0001', 'invalid_reference', 'an inactive pitch is rejected'
);
select throws_ok(
  $$ select public.schedule_open_play(
       '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', null,
       array[]::uuid[], array['2027-01-08 20:00+06']::timestamptz[], 60, 30000) $$,
  'P0001', 'no_resources', 'a session needs at least one resource'
);
select throws_ok(
  $$ select public.schedule_open_play(
       '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', null,
       array['00000000-0000-4000-8000-0000000000d1']::uuid[], array[]::timestamptz[], 60, 30000) $$,
  'P0001', 'no_starts', 'a schedule needs at least one start'
);

-- Cancelling frees the time
select is(public.cancel_open_play_session((select id from public.open_play_sessions where organization_id = '00000000-0000-4000-8000-0000000000aa' and starts_at = '2026-11-13 20:00+06')),
  'cancelled', 'an open session can be cancelled');
select lives_ok(
  $$ select public.schedule_open_play(
       '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1',
       array['00000000-0000-4000-8000-0000000000d1']::uuid[], array['2026-11-13 20:00+06']::timestamptz[], 60, 30000) $$,
  'cancelling frees the slot for rescheduling'
);
select is(public.cancel_open_play_session((select id from public.open_play_sessions where organization_id = '00000000-0000-4000-8000-0000000000aa' and starts_at = '2026-11-13 20:00+06' and status = 'cancelled')),
  'not_open', 'cancelling twice reports not_open');
select is(public.cancel_open_play_session('00000000-0000-4000-8000-00000000ffff'), 'not_found', 'an unknown session reports not_found');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.cancel_open_play_session('00000000-0000-4000-8000-00000000ffff') $$,
  '42501', null, 'signed-in users cannot call the schedule RPCs directly'
);
reset role;

select * from finish();
rollback;
