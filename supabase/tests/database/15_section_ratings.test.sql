-- Games and ratings per section (One Brand R1): profile_section_skills and its access rules, games
-- tied to a section of the same brand, needs_skill, schedules and matches confined to one section, and
-- each section's own match cut-off and smallest game. Org R (…15a0): Turf (Singles, two teams of one)
-- and Café (Catan, 3–4); players pg_temp.p(1…4). Org X (…15a9) has its own Turf.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.p(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000001501' || lpad(to_hex(n), 2, '0'))::uuid;
$$;
create function pg_temp.u(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000001500' || lpad(to_hex(n), 2, '0'))::uuid;
$$;
create temp table s (label text primary key, id uuid);
grant select on s to authenticated; -- read by pg_temp.section while acting as a player
create function pg_temp.section(label text) returns uuid language sql as $$
  select id from s where s.label = section.label;
$$;

insert into auth.users (id, email) select pg_temp.u(n), 'rat-' || n || '@test.local' from generate_series(1, 4) n;
insert into public.organizations (id, slug, name, business_type, status) values
  ('00000000-0000-4000-8000-0000000015a0', 'rat-org-r', 'Org R', 'turf', 'live'),
  ('00000000-0000-4000-8000-0000000015a9', 'rat-org-x', 'Org X', 'turf', 'live');
insert into s values ('turf', public.add_section('00000000-0000-4000-8000-0000000015a0', 'turf', 'Turf'));
insert into s values ('cafe', public.add_section('00000000-0000-4000-8000-0000000015a0', 'boardgame_cafe', 'Café'));
insert into s values ('xturf', public.add_section('00000000-0000-4000-8000-0000000015a9', 'turf', 'X turf'));
-- The turf's cut-off is 60 minutes (cancel 30), the café's 600.
update public.sections set match_cutoff_minutes = 60, cancel_cutoff_minutes = 30 where id = pg_temp.section('turf');
update public.sections set match_cutoff_minutes = 600 where id = pg_temp.section('cafe');

insert into public.resources (id, organization_id, section_id, name, kind, capacity) values
  ('00000000-0000-4000-8000-0000000015c1', '00000000-0000-4000-8000-0000000015a0', pg_temp.section('turf'), 'Court 1', 'court', 4),
  ('00000000-0000-4000-8000-0000000015c2', '00000000-0000-4000-8000-0000000015a0', pg_temp.section('cafe'), 'Table 1', 'table', 4);
insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min, team_mode, team_size) values
  ('00000000-0000-4000-8000-0000000015d1', '00000000-0000-4000-8000-0000000015a0', pg_temp.section('turf'), 'Singles', 2, 2, 60, 'two_teams', 1),
  ('00000000-0000-4000-8000-0000000015d2', '00000000-0000-4000-8000-0000000015a0', pg_temp.section('cafe'), 'Catan', 3, 4, 90, 'none', null),
  ('00000000-0000-4000-8000-0000000015d3', '00000000-0000-4000-8000-0000000015a0', pg_temp.section('turf'), 'Doubles', 4, 4, 60, 'two_teams', 2);
insert into public.player_profiles (id, organization_id, user_id, display_name)
select pg_temp.p(n), '00000000-0000-4000-8000-0000000015a0', pg_temp.u(n), 'P' || n from generate_series(1, 4) n;
-- P2 has a turf rating already (P1 checks it can't see it).
insert into public.profile_section_skills (organization_id, profile_id, section_id, skill)
values ('00000000-0000-4000-8000-0000000015a0', pg_temp.p(2), pg_temp.section('turf'), 4);

-- ── ratings and their access rules ──────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(1), 'role', 'authenticated')::text, true);
select lives_ok(
  format($$ insert into public.profile_section_skills (organization_id, profile_id, section_id, skill) values (%L, %L, %L, 3) $$,
         '00000000-0000-4000-8000-0000000015a0', pg_temp.p(1), pg_temp.section('turf')),
  'a player rates themselves for a section'
);
select is(
  (select skill::int from public.profile_section_skills where profile_id = pg_temp.p(1) and section_id = pg_temp.section('turf')),
  3, 'and reads it back'
);
select throws_ok(
  format($$ insert into public.profile_section_skills (organization_id, profile_id, section_id, skill) values (%L, %L, %L, 5) $$,
         '00000000-0000-4000-8000-0000000015a0', pg_temp.p(2), pg_temp.section('cafe')),
  '42501', null, 'a player cannot rate someone else'
);
select is((select count(*)::int from public.profile_section_skills where profile_id = pg_temp.p(2)), 0,
  'nor see another player''s ratings');
