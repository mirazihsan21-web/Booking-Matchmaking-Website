-- Cash payments (R3): one row per payment, filled from its booking, readable and writable by the staff
-- of that booking's section and by owners, voided but never deleted. Org (…19a0) has Turf and Café.
-- Owner O (…19d1), turf-only staff T (…19d2), player P (…19d3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000019d' || n)::uuid $$;
create function pg_temp.act_as(n int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'role', 'authenticated')::text, true);
$$;
create temp table s (label text primary key, id uuid);
grant select on s to authenticated;

insert into auth.users (id, email) select pg_temp.u(n), 'pay19-' || n || '@test.local' from generate_series(1, 3) n;
insert into public.organizations (id, slug, name, status) values ('00000000-0000-4000-8000-0000000019a0', 'pay-org-19', 'Pay Org', 'live');
insert into s values ('turf', public.add_section('00000000-0000-4000-8000-0000000019a0', 'turf', 'Turf'));
insert into s values ('cafe', public.add_section('00000000-0000-4000-8000-0000000019a0', 'boardgame_cafe', 'Café'));
insert into public.organization_members (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000019a0', pg_temp.u(1), 'owner'),
  ('00000000-0000-4000-8000-0000000019a0', pg_temp.u(2), 'staff');
insert into public.section_staff (organization_id, section_id, user_id) values
  ('00000000-0000-4000-8000-0000000019a0', (select id from s where label = 'turf'), pg_temp.u(2));
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values
  ('00000000-0000-4000-8000-0000000019c1', '00000000-0000-4000-8000-0000000019a0', (select id from s where label = 'turf'), 'Pitch 1', 'pitch', 14),
  ('00000000-0000-4000-8000-0000000019c2', '00000000-0000-4000-8000-0000000019a0', (select id from s where label = 'cafe'), 'Table 1', 'table', 4);
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  ('00000000-0000-4000-8000-0000000019e3', '00000000-0000-4000-8000-0000000019a0', pg_temp.u(3), 'P');
-- Turf walk-ins b1 (৳600) and b4 (to cancel), a café table b2 priced at the venue, a cancelled turf booking b3.
insert into public.resource_bookings (id, organization_id, resource_id, guest_name, guest_phone, period, price_poisha, status) values
  ('00000000-0000-4000-8000-0000000019b1', '00000000-0000-4000-8000-0000000019a0', '00000000-0000-4000-8000-0000000019c1', 'Rahim', '01712345678',
   tstzrange(now() + interval '1 day', now() + interval '25 hours'), 60000, 'confirmed'),
  ('00000000-0000-4000-8000-0000000019b2', '00000000-0000-4000-8000-0000000019a0', '00000000-0000-4000-8000-0000000019c2', 'Karim', '01712345679',
   tstzrange(now() + interval '1 day', now() + interval '25 hours'), 0, 'confirmed'),
  ('00000000-0000-4000-8000-0000000019b3', '00000000-0000-4000-8000-0000000019a0', '00000000-0000-4000-8000-0000000019c1', 'Gone', '01712345670',
   tstzrange(now() + interval '2 days', now() + interval '49 hours'), 60000, 'cancelled'),
  ('00000000-0000-4000-8000-0000000019b4', '00000000-0000-4000-8000-0000000019a0', '00000000-0000-4000-8000-0000000019c1', 'Nabila', '01712345671',
   tstzrange(now() + interval '3 days', now() + interval '73 hours'), 60000, 'confirmed');
-- A turf game with P seated (৳300).
insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min) values
  ('00000000-0000-4000-8000-0000000019f0', '00000000-0000-4000-8000-0000000019a0', (select id from s where label = 'turf'), '5-a-side', 2, 10, 60);
insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha, status) values
  ('00000000-0000-4000-8000-0000000019f1', '00000000-0000-4000-8000-0000000019a0', (select id from s where label = 'turf'), '00000000-0000-4000-8000-0000000019f0',
   now() + interval '4 days', now() + interval '97 hours', 30000, 'matched');
insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity) values
  ('00000000-0000-4000-8000-000000001991', '00000000-0000-4000-8000-0000000019a0', '00000000-0000-4000-8000-0000000019f1', '00000000-0000-4000-8000-0000000019c1', '00000000-0000-4000-8000-0000000019f0', 10);
insert into public.bookings (id, organization_id, session_id, group_id, profile_id, seat_no, price_poisha) values
  ('00000000-0000-4000-8000-000000001981', '00000000-0000-4000-8000-0000000019a0', '00000000-0000-4000-8000-0000000019f1', '00000000-0000-4000-8000-000000001991', '00000000-0000-4000-8000-0000000019e3', 1, 30000);

