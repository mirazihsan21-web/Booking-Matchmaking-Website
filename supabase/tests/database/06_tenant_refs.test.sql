-- A row may only point at rows of its own organization. RLS checks who writes a row, not where its
-- foreign keys point, so composite (x_id, organization_id) foreign keys enforce it for every path,
-- PostgREST included. Org P (…e0p0) and org Q (…e0q0), each with a branch, pitch, activity and session.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select is_empty(
  $$
    select c.conrelid::regclass::text || ' ' || c.conname
    from pg_constraint c
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and c.confrelid <> 'public.organizations'::regclass
      and exists (select 1 from pg_attribute a where a.attrelid = c.confrelid and a.attname = 'organization_id' and not a.attisdropped)
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.conrelid and a.attname = 'organization_id' and a.attnum = any (c.conkey)
      )
  $$,
  'every reference to a tenant table includes organization_id'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e0a1', 'owner-p@test.local'),
  ('00000000-0000-4000-8000-00000000e0a2', 'player-p@test.local');
insert into public.organizations (id, slug, name, business_type, status) values
  ('00000000-0000-4000-8000-00000000e000', 'refs-org-p', 'Org P', 'turf', 'live'),
  ('00000000-0000-4000-8000-00000000f000', 'refs-org-q', 'Org Q', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role)
values ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000e0a1', 'owner');
insert into public.sections (id, organization_id, name, kind, slug) values
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000e000', 'P main', 'turf', 'p-main'),
  ('00000000-0000-4000-8000-00000000e00b', '00000000-0000-4000-8000-00000000e000', 'P annex', 'turf', 'p-annex'),
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000f000', 'Q main', 'turf', 'q-main');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000e001', 'P pitch', 'pitch', 14),
  ('00000000-0000-4000-8000-00000000e00c', '00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000e00b', 'P annex pitch', 'pitch', 14),
  ('00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-00000000f001', 'Q pitch', 'pitch', 14);
insert into public.activities (id, organization_id, name, min_players, max_players, duration_min, team_mode, team_size) values
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000e000', '5-a-side', 10, 10, 60, 'two_teams', 5),
  ('00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000f000', '5-a-side', 10, 10, 60, 'two_teams', 5);
insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha) values
  ('00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000e001',
   '00000000-0000-4000-8000-00000000e003', now() + interval '1 day', now() + interval '1 day 1 hour', 30000),
  ('00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-00000000f001',
   '00000000-0000-4000-8000-00000000f003', now() + interval '1 day', now() + interval '1 day 1 hour', 30000);
insert into public.player_profiles (id, organization_id, user_id, display_name, skill)
values ('00000000-0000-4000-8000-00000000e005', '00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000e0a2', 'Rafi', 3);

-- The owner of P, through RLS (what a direct PostgREST call does)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e0a1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.resources (organization_id, section_id, name, kind, capacity)
     values ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000f001', 'Sneaky', 'pitch', 14) $$,
  '23503', null, 'an owner cannot add a resource under another venue''s branch'
);
select lives_ok(
  $$ insert into public.resources (organization_id, section_id, name, kind, capacity)
     values ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000e001', 'Pitch 2', 'pitch', 14) $$,
  'an owner can still add a resource under their own branch'
);
reset role;

-- A player at P, through RLS
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e0a2","role":"authenticated"}';
select throws_ok(
  $$ insert into public.profile_activities (organization_id, profile_id, activity_id, rank)
     values ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000e005', '00000000-0000-4000-8000-00000000f003', 1) $$,
  '23503', null, 'a player cannot favourite another venue''s activity'
);
reset role;

-- Server-side paths (service role / RPCs) are held to the same rule. Seat requests are written only
-- by the server (Stage B2 revoked players' insert).
select throws_ok(
  $$ insert into public.seat_requests (organization_id, session_id, profile_id)
     values ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000e005') $$,
  '23503', null, 'a seat request cannot point at another venue''s session'
);
select lives_ok(
  $$ insert into public.seat_requests (organization_id, session_id, profile_id)
     values ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000e005') $$,
  'a seat request in the venue''s own session is fine'
);
select throws_ok(
  $$ insert into public.groups (organization_id, session_id, resource_id, activity_id, capacity)
     values ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000f004',
             '00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000e003', 10) $$,
  '23503', null, 'a group cannot belong to another venue''s session'
);

-- Delete behaviour is unchanged
delete from public.sections where id = '00000000-0000-4000-8000-00000000e00b';
select is((select count(*)::int from public.resources where id = '00000000-0000-4000-8000-00000000e00c'), 0,
  'deleting a branch still deletes its resources');
insert into public.notifications (organization_id, profile_id, kind, link)
values ('00000000-0000-4000-8000-00000000e000', '00000000-0000-4000-8000-00000000e005', 'booking_confirmed', '/me/bookings');
delete from public.player_profiles where id = '00000000-0000-4000-8000-00000000e005';
select is(
  (select count(*)::int from public.notifications where profile_id = '00000000-0000-4000-8000-00000000e005'),
  0, 'deleting a profile with no history deletes its notifications'
);

select * from finish();
rollback;