reset role;

select throws_ok(
  format($$ insert into public.profile_section_skills (organization_id, profile_id, section_id, skill) values (%L, %L, %L, 0) $$,
         '00000000-0000-4000-8000-0000000015a0', pg_temp.p(3), pg_temp.section('turf')),
  '23514', null, 'a rating is at least 1'
);
select throws_ok(
  format($$ insert into public.profile_section_skills (organization_id, profile_id, section_id, skill) values (%L, %L, %L, 6) $$,
         '00000000-0000-4000-8000-0000000015a0', pg_temp.p(3), pg_temp.section('turf')),
  '23514', null, 'and at most 5'
);
select throws_ok(
  format($$ insert into public.profile_section_skills (organization_id, profile_id, section_id, skill) values (%L, %L, %L, 2) $$,
         '00000000-0000-4000-8000-0000000015a0', pg_temp.p(2), pg_temp.section('turf')),
  '23505', null, 'one rating per section'
);

-- ── games belong to a section of the same brand ─────────────────────────────
select throws_ok(
  format($$ insert into public.activities (organization_id, section_id, name, min_players, max_players, duration_min) values (%L, %L, 'Stray', 2, 4, 30) $$,
         '00000000-0000-4000-8000-0000000015a0', pg_temp.section('xturf')),
  '23503', null, 'a game cannot sit in another brand''s section'
);

-- ── needs_skill (RF3) ───────────────────────────────────────────────────────
insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha) values
  ('00000000-0000-4000-8000-0000000015f1', '00000000-0000-4000-8000-0000000015a0', pg_temp.section('cafe'), null,
   now() + interval '3 days', now() + interval '3 days 2 hours', 20000);
select is(public.request_seat('00000000-0000-4000-8000-0000000015f1', pg_temp.p(1)), 'needs_skill',
  'a player rated only for the turf is asked to rate the café first');
select is((select count(*)::int from public.seat_requests where session_id = '00000000-0000-4000-8000-0000000015f1'), 0,
  'and nothing is written');
insert into public.profile_section_skills (organization_id, profile_id, section_id, skill)
values ('00000000-0000-4000-8000-0000000015a0', pg_temp.p(1), pg_temp.section('cafe'), 2);
select is(public.request_seat('00000000-0000-4000-8000-0000000015f1', pg_temp.p(1)), 'requested', 'once rated, the request goes through');

-- ── schedules and matches stay in one section (RF2) ─────────────────────────
select throws_ok(
  format($$ select public.schedule_open_play(%L, %L, %L, array[%L]::uuid[], array[now() + interval '20 days']::timestamptz[], 60, 30000) $$,
         '00000000-0000-4000-8000-0000000015a0', pg_temp.section('turf'), '00000000-0000-4000-8000-0000000015d2',
         '00000000-0000-4000-8000-0000000015c1'),
  'P0001', 'invalid_reference', 'a turf schedule cannot use a café game'
);
insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha) values
  ('00000000-0000-4000-8000-0000000015f2', '00000000-0000-4000-8000-0000000015a0', pg_temp.section('turf'), null,
   now() + interval '3 days', now() + interval '3 days 1 hour', 20000);