-- Turf staff record cash; the section and brand come from the booking, whatever the insert claims.
set local role authenticated;
select pg_temp.act_as(2);
select lives_ok(
  $$ insert into public.payments (organization_id, section_id, resource_booking_id, amount_poisha)
     values ('00000000-0000-4000-8000-000000000000', (select id from s where label = 'cafe'), '00000000-0000-4000-8000-0000000019b1', 60000) $$,
  'turf staff record cash for a turf booking'
);
select throws_ok(
  $$ insert into public.payments (resource_booking_id, amount_poisha) values ('00000000-0000-4000-8000-0000000019b2', 50000) $$,
  'P0001', 'booking_not_payable', 'turf staff cannot record cash for a café booking'
);
select throws_ok(
  $$ insert into public.payments (section_id, resource_booking_id, amount_poisha)
     values ((select id from s where label = 'turf'), '00000000-0000-4000-8000-0000000019b2', 50000) $$,
  'P0001', 'booking_not_payable', '… not even when the request claims the turf section'
);
reset role;
select is((select section_id from public.payments where resource_booking_id = '00000000-0000-4000-8000-0000000019b1'), (select id from s where label = 'turf'),
  'the payment''s section is the booking''s');
select is((select organization_id from public.payments where resource_booking_id = '00000000-0000-4000-8000-0000000019b1'), '00000000-0000-4000-8000-0000000019a0'::uuid,
  'and so is its brand');
select is((select taken_by from public.payments where resource_booking_id = '00000000-0000-4000-8000-0000000019b1'), pg_temp.u(2), 'taken_by is whoever recorded it');

-- The owner records cash anywhere; one live payment per booking; amount and method are checked.
set local role authenticated;
select pg_temp.act_as(1);
select lives_ok(
  $$ insert into public.payments (seat_booking_id, amount_poisha) values ('00000000-0000-4000-8000-000000001981', 30000) $$,
  'the owner records cash for a seat'
);
select lives_ok(
  $$ insert into public.payments (resource_booking_id, amount_poisha) values ('00000000-0000-4000-8000-0000000019b2', 50000) $$,
  'the owner records a typed amount for a café booking priced at the venue'
);
select throws_ok(
  $$ insert into public.payments (resource_booking_id, amount_poisha) values ('00000000-0000-4000-8000-0000000019b1', 60000) $$,
  '23505', null, 'a booking has at most one live payment'
);
select throws_ok(
  $$ insert into public.payments (resource_booking_id, amount_poisha) values ('00000000-0000-4000-8000-0000000019b4', 0) $$,
  '23514', null, 'the amount must be more than nothing'
);
select throws_ok(
  $$ insert into public.payments (resource_booking_id, amount_poisha) values ('00000000-0000-4000-8000-0000000019b4', 10000001) $$,
  '23514', null, 'and at most ৳100,000'
);
select throws_ok(
  $$ insert into public.payments (resource_booking_id, amount_poisha, method) values ('00000000-0000-4000-8000-0000000019b4', 60000, 'bkash') $$,
  '23514', null, 'cash is the only method so far'
);
select throws_ok(
  $$ insert into public.payments (resource_booking_id, amount_poisha) values ('00000000-0000-4000-8000-0000000019b3', 60000) $$,
  'P0001', 'booking_not_payable', 'no payment on a cancelled booking (Review Focus 1)'
);

-- Undo voids, once; nothing else changes; nothing is deleted.
select pg_temp.act_as(2);
select lives_ok(
  $$ update public.payments set voided_at = now() where resource_booking_id = '00000000-0000-4000-8000-0000000019b1' $$,
  'turf staff void their payment'
);
reset role;
select is((select voided_by from public.payments where resource_booking_id = '00000000-0000-4000-8000-0000000019b1'), pg_temp.u(2), 'voided_by is whoever voided it');
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$ update public.payments set voided_at = now() where resource_booking_id = '00000000-0000-4000-8000-0000000019b1' $$,
  'P0001', 'payment_is_void_only', 'a payment is voided only once'
);
select throws_ok(
  $$ update public.payments set amount_poisha = 1000 where resource_booking_id = '00000000-0000-4000-8000-0000000019b2' $$,
  null, null, 'the amount can''t be changed'
);
select throws_ok(
  $$ delete from public.payments where resource_booking_id = '00000000-0000-4000-8000-0000000019b2' $$,
  '42501', null, 'payments are never deleted'
);

-- Players see no payments.
select pg_temp.act_as(3);
select is((select count(*)::int from public.payments), 0, 'a player reads no payments');

-- Cancelling a paid booking or seat voids its payment in the same step.
select pg_temp.act_as(1);
insert into public.payments (resource_booking_id, amount_poisha) values ('00000000-0000-4000-8000-0000000019b4', 60000);
reset role;
select public.cancel_resource_booking('00000000-0000-4000-8000-0000000019b4', pg_temp.u(1));
select * from public.cancel_booking('00000000-0000-4000-8000-000000001981', true);
select is(
  (select count(*)::int from public.payments where voided_at is not null
     and (resource_booking_id = '00000000-0000-4000-8000-0000000019b4' or seat_booking_id = '00000000-0000-4000-8000-000000001981')),
  2, 'cancelling a paid booking or seat voids its payment'
);

-- Website fields and the photo limit.
select throws_ok(
  $$ update public.sections set description = repeat('x', 301) where id = (select id from s where label = 'turf') $$,
  '23514', null, 'a section description is at most 300 characters'
);
select is((select file_size_limit from storage.buckets where id = 'org-assets'), 5242880::bigint, 'photos up to 5 MB fit in org-assets');

select * from finish();
rollback;
