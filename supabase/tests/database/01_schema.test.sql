-- Stage A schema shape and the invariants that live in constraints.
begin;
create extension if not exists pgtap with schema extensions;
select plan(73);

select has_table('public', t, format('table %s exists', t))
from unnest(array[
  'organizations', 'organization_members', 'organization_invites', 'platform_admins',
  'sections', 'resources', 'activities', 'open_play_sessions', 'open_play_session_resources',
  'resource_reservations', 'player_profiles', 'profile_activities', 'availability',
  'seat_requests', 'groups', 'bookings', 'waitlist_entries', 'seat_offers', 'notifications', 'events',
  'resource_bookings'
]) as t;

select has_enum('public', e, format('enum %s exists', e))
from unnest(array[
  'business_type', 'org_status', 'member_role', 'team_mode', 'resource_kind', 'reservation_source',
  'session_status', 'booking_status', 'booking_source', 'waitlist_status', 'offer_status', 'notification_kind', 'email_status',
  'resource_booking_status'
]) as e;

select is_empty(
  $$
    select c.conrelid::regclass::text, a.attname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indkey[0] = a.attnum and i.indpred is null
      )
  $$,
  'every foreign key column leads a non-partial index'
);

-- Fixtures
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'owner@test.local'),
  ('00000000-0000-4000-8000-000000000002', 'p1@test.local'),
  ('00000000-0000-4000-8000-000000000003', 'p2@test.local');
insert into public.organizations (id, slug, name, business_type, created_by)
values ('00000000-0000-4000-8000-0000000000a1', 'pgtap-schema-turf', 'Dhanmondi Turf', 'turf', '00000000-0000-4000-8000-000000000001');
insert into public.sections (id, organization_id, name, kind, slug)
values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 'Main', 'turf', 'main');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'Pitch 1', 'pitch', 14),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'Pitch 2', 'pitch', 14);
insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min, team_mode, team_size)
values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '5-a-side', 10, 10, 60, 'two_teams', 5);
insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2',
        '00000000-0000-4000-8000-0000000000c1', now(), now() + interval '1 hour', 30000);
insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity)
values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', 10);
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000002', 'Rafi'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000003', 'Nila');
insert into public.waitlist_entries (id, organization_id, session_id, profile_id, queue_position)
values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000000d2', 1);

-- CHECK constraints (Review Focus: bad data never lands)
select throws_ok(
  $$ insert into public.profile_section_skills (organization_id, profile_id, section_id, skill)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a2', 6) $$,
  '23514', null, 'a rating above 5 is rejected'
);
select throws_ok(
  $$ update public.player_profiles set phone = 'not-a-phone' where id = '00000000-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'a malformed phone is rejected'
);
select throws_ok(
  $$ insert into public.activities (organization_id, section_id, name, min_players, max_players, duration_min)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'Backwards', 5, 4, 30) $$,
  '23514', null, 'an activity with min_players > max_players is rejected'
);
select throws_ok(
  $$ insert into public.activities (organization_id, section_id, name, min_players, max_players, duration_min, team_mode)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'No size', 10, 10, 60, 'two_teams') $$,
  '23514', null, 'a two-team activity needs a team size'
);
select throws_ok(
  $$ insert into public.activities (organization_id, section_id, name, min_players, max_players, duration_min, team_mode, team_size)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'Lopsided', 10, 8, 60, 'two_teams', 5) $$,
  '23514', null, 'a two-team activity must seat exactly 2 × team size'
);
select throws_ok(
  $$ insert into public.organizations (slug, name, business_type) values ('Bad Slug', 'Bad', 'turf') $$,
  '23514', null, 'a malformed slug is rejected'
);
select throws_ok(
  $$ insert into public.organizations (slug, name, business_type) values ('admin', 'Admin', 'turf') $$,
  '23514', null, 'a reserved slug is rejected'
);
select throws_ok(
  $$ insert into public.organizations (slug, name, business_type) values ('bkash', 'Fake bKash', 'turf') $$,
  '23514', null, 'a phishing-prone slug is reserved'
);
select throws_ok(
  $$ insert into public.organizations (slug, name, business_type) values ('xn--dhanmondi', 'Lookalike', 'turf') $$,
  '23514', null, 'a punycode (xn--) slug is rejected'
);
select throws_ok(
  $$ insert into public.sections (organization_id, name, kind, slug, match_cutoff_minutes, cancel_cutoff_minutes)
     values ('00000000-0000-4000-8000-0000000000a1', 'Cutoffs', 'turf', 'cutoffs', 120, 120) $$,
  '23514', null, 'matching must come before the cancellation cut-off'
);
select throws_ok(
  $$ insert into public.resources (organization_id, section_id, name, kind, capacity, slot_minutes)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'Odd', 'pitch', 14, 50) $$,
  '23514', null, 'slot length is a multiple of 15 minutes'
);

