-- Desk check-in (R3): Arrived from 30 minutes before the start, No-show from the start, and either back
-- to booked — for space bookings and for seats in games. A cancelled booking can't be marked.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000020d1', 'desk20@test.local');
insert into public.organizations (id, slug, name, status) values ('00000000-0000-4000-8000-0000000020a0', 'desk-org-20', 'Desk Org', 'live');
create temp table s as select public.add_section('00000000-0000-4000-8000-0000000020a0', 'turf', 'Turf') as id;
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values
  ('00000000-0000-4000-8000-0000000020c1', '00000000-0000-4000-8000-0000000020a0', (select id from s), 'Pitch 1', 'pitch', 14);
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  ('00000000-0000-4000-8000-0000000020e1', '00000000-0000-4000-8000-0000000020a0', '00000000-0000-4000-8000-0000000020d1', 'P');

-- Space bookings starting in 31 min, 29 min, 1 min, 10 min ago, and a cancelled one.
create function pg_temp.space(n int, starts interval, st public.resource_booking_status default 'confirmed') returns uuid language sql as $$
  insert into public.resource_bookings (id, organization_id, resource_id, guest_name, guest_phone, period, price_poisha, status)
  values (('00000000-0000-4000-8000-0000000020b' || n)::uuid, '00000000-0000-4000-8000-0000000020a0', '00000000-0000-4000-8000-0000000020c1',
          'G' || n, '0171234567' || n, tstzrange(now() + starts, now() + starts + interval '1 hour'), 60000, st)
  returning id;
$$;
-- Seats in games starting at the same offsets.
insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min) values
  ('00000000-0000-4000-8000-0000000020f0', '00000000-0000-4000-8000-0000000020a0', (select id from s), '5-a-side', 2, 10, 60);
create function pg_temp.seat(n int, starts interval, st public.booking_status default 'confirmed') returns uuid language sql as $$
  insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha, status)
  values (('00000000-0000-4000-8000-0000000020f' || n)::uuid, '00000000-0000-4000-8000-0000000020a0', (select id from s),
          '00000000-0000-4000-8000-0000000020f0', now() + starts, now() + starts + interval '1 hour', 30000, 'matched');
  insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity)
  values (('00000000-0000-4000-8000-00000000209' || n)::uuid, '00000000-0000-4000-8000-0000000020a0', ('00000000-0000-4000-8000-0000000020f' || n)::uuid,
          '00000000-0000-4000-8000-0000000020c1', '00000000-0000-4000-8000-0000000020f0', 10);
  insert into public.bookings (id, organization_id, session_id, group_id, profile_id, seat_no, price_poisha, status)
  values (('00000000-0000-4000-8000-00000000208' || n)::uuid, '00000000-0000-4000-8000-0000000020a0', ('00000000-0000-4000-8000-0000000020f' || n)::uuid,
          ('00000000-0000-4000-8000-00000000209' || n)::uuid, '00000000-0000-4000-8000-0000000020e1', 1, 30000, st)
  returning id;
$$;

select is(public.set_resource_booking_status(pg_temp.space(1, interval '31 minutes'), 'attended'), 'not_started', 'space: Arrived 31 minutes early is refused');
select is(public.set_resource_booking_status(pg_temp.space(2, interval '29 minutes'), 'attended'), 'updated', 'space: Arrived 29 minutes early is fine');
select is(public.set_resource_booking_status('00000000-0000-4000-8000-0000000020b2', 'confirmed'), 'updated', 'space: Arrived can be undone');
select is(public.set_resource_booking_status(pg_temp.space(3, interval '1 minute'), 'no_show'), 'not_started', 'space: No-show before the start is refused');
select is(public.set_resource_booking_status(pg_temp.space(4, interval '-10 minutes'), 'no_show'), 'updated', 'space: No-show after the start is fine');
select is(public.set_resource_booking_status('00000000-0000-4000-8000-0000000020b4', 'confirmed'), 'updated', 'space: No-show can be undone');
select is(public.set_resource_booking_status(pg_temp.space(5, interval '-10 minutes', 'cancelled'), 'attended'), 'invalid', 'space: a cancelled booking can''t be marked');
select is(public.set_resource_booking_status('00000000-0000-4000-8000-0000000020b3', 'confirmed'), 'invalid', 'space: a booked booking can''t be "undone"');

select is(public.set_seat_booking_status(pg_temp.seat(1, interval '31 minutes'), 'attended'), 'not_started', 'seat: Arrived 31 minutes early is refused');
select is(public.set_seat_booking_status(pg_temp.seat(2, interval '29 minutes'), 'attended'), 'updated', 'seat: Arrived 29 minutes early is fine');
select is(public.set_seat_booking_status('00000000-0000-4000-8000-000000002082', 'confirmed'), 'updated', 'seat: Arrived can be undone');
select is(public.set_seat_booking_status(pg_temp.seat(3, interval '1 minute'), 'no_show'), 'not_started', 'seat: No-show before the start is refused');
select is(public.set_seat_booking_status(pg_temp.seat(4, interval '-10 minutes'), 'no_show'), 'updated', 'seat: No-show after the start is fine');
select is(public.set_seat_booking_status('00000000-0000-4000-8000-000000002084', 'confirmed'), 'updated', 'seat: No-show can be undone');
select is(public.set_seat_booking_status(pg_temp.seat(5, interval '-10 minutes', 'cancelled'), 'attended'), 'invalid', 'seat: a cancelled seat can''t be marked');
select is(public.set_seat_booking_status('00000000-0000-4000-8000-000000002099', 'attended'), 'not_found', 'seat: an unknown booking is not found');

select * from finish();
rollback;
