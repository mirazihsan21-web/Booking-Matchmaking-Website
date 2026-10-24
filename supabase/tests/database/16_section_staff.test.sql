-- Staff per section (One Brand R1): staff read the bookings, seats, waitlists, offers and events of
-- the sections they are given, the owner reads every section, and section_staff itself is read-only
-- for members. Org X (…16a0) has Turf and Café. Owner O (…16d1); staff T (turf only, …16d2),
-- B (both, …16d3) and N (none yet, …16d4); players P (…16d5, seated, booked, asked) and Q (…16d6,
-- waiting with an offer) in both sections.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.at(days int, hhmm text) returns timestamptz language sql as $$
  select ((now() at time zone 'Asia/Dhaka')::date + days + hhmm::time) at time zone 'Asia/Dhaka';
$$;
create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000016d' || n)::uuid $$;
create function pg_temp.act_as(n int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'role', 'authenticated')::text, true);
$$;
create temp table s (label text primary key, id uuid);
grant select on s to authenticated;

insert into auth.users (id, email)
select pg_temp.u(n), 'staff16-' || n || '@test.local' from generate_series(1, 6) n;
insert into public.organizations (id, slug, name, status) values ('00000000-0000-4000-8000-0000000016a0', 'staff-org-x', 'Org X', 'live');
insert into s values ('turf', public.add_section('00000000-0000-4000-8000-0000000016a0', 'turf', 'Turf'));
insert into s values ('cafe', public.add_section('00000000-0000-4000-8000-0000000016a0', 'boardgame_cafe', 'Café'));
insert into public.organization_members (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000016a0', pg_temp.u(1), 'owner'),
  ('00000000-0000-4000-8000-0000000016a0', pg_temp.u(2), 'staff'),
  ('00000000-0000-4000-8000-0000000016a0', pg_temp.u(3), 'staff'),
  ('00000000-0000-4000-8000-0000000016a0', pg_temp.u(4), 'staff');
insert into public.section_staff (organization_id, section_id, user_id) values
  ('00000000-0000-4000-8000-0000000016a0', (select id from s where label = 'turf'), pg_temp.u(2)),
  ('00000000-0000-4000-8000-0000000016a0', (select id from s where label = 'turf'), pg_temp.u(3)),
  ('00000000-0000-4000-8000-0000000016a0', (select id from s where label = 'cafe'), pg_temp.u(3));

-- One of everything in each section: a space booking (and its reservation), a scheduled game with a
-- request, a seat, a waiting player with an offer, and an event.
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values
  ('00000000-0000-4000-8000-0000000016c1', '00000000-0000-4000-8000-0000000016a0', (select id from s where label = 'turf'), 'Pitch 1', 'pitch', 14),
  ('00000000-0000-4000-8000-0000000016c2', '00000000-0000-4000-8000-0000000016a0', (select id from s where label = 'cafe'), 'Table 1', 'table', 4);
insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min) values
  ('00000000-0000-4000-8000-0000000016b1', '00000000-0000-4000-8000-0000000016a0', (select id from s where label = 'turf'), '5-a-side', 2, 10, 60),
  ('00000000-0000-4000-8000-0000000016b2', '00000000-0000-4000-8000-0000000016a0', (select id from s where label = 'cafe'), 'Catan', 2, 4, 90);
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  ('00000000-0000-4000-8000-0000000016e5', '00000000-0000-4000-8000-0000000016a0', pg_temp.u(5), 'P'),
  ('00000000-0000-4000-8000-0000000016e6', '00000000-0000-4000-8000-0000000016a0', pg_temp.u(6), 'Q');
select public.book_resource('00000000-0000-4000-8000-0000000016a0', r, pg_temp.at(20, '20:00'), 1, '00000000-0000-4000-8000-0000000016e5', null, null, pg_temp.u(5))
from unnest(array['00000000-0000-4000-8000-0000000016c1', '00000000-0000-4000-8000-0000000016c2']::uuid[]) r;
insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha, status) values
  ('00000000-0000-4000-8000-0000000016f1', '00000000-0000-4000-8000-0000000016a0', (select id from s where label = 'turf'), '00000000-0000-4000-8000-0000000016b1',
   pg_temp.at(21, '20:00'), pg_temp.at(21, '21:00'), 30000, 'matched'),
  ('00000000-0000-4000-8000-0000000016f2', '00000000-0000-4000-8000-0000000016a0', (select id from s where label = 'cafe'), '00000000-0000-4000-8000-0000000016b2',
   pg_temp.at(21, '18:00'), pg_temp.at(21, '19:30'), 20000, 'matched');
insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity) values
  ('00000000-0000-4000-8000-000000001691', '00000000-0000-4000-8000-0000000016a0', '00000000-0000-4000-8000-0000000016f1', '00000000-0000-4000-8000-0000000016c1', '00000000-0000-4000-8000-0000000016b1', 10),
  ('00000000-0000-4000-8000-000000001692', '00000000-0000-4000-8000-0000000016a0', '00000000-0000-4000-8000-0000000016f2', '00000000-0000-4000-8000-0000000016c2', '00000000-0000-4000-8000-0000000016b2', 4);
insert into public.seat_requests (organization_id, session_id, profile_id)
select '00000000-0000-4000-8000-0000000016a0', sid, '00000000-0000-4000-8000-0000000016e5'
from unnest(array['00000000-0000-4000-8000-0000000016f1', '00000000-0000-4000-8000-0000000016f2']::uuid[]) sid;
insert into public.bookings (organization_id, session_id, group_id, profile_id, seat_no, price_poisha) values
  ('00000000-0000-4000-8000-0000000016a0', '00000000-0000-4000-8000-0000000016f1', '00000000-0000-4000-8000-000000001691', '00000000-0000-4000-8000-0000000016e5', 1, 30000),
  ('00000000-0000-4000-8000-0000000016a0', '00000000-0000-4000-8000-0000000016f2', '00000000-0000-4000-8000-000000001692', '00000000-0000-4000-8000-0000000016e5', 1, 20000);
insert into public.waitlist_entries (id, organization_id, session_id, profile_id, queue_position, status) values
  ('00000000-0000-4000-8000-000000001681', '00000000-0000-4000-8000-0000000016a0', '00000000-0000-4000-8000-0000000016f1', '00000000-0000-4000-8000-0000000016e6', 1, 'offered'),
  ('00000000-0000-4000-8000-000000001682', '00000000-0000-4000-8000-0000000016a0', '00000000-0000-4000-8000-0000000016f2', '00000000-0000-4000-8000-0000000016e6', 1, 'offered');
insert into public.seat_offers (organization_id, group_id, seat_no, waitlist_entry_id, expires_at) values
  ('00000000-0000-4000-8000-0000000016a0', '00000000-0000-4000-8000-000000001691', 2, '00000000-0000-4000-8000-000000001681', now() + interval '15 minutes'),
  ('00000000-0000-4000-8000-0000000016a0', '00000000-0000-4000-8000-000000001692', 2, '00000000-0000-4000-8000-000000001682', now() + interval '15 minutes');
insert into public.events (organization_id, session_id, type) values
  ('00000000-0000-4000-8000-0000000016a0', '00000000-0000-4000-8000-0000000016f1', 'session_matched'),
  ('00000000-0000-4000-8000-0000000016a0', '00000000-0000-4000-8000-0000000016f2', 'session_matched'),
  ('00000000-0000-4000-8000-0000000016a0', null, 'venue_note');

-- Rows the current role can read, per table: (turf, café).
create function pg_temp.visible() returns table (tbl text, turf bigint, cafe bigint) language sql as $$
  select 'bookings', count(*) filter (where session_id = '00000000-0000-4000-8000-0000000016f1'), count(*) filter (where session_id = '00000000-0000-4000-8000-0000000016f2') from public.bookings
  union all
  select 'events', count(*) filter (where session_id = '00000000-0000-4000-8000-0000000016f1'), count(*) filter (where session_id = '00000000-0000-4000-8000-0000000016f2') from public.events
  union all
  select 'resource_bookings', count(*) filter (where resource_id = '00000000-0000-4000-8000-0000000016c1'), count(*) filter (where resource_id = '00000000-0000-4000-8000-0000000016c2') from public.resource_bookings
  union all
  select 'resource_reservations', count(*) filter (where resource_id = '00000000-0000-4000-8000-0000000016c1'), count(*) filter (where resource_id = '00000000-0000-4000-8000-0000000016c2') from public.resource_reservations
  union all
  select 'seat_offers', count(*) filter (where group_id = '00000000-0000-4000-8000-000000001691'), count(*) filter (where group_id = '00000000-0000-4000-8000-000000001692') from public.seat_offers
  union all
  select 'seat_requests', count(*) filter (where session_id = '00000000-0000-4000-8000-0000000016f1'), count(*) filter (where session_id = '00000000-0000-4000-8000-0000000016f2') from public.seat_requests
  union all
  select 'waitlist_entries', count(*) filter (where session_id = '00000000-0000-4000-8000-0000000016f1'), count(*) filter (where session_id = '00000000-0000-4000-8000-0000000016f2') from public.waitlist_entries
  order by 1