-- Seat invariants (carried over from M1)
insert into public.bookings (id, organization_id, session_id, group_id, profile_id, seat_no, price_poisha)
values ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 1, 30000);
select throws_ok(
  $$ insert into public.bookings (organization_id, session_id, group_id, profile_id, seat_no, price_poisha)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
             '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 2, 30000) $$,
  '23505', null, 'a profile cannot hold two live bookings in one session'
);
select throws_ok(
  $$ insert into public.bookings (organization_id, session_id, group_id, profile_id, seat_no, price_poisha)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
             '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d2', 1, 30000) $$,
  '23505', null, 'two live bookings cannot share a seat'
);
update public.bookings set status = 'cancelled', cancelled_at = now() where id = '00000000-0000-4000-8000-0000000002b1';
select lives_ok(
  $$ insert into public.bookings (organization_id, session_id, group_id, profile_id, seat_no, price_poisha)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
             '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d2', 1, 30000) $$,
  'a cancelled booking frees its seat'
);
insert into public.seat_offers (organization_id, group_id, seat_no, waitlist_entry_id, expires_at)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 2,
        '00000000-0000-4000-8000-0000000001a1', now() + interval '15 minutes');
select throws_ok(
  $$ insert into public.seat_offers (organization_id, group_id, seat_no, waitlist_entry_id, expires_at)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 2,
             '00000000-0000-4000-8000-0000000001a1', now() + interval '15 minutes') $$,
  '23505', null, 'only one pending offer per seat'
);

-- Resource time can never be double-booked
insert into public.resource_reservations (organization_id, resource_id, period, source, source_id)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1',
        tstzrange('2026-11-06 18:00+06', '2026-11-06 19:00+06'), 'session', gen_random_uuid());
select throws_ok(
  $$ insert into public.resource_reservations (organization_id, resource_id, period, source, source_id)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1',
             tstzrange('2026-11-06 18:30+06', '2026-11-06 19:30+06'), 'booking', gen_random_uuid()) $$,
  '23P01', null, 'overlapping reservations on one resource are rejected'
);
select lives_ok(
  $$ insert into public.resource_reservations (organization_id, resource_id, period, source, source_id)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1',
             tstzrange('2026-11-06 19:00+06', '2026-11-06 20:00+06'), 'booking', gen_random_uuid()) $$,
  'back-to-back reservations are allowed'
);
select lives_ok(
  $$ insert into public.resource_reservations (organization_id, resource_id, period, source, source_id)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2',
             tstzrange('2026-11-06 18:30+06', '2026-11-06 19:30+06'), 'booking', gen_random_uuid()) $$,
  'the same time on a different resource is allowed'
);

select has_column('public', 'open_play_sessions', 'matched_at', 'a session records when it was matched');
select has_column('public', 'bookings', 'team', 'a seat records its team');
select enum_has_labels('public', 'booking_source', array['matched', 'waitlist', 'direct'],
  'a late request that took a free seat is a direct booking');
select col_not_null('public', 'seat_offers', 'token_hash', 'every offer has a token hash');
select hasnt_table('public', 'branches', 'branches are now sections');
select has_table('public', 'profile_section_skills', 'players are rated per section');
select has_column('public', 'activities', 'section_id', 'each game belongs to a section');
select hasnt_column('public', 'player_profiles', 'skill', 'a profile no longer has one skill for everything');
select has_column('public', 'organizations', 'address', 'the brand has one address');
select hasnt_column('public', 'organizations', 'max_upcoming_bookings', 'booking rules moved to sections');
select hasnt_column('public', 'sections', 'address', 'sections share the brand address');
select has_column('public', 'sections', c, format('a section has %s', c))
from unnest(array['kind', 'slug', 'booking_horizon_days', 'cancel_cutoff_minutes', 'match_cutoff_minutes',
                  'max_upcoming_bookings', 'accent', 'position']) as c;

select * from finish();
rollback;
