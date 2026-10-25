-- Sections (One Brand R1): add_section (slugs, accents, positions, kinds), the section checks, the
-- booking limit counted per section, payloads naming the section, the section's offer time, and
-- schedules confined to one section. Org S (…14a0) gets Turf, Board-game café and a second turf;
-- player P (…14e1) books Pitch 1 (turf) and Table 1 (café).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- `days` from today in Dhaka at `hhmm`.
create function pg_temp.at(days int, hhmm text) returns timestamptz language sql as $$
  select ((now() at time zone 'Asia/Dhaka')::date + days + hhmm::time) at time zone 'Asia/Dhaka';
$$;
create temp table s (label text primary key, id uuid);
create function pg_temp.section(label text) returns uuid language sql as $$
  select id from s where s.label = section.label;
$$;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000014d1', 'sec-p@test.local');
insert into public.organizations (id, slug, name, business_type, status)
values ('00000000-0000-4000-8000-0000000014a0', 'sec-org-s', 'Org S', 'turf', 'live');
insert into s values ('turf', public.add_section('00000000-0000-4000-8000-0000000014a0', 'turf', 'Turf'));
insert into s values ('cafe', public.add_section('00000000-0000-4000-8000-0000000014a0', 'boardgame_cafe', 'Board-game café'));
insert into s values ('turf2', public.add_section('00000000-0000-4000-8000-0000000014a0', 'turf', 'Second turf'));

-- ── add_section ─────────────────────────────────────────────────────────────
select results_eq(
  $$ select slug, accent, position::int from public.sections where organization_id = '00000000-0000-4000-8000-0000000014a0' order by position $$,
  $$ values ('turf'::text, '#15803D'::text, 1), ('cafe', '#0F766E', 2), ('turf-2', '#15803D', 3) $$,
  'add_section gives each section the next free slug, its kind''s accent and the next position'
);
select is((select kind::text from public.sections where id = pg_temp.section('cafe')), 'boardgame_cafe', 'and records its kind');

-- ── names ───────────────────────────────────────────────────────────────────
select is(
  (select count(*) from (
     select conname as name from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'
     union all select indexname from pg_indexes where schemaname = 'public'
     union all select policyname from pg_policies where schemaname = 'public'
   ) x where name ~ 'branch|sectione'),
  0::bigint,
  'constraints, indexes and policies are named after sections (sections_pkey, not sectiones_pkey)'
);

-- ── checks ──────────────────────────────────────────────────────────────────
select throws_ok(format($$ update public.sections set slug = 'manage' where id = %L $$, pg_temp.section('turf')),
  '23514', null, 'a section address cannot be a reserved word');
select throws_ok(format($$ update public.sections set slug = 'Turf' where id = %L $$, pg_temp.section('turf')),
  '23514', null, 'a section address is lower case');
select throws_ok(format($$ update public.sections set match_cutoff_minutes = 60, cancel_cutoff_minutes = 120 where id = %L $$, pg_temp.section('turf')),
  '23514', null, 'matching must come before the cancellation cut-off');
select throws_ok(format($$ update public.sections set accent = 'green' where id = %L $$, pg_temp.section('turf')),
  '23514', null, 'an accent is a hex colour');

-- ── the booking limit counts per section (RF1) ──────────────────────────────
insert into public.resources (id, organization_id, section_id, name, kind, capacity, price_per_hour_poisha) values
  ('00000000-0000-4000-8000-0000000014c1', '00000000-0000-4000-8000-0000000014a0', pg_temp.section('turf'), 'Pitch 1', 'pitch', 14, 250000),
  ('00000000-0000-4000-8000-0000000014c2', '00000000-0000-4000-8000-0000000014a0', pg_temp.section('cafe'), 'Table 1', 'table', 4, 50000);
insert into public.player_profiles (id, organization_id, user_id, display_name)
values ('00000000-0000-4000-8000-0000000014e1', '00000000-0000-4000-8000-0000000014a0', '00000000-0000-4000-8000-0000000014d1', 'P');
-- Both limits are 1, so the café booking only succeeds if the turf booking isn't counted against it.
update public.sections set max_upcoming_bookings = 1 where id in (pg_temp.section('turf'), pg_temp.section('cafe'));