$$;
create temp table everything as select * from pg_temp.visible();
grant select on everything to authenticated;
select is((select count(*) from everything where turf = 0 or cafe = 0), 0::bigint, 'every table has a row in each section (so the zeros below mean something)');

set local role authenticated;

-- ── who reads which section (RF4) ───────────────────────────────────────────
select pg_temp.act_as(2);
select results_eq('select * from pg_temp.visible()', 'select tbl, turf, 0::bigint from everything order by tbl', 'turf staff read every turf row and no café row');
select pg_temp.act_as(1);
select results_eq('select * from pg_temp.visible()', 'select * from everything order by tbl', 'the owner reads both sections');
select pg_temp.act_as(4);
select results_eq('select * from pg_temp.visible()', 'select tbl, 0::bigint, 0::bigint from everything order by tbl', 'staff with no section read none');
select pg_temp.act_as(3);
select results_eq('select * from pg_temp.visible()', 'select * from everything order by tbl', 'staff in both sections read both');
reset role;
delete from public.section_staff where user_id = pg_temp.u(3) and section_id = (select id from s where label = 'cafe');
set local role authenticated;
select pg_temp.act_as(3);
select results_eq('select * from pg_temp.visible()', 'select tbl, turf, 0::bigint from everything order by tbl', 'and once taken off the café, its rows are hidden');

-- ── events with no session, and players ─────────────────────────────────────
select pg_temp.act_as(1);
select is((select count(*) from public.events where session_id is null), 1::bigint, 'the owner reads venue-wide events');
select pg_temp.act_as(3);
select is((select count(*) from public.events where session_id is null), 0::bigint, 'staff do not');
select pg_temp.act_as(5);
select is((select count(*) from public.bookings) + (select count(*) from public.resource_bookings) + (select count(*) from public.seat_requests), 6::bigint,
  'a player still reads their own seats, bookings and requests in both sections');
select pg_temp.act_as(6);
select is((select count(*) from public.seat_offers), 2::bigint, 'and their own offers');

-- ── section_staff itself ────────────────────────────────────────────────────
select pg_temp.act_as(2);
select results_eq('select user_id from public.section_staff', format('values (%L::uuid)', pg_temp.u(2)), 'staff read only their own section rows');
select pg_temp.act_as(1);
select is((select count(*) from public.section_staff), 2::bigint, 'the owner reads every section row of the brand');
select throws_ok(format($$ insert into public.section_staff (organization_id, section_id, user_id) values ('00000000-0000-4000-8000-0000000016a0', %L, %L) $$,
  (select id from s where label = 'cafe'), pg_temp.u(4)), '42501', null, 'nobody writes section rows directly, not even the owner');
reset role;

-- ── leaving the team, and invites ───────────────────────────────────────────
delete from public.organization_members where user_id = pg_temp.u(2);
select is((select count(*) from public.section_staff where user_id = pg_temp.u(2)), 0::bigint, 'removing a member removes their sections');
select throws_ok($$ insert into public.organization_invites (organization_id, email, role, section_ids)
  values ('00000000-0000-4000-8000-0000000016a0', 'new-staff@test.local', 'staff', '{}') $$, '23514', null, 'a staff invite names at least one section');
select throws_ok(format($$ insert into public.organization_invites (organization_id, email, role, section_ids)
  values ('00000000-0000-4000-8000-0000000016a0', 'new-owner@test.local', 'owner', array[%L::uuid]) $$, (select id from s where label = 'turf')),
  '23514', null, 'an owner invite names none (owners run every section)');

select * from finish();
rollback;
