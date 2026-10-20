-- Whole-space bookings: book_resource / cancel_resource_booking / set_resource_booking_status.
-- Org R (…11a0, max 2 upcoming bookings per player): Pitch 1 (…11c0, ৳2,500/h, 60-min slots) with an
-- open-play session reserving it 19:00–20:00 on Fri 15 Jan 2027 (Dhaka). Players A and B, staff S.
-- Org X (…11a9) owns Pitch X (…11c9). Opening hours and the booking window are checked in TypeScript.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000011d1', 'rb-a@test.local'),
  ('00000000-0000-4000-8000-0000000011d2', 'rb-b@test.local'),
  ('00000000-0000-4000-8000-0000000011d3', 'rb-s@test.local');
insert into public.organizations (id, slug, name, business_type, status, max_upcoming_bookings) values
  ('00000000-0000-4000-8000-0000000011a0', 'rb-org-p', 'Org R', 'turf', 'live', 2),
  ('00000000-0000-4000-8000-0000000011a9', 'rb-org-x', 'Org X', 'turf', 'live', 2);
insert into public.organization_members (organization_id, user_id, role)
values ('00000000-0000-4000-8000-0000000011a0', '00000000-0000-4000-8000-0000000011d3', 'staff');
insert into public.branches (id, organization_id, name) values
  ('00000000-0000-4000-8000-0000000011b0', '00000000-0000-4000-8000-0000000011a0', 'Main'),
  ('00000000-0000-4000-8000-0000000011b9', '00000000-0000-4000-8000-0000000011a9', 'X main');
insert into public.resources (id, organization_id, branch_id, name, kind, capacity, price_per_hour_poisha, slot_minutes) values
  ('00000000-0000-4000-8000-0000000011c0', '00000000-0000-4000-8000-0000000011a0', '00000000-0000-4000-8000-0000000011b0', 'Pitch 1', 'pitch', 14, 250000, 60),
  ('00000000-0000-4000-8000-0000000011c9', '00000000-0000-4000-8000-0000000011a9', '00000000-0000-4000-8000-0000000011b9', 'Pitch X', 'pitch', 14, 250000, 60);
insert into public.player_profiles (id, organization_id, user_id, display_name, skill) values
  ('00000000-0000-4000-8000-0000000011e1', '00000000-0000-4000-8000-0000000011a0', '00000000-0000-4000-8000-0000000011d1', 'A', 3),
  ('00000000-0000-4000-8000-0000000011e2', '00000000-0000-4000-8000-0000000011a0', '00000000-0000-4000-8000-0000000011d2', 'B', 3);
insert into public.open_play_sessions (id, organization_id, branch_id, starts_at, ends_at, seat_price_poisha)
values ('00000000-0000-4000-8000-0000000011f0', '00000000-0000-4000-8000-0000000011a0', '00000000-0000-4000-8000-0000000011b0',
        '2027-01-15 19:00+06', '2027-01-15 20:00+06', 30000);
insert into public.resource_reservations (organization_id, resource_id, period, source, source_id)
values ('00000000-0000-4000-8000-0000000011a0', '00000000-0000-4000-8000-0000000011c0',
        tstzrange('2027-01-15 19:00+06', '2027-01-15 20:00+06'), 'session', '00000000-0000-4000-8000-0000000011f0');

create temp table b (label text primary key, status text, id uuid);
grant select on b to authenticated; -- the "who sees what" checks compare against it as a signed-in user
create function pg_temp.book(label text, at text, slots int, profile uuid, guest text, phone text, by_user uuid, org uuid default '00000000-0000-4000-8000-0000000011a0', res uuid default '00000000-0000-4000-8000-0000000011c0')
returns text language sql as $$
  insert into b select label, r.status, r.booking_id from public.book_resource(org, res, at::timestamptz, slots, profile, guest, phone, by_user) r
  returning status;
$$;