create temp table b (label text primary key, status text, id uuid);
create function pg_temp.book(label text, res uuid, at timestamptz) returns text language sql as $$
  insert into b select label, r.status, r.booking_id
  from public.book_resource('00000000-0000-4000-8000-0000000014a0', res, at, 1, '00000000-0000-4000-8000-0000000014e1', null, null,
                            '00000000-0000-4000-8000-0000000014d1') r
  returning status;
$$;
select is(pg_temp.book('t1', '00000000-0000-4000-8000-0000000014c1', pg_temp.at(30, '20:00')), 'booked', 'P books the turf');
select is(pg_temp.book('t2', '00000000-0000-4000-8000-0000000014c1', pg_temp.at(30, '21:00')), 'limit_reached',
  'a second turf booking passes the turf''s limit of 1');
select is(pg_temp.book('c1', '00000000-0000-4000-8000-0000000014c2', pg_temp.at(30, '20:00')), 'booked',
  'the same player can still book the café');

-- ── payloads name the section ───────────────────────────────────────────────
select is((select payload->>'section_name' from public.notifications
           where kind = 'booking_confirmed' and payload->>'booking_id' = (select id::text from b where label = 't1')),
  'Turf', 'the confirmation names the section');
select ok((select not (payload ? 'branch_name') and not (payload ? 'multi_branch') from public.notifications
           where kind = 'booking_confirmed' and payload->>'booking_id' = (select id::text from b where label = 't1')),
  'and no longer carries branch fields');

-- ── the section's offer time ────────────────────────────────────────────────
update public.sections set offer_ttl_seconds = 600 where id = pg_temp.section('turf');
insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min)
values ('00000000-0000-4000-8000-0000000014f1', '00000000-0000-4000-8000-0000000014a0', pg_temp.section('turf'), 'Futsal', 2, 4, 60);
insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha, status)
values ('00000000-0000-4000-8000-000000001401', '00000000-0000-4000-8000-0000000014a0', pg_temp.section('turf'),
        '00000000-0000-4000-8000-0000000014f1', now() + interval '2 days', now() + interval '2 days 1 hour', 30000, 'matched');
insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity)
values ('00000000-0000-4000-8000-000000001402', '00000000-0000-4000-8000-0000000014a0', '00000000-0000-4000-8000-000000001401',
        '00000000-0000-4000-8000-0000000014c1', '00000000-0000-4000-8000-0000000014f1', 4);
insert into public.waitlist_entries (id, organization_id, session_id, profile_id, queue_position)
values ('00000000-0000-4000-8000-000000001403', '00000000-0000-4000-8000-0000000014a0', '00000000-0000-4000-8000-000000001401',
        '00000000-0000-4000-8000-0000000014e1', 1);
create temp table o as
select public.create_offer('00000000-0000-4000-8000-000000001402', 1::smallint, '00000000-0000-4000-8000-000000001403') as id;
select ok((select expires_at = now() + interval '600 seconds' from public.seat_offers where id = (select id from o)),
  'an offer lasts its section''s offer time');

-- ── a schedule stays in one section (RF2) ──────────────────────────────────
select throws_ok(
  format($$ select public.schedule_open_play(%L, %L, null, array[%L, %L]::uuid[], array[%L]::timestamptz[], 60, 30000) $$,
         '00000000-0000-4000-8000-0000000014a0', pg_temp.section('turf'), '00000000-0000-4000-8000-0000000014c1',
         '00000000-0000-4000-8000-0000000014c2', pg_temp.at(31, '20:00')),
  'P0001', 'invalid_reference', 'a schedule cannot mix spaces from two sections'
);
select is((select count(*)::int from public.open_play_sessions
           where organization_id = '00000000-0000-4000-8000-0000000014a0' and starts_at = pg_temp.at(31, '20:00')),
  0, 'and nothing is scheduled');

-- ── grants ──────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'public.add_section(uuid, public.business_type, text)', 'execute')
          and not has_function_privilege('anon', 'public.add_section(uuid, public.business_type, text)', 'execute')
          and has_function_privilege('service_role', 'public.add_section(uuid, public.business_type, text)', 'execute'),
  'add_section is service_role only');

select * from finish();
rollback;
