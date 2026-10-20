-- Booking history can't be deleted by accident: references from the booking-flow tables are
-- `on delete no action`, so deleting a profile, activity or session that has history is refused,
-- while deleting a whole organization (checked at the end of the statement) still cleans up.
-- The session leaves its activity to players, so only the group references the activity.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is_empty(
  $$
    select conname from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname in (
        'groups_session_id_fkey', 'groups_resource_id_fkey', 'groups_activity_id_fkey',
        'bookings_session_id_fkey', 'bookings_group_id_fkey', 'bookings_profile_id_fkey',
        'waitlist_entries_session_id_fkey', 'waitlist_entries_profile_id_fkey',
        'seat_offers_group_id_fkey', 'seat_offers_waitlist_entry_id_fkey', 'events_session_id_fkey'
      )
      and confdeltype <> 'a'
  $$,
  'booking-flow references to history are on delete no action'
);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000007a1', 'history-player@test.local');
insert into public.organizations (id, slug, name, business_type, status)
values ('00000000-0000-4000-8000-0000000007a0', 'history-org-p', 'History P', 'turf', 'live');
insert into public.branches (id, organization_id, name)
values ('00000000-0000-4000-8000-0000000007b0', '00000000-0000-4000-8000-0000000007a0', 'Main');
insert into public.resources (id, organization_id, branch_id, name, kind, capacity)
values ('00000000-0000-4000-8000-0000000007b1', '00000000-0000-4000-8000-0000000007a0', '00000000-0000-4000-8000-0000000007b0', 'Pitch 1', 'pitch', 14);
insert into public.activities (id, organization_id, name, min_players, max_players, duration_min, team_mode, team_size)
values ('00000000-0000-4000-8000-0000000007c0', '00000000-0000-4000-8000-0000000007a0', '5-a-side', 10, 10, 60, 'two_teams', 5);
insert into public.open_play_sessions (id, organization_id, branch_id, activity_id, starts_at, ends_at, seat_price_poisha)
values ('00000000-0000-4000-8000-0000000007d0', '00000000-0000-4000-8000-0000000007a0', '00000000-0000-4000-8000-0000000007b0',
        null, now() + interval '1 day', now() + interval '1 day 1 hour', 30000);
insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity)
values ('00000000-0000-4000-8000-0000000007e0', '00000000-0000-4000-8000-0000000007a0', '00000000-0000-4000-8000-0000000007d0',
        '00000000-0000-4000-8000-0000000007b1', '00000000-0000-4000-8000-0000000007c0', 10);
insert into public.player_profiles (id, organization_id, user_id, display_name, skill)
values ('00000000-0000-4000-8000-0000000007f0', '00000000-0000-4000-8000-0000000007a0', '00000000-0000-4000-8000-0000000007a1', 'Rafi', 3);
insert into public.bookings (organization_id, session_id, group_id, profile_id, seat_no, price_poisha)
values ('00000000-0000-4000-8000-0000000007a0', '00000000-0000-4000-8000-0000000007d0', '00000000-0000-4000-8000-0000000007e0',
        '00000000-0000-4000-8000-0000000007f0', 1, 30000);

select throws_ok(
  $$ delete from public.player_profiles where id = '00000000-0000-4000-8000-0000000007f0' $$,
  '23503', null, 'a profile with bookings cannot be deleted'
);
select throws_ok(
  $$ delete from public.activities where id = '00000000-0000-4000-8000-0000000007c0' $$,
  '23503', null, 'an activity used by a group cannot be deleted'
);
select throws_ok(
  $$ delete from public.open_play_sessions where id = '00000000-0000-4000-8000-0000000007d0' $$,
  '23503', null, 'a session with bookings cannot be deleted'
);
select lives_ok(
  $$ delete from public.organizations where id = '00000000-0000-4000-8000-0000000007a0' $$,
  'deleting a whole organization still works'
);
select is(
  (select count(*)::int from public.bookings where organization_id = '00000000-0000-4000-8000-0000000007a0'),
  0, 'and its bookings are gone with it'
);

select * from finish();
rollback;