-- Booking and overlaps
select is(pg_temp.book('a20', '2027-01-15 20:00+06', 1, '00000000-0000-4000-8000-0000000011e1', null, null, '00000000-0000-4000-8000-0000000011d1'), 'booked', 'A books Pitch 1 for 8–9pm');
select is((select price_poisha from public.resource_bookings where id = (select id from b where label = 'a20')), 250000, 'priced at the hourly rate');
select is((select count(*)::int from public.resource_reservations where source = 'booking' and source_id = (select id from b where label = 'a20')), 1, 'and it reserves the pitch');
select is(pg_temp.book('b20', '2027-01-15 20:00+06', 1, '00000000-0000-4000-8000-0000000011e2', null, null, '00000000-0000-4000-8000-0000000011d2'), 'taken', 'B cannot book the same slot');
select is(pg_temp.book('b19', '2027-01-15 19:00+06', 1, '00000000-0000-4000-8000-0000000011e2', null, null, '00000000-0000-4000-8000-0000000011d2'), 'taken', 'nor a slot held by open play');
select is(pg_temp.book('b21', '2027-01-15 21:00+06', 1, '00000000-0000-4000-8000-0000000011e2', null, null, '00000000-0000-4000-8000-0000000011d2'), 'booked', 'back-to-back bookings are fine');

-- Walk-ins
select is(pg_temp.book('w22', '2027-01-15 22:00+06', 1, null, 'Karim', '+8801712345678', '00000000-0000-4000-8000-0000000011d3'), 'booked', 'staff book a walk-in by name and phone');
select is((select count(*)::int from public.notifications where payload->>'booking_id' = (select id::text from b where label = 'w22')), 0, 'a walk-in gets no notification');
select throws_ok(
  $$ insert into public.resource_bookings (organization_id, resource_id, profile_id, guest_name, guest_phone, period, price_poisha)
     values ('00000000-0000-4000-8000-0000000011a0', '00000000-0000-4000-8000-0000000011c0', '00000000-0000-4000-8000-0000000011e1',
             'Karim', '+8801712345678', tstzrange('2027-02-01 10:00+06', '2027-02-01 11:00+06'), 0) $$,
  '23514', null, 'a booking is for a player or a walk-in, not both'
);
select throws_ok(
  $$ insert into public.resource_bookings (organization_id, resource_id, guest_name, period, price_poisha)
     values ('00000000-0000-4000-8000-0000000011a0', '00000000-0000-4000-8000-0000000011c0', 'Karim',
             tstzrange('2027-02-01 10:00+06', '2027-02-01 11:00+06'), 0) $$,
  '23514', null, 'a walk-in needs a phone as well as a name'
);

-- The upcoming-bookings limit (2 at this venue)
select is(pg_temp.book('a17', '2027-01-15 17:00+06', 1, '00000000-0000-4000-8000-0000000011e1', null, null, '00000000-0000-4000-8000-0000000011d1'), 'booked', 'A takes a second booking');
select is(pg_temp.book('a16', '2027-01-15 16:00+06', 1, '00000000-0000-4000-8000-0000000011e1', null, null, '00000000-0000-4000-8000-0000000011d1'), 'limit_reached', 'A cannot hold a third');
select is(pg_temp.book('w16', '2027-01-15 16:00+06', 1, null, 'Nila', '+8801812345678', '00000000-0000-4000-8000-0000000011d3'), 'booked', 'walk-ins do not count toward anyone''s limit');

-- Invalid requests
select is(pg_temp.book('x1', '2027-01-15 12:00+06', 5, '00000000-0000-4000-8000-0000000011e2', null, null, '00000000-0000-4000-8000-0000000011d2'), 'invalid', 'at most 4 slots at once');
select is(pg_temp.book('x2', '2027-01-15 12:00+06', 1, '00000000-0000-4000-8000-0000000011e2', null, null, '00000000-0000-4000-8000-0000000011d2',
                       res => '00000000-0000-4000-8000-0000000011c9'), 'invalid', 'another venue''s pitch is refused');
select is(pg_temp.book('x3', '2027-01-15 12:00+06', 1, null, null, null, '00000000-0000-4000-8000-0000000011d3'), 'invalid', 'a booking needs a player or a walk-in');