insert into public.seat_requests (organization_id, session_id, profile_id)
values ('00000000-0000-4000-8000-0000000015a0', '00000000-0000-4000-8000-0000000015f2', pg_temp.p(1));
select throws_ok(
  format($$ select public.apply_match(%L, %L, '[]') $$, '00000000-0000-4000-8000-0000000015f2',
         jsonb_build_array(jsonb_build_object('resource_id', '00000000-0000-4000-8000-0000000015c1',
           'activity_id', '00000000-0000-4000-8000-0000000015d2', 'capacity', 4,
           'seats', jsonb_build_array(jsonb_build_object('profile_id', pg_temp.p(1), 'seat_no', 1, 'team', null))))),
  'P0001', 'invalid_match', 'a turf match cannot seat players at a café game'
);

-- ── each section's own cut-off and smallest game ────────────────────────────
-- T: turf Singles in 2 h with 2 requests (cut-off 60 min → not due yet). C: café, players choose, in
-- 2 h with 3 requests (cut-off 600 min → due). C2: café in 2 h with only 2 requests — the café's
-- smallest game needs 3, even though the turf's Singles needs only 2.
insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha) values
  ('00000000-0000-4000-8000-0000000015e1', '00000000-0000-4000-8000-0000000015a0', pg_temp.section('turf'),
   '00000000-0000-4000-8000-0000000015d1', now() + interval '2 hours', now() + interval '3 hours', 20000),
  ('00000000-0000-4000-8000-0000000015e2', '00000000-0000-4000-8000-0000000015a0', pg_temp.section('cafe'), null,
   now() + interval '2 hours', now() + interval '4 hours', 20000),
  ('00000000-0000-4000-8000-0000000015e3', '00000000-0000-4000-8000-0000000015a0', pg_temp.section('cafe'), null,
   now() + interval '2 hours 5 minutes', now() + interval '4 hours', 20000);
insert into public.seat_requests (organization_id, session_id, profile_id)
select '00000000-0000-4000-8000-0000000015a0', x.session_id, pg_temp.p(x.n)
from (values ('00000000-0000-4000-8000-0000000015e1'::uuid, 1), ('00000000-0000-4000-8000-0000000015e1', 2),
             ('00000000-0000-4000-8000-0000000015e2', 1), ('00000000-0000-4000-8000-0000000015e2', 2), ('00000000-0000-4000-8000-0000000015e2', 3),
             ('00000000-0000-4000-8000-0000000015e3', 1), ('00000000-0000-4000-8000-0000000015e3', 2)) as x(session_id, n);
select is(
  (select array_agg(session_id order by session_id) from public.sessions_due_for_matching(1000)
   where session_id in ('00000000-0000-4000-8000-0000000015e1', '00000000-0000-4000-8000-0000000015e2')),
  array['00000000-0000-4000-8000-0000000015e2'::uuid],
  'each section''s own cut-off decides when its games are matched'
);
select is(
  (select count(*)::int from public.sessions_due_for_matching(1000) where session_id = '00000000-0000-4000-8000-0000000015e3'),
  0, 'a café game waits for enough players for the café''s smallest game'
);

-- ── favourites count per section ────────────────────────────────────────────
-- P3's only favourite is the turf's Singles: no café favourites, so any café game will do.
insert into public.profile_activities (organization_id, profile_id, activity_id, rank)
values ('00000000-0000-4000-8000-0000000015a0', pg_temp.p(3), '00000000-0000-4000-8000-0000000015d1', 1);
select ok(private.wants_game(pg_temp.p(3), '00000000-0000-4000-8000-0000000015d2', null),
  'a favourite in the turf doesn''t stop a player wanting any café game');
select ok(not private.wants_game(pg_temp.p(3), '00000000-0000-4000-8000-0000000015d3', null),
  'but within the turf, only their favourite counts');

select * from finish();
rollback;
