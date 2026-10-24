-- Tenant isolation. Orgs: A (live), B (live), C (onboarding).
-- Users: OA owner of A, SA staff of A (and a player at B), PA player at A, OB owner of B, OC owner of C, U newcomer.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'oa@test.local'),
  ('00000000-0000-4000-8000-00000000000b', 'sa@test.local'),
  ('00000000-0000-4000-8000-00000000000c', 'pa@test.local'),
  ('00000000-0000-4000-8000-00000000000d', 'ob@test.local'),
  ('00000000-0000-4000-8000-00000000000e', 'oc@test.local'),
  ('00000000-0000-4000-8000-00000000000f', 'u@test.local');
insert into public.organizations (id, slug, name, business_type, status) values
  ('00000000-0000-4000-8000-000000000a00', 'org-a', 'Org A', 'turf', 'live'),
  ('00000000-0000-4000-8000-000000000b00', 'org-b', 'Org B', 'boardgame_cafe', 'live'),
  ('00000000-0000-4000-8000-000000000c00', 'org-c', 'Org C', 'gaming_lounge', 'onboarding');
insert into public.organization_members (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-00000000000a', 'owner'),
  ('00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-00000000000b', 'staff'),
  ('00000000-0000-4000-8000-000000000b00', '00000000-0000-4000-8000-00000000000d', 'owner'),
  ('00000000-0000-4000-8000-000000000c00', '00000000-0000-4000-8000-00000000000e', 'owner');
insert into public.sections (id, organization_id, name, kind, slug) values
  ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000a00', 'A main', 'turf', 'a-main'),
  ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000b00', 'B main', 'turf', 'b-main'),
  ('00000000-0000-4000-8000-000000000c01', '00000000-0000-4000-8000-000000000c00', 'C main', 'turf', 'c-main');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-000000000a01', 'Pitch 1', 'pitch', 14),
  ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000b00', '00000000-0000-4000-8000-000000000b01', 'Table 1', 'table', 4),
  ('00000000-0000-4000-8000-000000000c02', '00000000-0000-4000-8000-000000000c00', '00000000-0000-4000-8000-000000000c01', 'PC Zone A', 'zone', 10);
insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min, team_mode, team_size)
values ('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-000000000a01', '5-a-side', 10, 10, 60, 'two_teams', 5);
insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha)
values ('00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-000000000a01',
        '00000000-0000-4000-8000-000000000a03', now() + interval '1 day', now() + interval '1 day 1 hour', 30000);
insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity)
values ('00000000-0000-4000-8000-000000000a05', '00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-000000000a04',
        '00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-000000000a03', 10);
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  ('00000000-0000-4000-8000-000000000a06', '00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-00000000000c', 'Pavel'),
  ('00000000-0000-4000-8000-000000000b06', '00000000-0000-4000-8000-000000000b00', '00000000-0000-4000-8000-00000000000b', 'Sara');
insert into public.bookings (organization_id, session_id, group_id, profile_id, seat_no, price_poisha)
values ('00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-000000000a05',
        '00000000-0000-4000-8000-000000000a06', 1, 30000);
insert into public.events (organization_id, session_id, type)
values ('00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-000000000a04', 'booking_cancelled');

-- Visitors (anon)
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from public.organizations
           where id in ('00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-000000000b00', '00000000-0000-4000-8000-000000000c00')),
  2, 'visitors see live venues only');
select is((select count(*)::int from public.resources
           where id in ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-000000000c02')),
  1, 'visitors see a live venue''s resources but not an onboarding one''s');
select throws_ok($$ select count(*) from public.player_profiles $$, '42501', null, 'visitors cannot read player profiles');

-- OA: owner of A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select count(*)::int from public.player_profiles where organization_id = '00000000-0000-4000-8000-000000000a00'), 1,
  'an owner sees their venue''s players');
select is((select count(*)::int from public.player_profiles where organization_id = '00000000-0000-4000-8000-000000000b00'), 0,
  'an owner sees no other venue''s players');
select is((select count(*)::int from public.bookings), 1, 'an owner sees their venue''s bookings');
with changed as (
  update public.organizations set branding = '{"primary":"#123456"}'
  where id = '00000000-0000-4000-8000-000000000a00' returning 1
)
select is(count(*)::int, 1, 'an owner can update their branding') from changed;
with changed as (
  update public.resources set name = 'Hijacked' where organization_id = '00000000-0000-4000-8000-000000000b00' returning 1
)
select is(count(*)::int, 0, 'an owner cannot touch another venue''s resources') from changed;

-- SA: staff of A
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.player_profiles where organization_id = '00000000-0000-4000-8000-000000000a00'), 1,
  'staff see their venue''s players');
with changed as (
  update public.organizations set branding = '{}' where id = '00000000-0000-4000-8000-000000000a00' returning 1
)
select is(count(*)::int, 0, 'staff cannot change branding') from changed;
select throws_ok(
  $$ insert into public.resources (organization_id, section_id, name, kind, capacity)
     values ('00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-000000000a01', 'Pitch 9', 'pitch', 14) $$,
  '42501', null, 'staff cannot add resources'
);

-- PA: player at A
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}';
select is((select count(*)::int from public.player_profiles), 1, 'a player sees only their own profile');
select is((select count(*)::int from public.events), 0, 'a player sees no events');
select throws_ok(
  $$ update public.player_profiles set organization_id = '00000000-0000-4000-8000-000000000b00'
     where id = '00000000-0000-4000-8000-000000000a06' $$,
  '42501', null, 'a player cannot move their profile to another venue'
);
select throws_ok(
  $$ insert into public.seat_requests (organization_id, session_id, profile_id, priority)
     values ('00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-000000000a06', 32767) $$,
  '42501', null, 'a player cannot set their own priority'
);

-- U: a newcomer (Review Focus 3)
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000f","role":"authenticated"}';
select lives_ok(
  $$ insert into public.player_profiles (organization_id, user_id, display_name)
     values ('00000000-0000-4000-8000-000000000a00', '00000000-0000-4000-8000-00000000000f', 'Newcomer') $$,
  'a newcomer can join a live venue'
);
select throws_ok(
  $$ insert into public.player_profiles (organization_id, user_id, display_name)
     values ('00000000-0000-4000-8000-000000000c00', '00000000-0000-4000-8000-00000000000f', 'Too early') $$,
  '42501', null, 'nobody can join a venue that is still onboarding'
);
select throws_ok(
  $$ insert into public.player_profiles (organization_id, user_id, display_name)
     values ('00000000-0000-4000-8000-000000000b00', '00000000-0000-4000-8000-00000000000d', 'Impostor') $$,
  '42501', null, 'nobody can create a profile for someone else'
);

-- Logo uploads (OA)
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('org-assets', '00000000-0000-4000-8000-000000000a00/logo.png') $$,
  'an owner can upload their logo'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('org-assets', '00000000-0000-4000-8000-000000000b00/logo.png') $$,
  '42501', null, 'an owner cannot upload into another venue''s folder'
);

reset role;
select * from finish();
rollback;