-- Notifications
select is(
  (select payload - 'booking_id' from public.notifications where kind = 'booking_confirmed' and payload->>'booking_id' = (select id::text from b where label = 'a20')),
  jsonb_build_object('resource_name', 'Pitch 1', 'starts_at', '2027-01-15 20:00+06'::timestamptz, 'ends_at', '2027-01-15 21:00+06'::timestamptz, 'price_poisha', 250000),
  'A is told the booking is confirmed (space, time and price)'
);
select is(
  (select link || '/' || email_status from public.notifications where payload->>'booking_id' = (select id::text from b where label = 'a20')),
  '/me/bookings/pending', 'linking to My bookings, with an email pending'
);

-- Cancelling
select is(public.cancel_resource_booking((select id from b where label = 'a20'), '00000000-0000-4000-8000-0000000011d1'), 'cancelled', 'A cancels the 8pm booking');
select is((select count(*)::int from public.resource_reservations where source = 'booking' and source_id = (select id from b where label = 'a20')), 0, 'which frees the pitch');
select is(pg_temp.book('b20b', '2027-01-15 20:00+06', 1, '00000000-0000-4000-8000-0000000011e2', null, null, '00000000-0000-4000-8000-0000000011d2'), 'booked', 'so B can book 8pm now');
select is(public.cancel_resource_booking((select id from b where label = 'a20'), '00000000-0000-4000-8000-0000000011d1'), 'not_cancellable', 'cancelling twice is refused');
select is((select payload->>'by_venue' from public.notifications where kind = 'booking_cancelled' and payload->>'booking_id' = (select id::text from b where label = 'a20')), 'false', 'A''s own cancellation is not by the venue');
select is(public.cancel_resource_booking((select id from b where label = 'a17'), '00000000-0000-4000-8000-0000000011d3'), 'cancelled', 'staff cancel A''s 5pm booking');
select is((select payload->>'by_venue' from public.notifications where kind = 'booking_cancelled' and payload->>'booking_id' = (select id::text from b where label = 'a17')), 'true', 'and A is told the venue cancelled it');
select is(public.cancel_resource_booking('00000000-0000-4000-8000-00000000ffff', '00000000-0000-4000-8000-0000000011d3'), 'not_found', 'an unknown booking is not found');

-- Attendance
select is(public.set_resource_booking_status((select id from b where label = 'b21'), 'no_show'), 'updated', 'staff mark a confirmed booking as a no-show');
select is(public.set_resource_booking_status((select id from b where label = 'a20'), 'attended'), 'invalid', 'a cancelled booking cannot be marked');

-- Who sees what
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000011d1","role":"authenticated"}';
select is(
  (select count(*)::int from public.resource_bookings where organization_id = '00000000-0000-4000-8000-0000000011a0' and profile_id is distinct from '00000000-0000-4000-8000-0000000011e1'),
  0, 'a player sees only their own bookings'
);
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000011d2","role":"authenticated"}';
select is(
  (select count(*)::int from public.resource_bookings where organization_id = '00000000-0000-4000-8000-0000000011a0'),
  (select count(*)::int from b where status = 'booked' and label like 'b%'), 'and so does every other player'
);
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000011d3","role":"authenticated"}';
select is(
  (select count(*)::int from public.resource_bookings where organization_id = '00000000-0000-4000-8000-0000000011a0'),
  (select count(*)::int from b where status = 'booked'), 'staff see every booking at their venue, walk-ins included'
);
select throws_ok(
  $$ select * from public.book_resource('00000000-0000-4000-8000-0000000011a0', '00000000-0000-4000-8000-0000000011c0', '2027-01-16 10:00+06', 1,
                                        '00000000-0000-4000-8000-0000000011e1', null, null, '00000000-0000-4000-8000-0000000011d1') $$,
  '42501', null, 'signed-in users cannot call book_resource directly'
);
reset role;

select * from finish();
rollback;
