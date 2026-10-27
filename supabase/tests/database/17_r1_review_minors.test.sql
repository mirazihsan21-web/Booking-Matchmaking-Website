-- One Brand R1 review minors: the section helpers keep the explicit execute grants of the older
-- helpers, and the repeat-request priority is earned per section. Org M (…17a0) has Turf and Café;
-- player P (…17e1) was left out of a matched turf game (S1), then asks for a café game (S2) and a
-- later turf game (S3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ── execute rights ──────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'private.is_section_staff(uuid)', 'execute'), 'anon cannot run is_section_staff');
select ok(not has_function_privilege('anon', 'private.is_session_staff(uuid)', 'execute'), 'anon cannot run is_session_staff');
select ok(not has_function_privilege('anon', 'private.is_resource_staff(uuid)', 'execute'), 'anon cannot run is_resource_staff');
select ok(has_function_privilege('authenticated', 'private.is_section_staff(uuid)', 'execute')
      and has_function_privilege('authenticated', 'private.is_session_staff(uuid)', 'execute')
      and has_function_privilege('authenticated', 'private.is_resource_staff(uuid)', 'execute'),
  'signed-in users can (their policies call them)');

-- ── priority per section ────────────────────────────────────────────────────
create function pg_temp.at(days int) returns timestamptz language sql as $$ select now() + make_interval(days => days) $$;
create temp table s (label text primary key, id uuid);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000017d1', 'minors-p@test.local');
insert into public.organizations (id, slug, name, status) values ('00000000-0000-4000-8000-0000000017a0', 'minors-org-m', 'Org M', 'live');
insert into s values ('turf', public.add_section('00000000-0000-4000-8000-0000000017a0', 'turf', 'Turf'));
insert into s values ('cafe', public.add_section('00000000-0000-4000-8000-0000000017a0', 'boardgame_cafe', 'Café'));
insert into public.player_profiles (id, organization_id, user_id, display_name)
values ('00000000-0000-4000-8000-0000000017e1', '00000000-0000-4000-8000-0000000017a0', '00000000-0000-4000-8000-0000000017d1', 'P');
insert into public.profile_section_skills (organization_id, profile_id, section_id, skill)
select '00000000-0000-4000-8000-0000000017a0', '00000000-0000-4000-8000-0000000017e1', id, 3 from s;
insert into public.open_play_sessions (id, organization_id, section_id, starts_at, ends_at, seat_price_poisha, status) values
  ('00000000-0000-4000-8000-0000000017f1', '00000000-0000-4000-8000-0000000017a0', (select id from s where label = 'turf'), pg_temp.at(5), pg_temp.at(5) + interval '1 hour', 30000, 'matched'),
  ('00000000-0000-4000-8000-0000000017f2', '00000000-0000-4000-8000-0000000017a0', (select id from s where label = 'cafe'), pg_temp.at(6), pg_temp.at(6) + interval '2 hours', 20000, 'open'),
  ('00000000-0000-4000-8000-0000000017f3', '00000000-0000-4000-8000-0000000017a0', (select id from s where label = 'turf'), pg_temp.at(7), pg_temp.at(7) + interval '1 hour', 30000, 'open');
-- P asked for the turf game S1, which was matched without them.
insert into public.seat_requests (organization_id, session_id, profile_id)
values ('00000000-0000-4000-8000-0000000017a0', '00000000-0000-4000-8000-0000000017f1', '00000000-0000-4000-8000-0000000017e1');

select is(public.request_seat('00000000-0000-4000-8000-0000000017f2', '00000000-0000-4000-8000-0000000017e1'), 'requested', 'P asks for the café game');
select is((select priority::int from public.seat_requests where session_id = '00000000-0000-4000-8000-0000000017f2'), 0,
  'missing a turf game earns no priority at the café');
select is(public.request_seat('00000000-0000-4000-8000-0000000017f3', '00000000-0000-4000-8000-0000000017e1'), 'requested', 'P asks for the next turf game');
select is((select priority::int from public.seat_requests where session_id = '00000000-0000-4000-8000-0000000017f3'), 1,
  'but it does at the next turf game');

select * from finish();
rollback;
