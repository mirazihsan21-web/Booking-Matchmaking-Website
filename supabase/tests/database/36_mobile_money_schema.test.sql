-- Paying for online bookings by bKash or Nagad — the schema: a booking can be pending with a hold, the brand has
-- its bKash and Nagad numbers, payments take bKash and Nagad with the transaction ID, and payment_claims keeps what
-- a player sent (one per booking, each transaction ID once per brand), seen only by that player and the team for
-- the booking's section. Org …36a0 (turf + café), org …36b0. Owner b1, turf staff b2, café staff b3, players b4/b5.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000036' || suffix)::uuid $$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(u), 'role', 'authenticated')::text, true);
end $$;
create temp table s (label text primary key, id uuid);
grant select on s to authenticated;

insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-36@test.local' from generate_series(1, 5) n;
insert into public.organizations (id, slug, name, business_type, status) values
  (pg_temp.id('a0'), 'pay-36', 'Pay 36', 'turf', 'live'),
  (pg_temp.id('b0'), 'pay-36b', 'Pay 36b', 'turf', 'live');
insert into s values ('turf', public.add_section(pg_temp.id('a0'), 'turf', 'Turf'));
insert into s values ('cafe', public.add_section(pg_temp.id('a0'), 'boardgame_cafe', 'Café'));
insert into s values ('other', public.add_section(pg_temp.id('b0'), 'turf', 'Turf'));
insert into public.organization_members (organization_id, user_id, role) values
  (pg_temp.id('a0'), pg_temp.id('b1'), 'owner'),
  (pg_temp.id('a0'), pg_temp.id('b2'), 'staff'),
  (pg_temp.id('a0'), pg_temp.id('b3'), 'staff');
insert into public.section_staff (organization_id, section_id, user_id) values
  (pg_temp.id('a0'), (select id from s where label = 'turf'), pg_temp.id('b2')),
  (pg_temp.id('a0'), (select id from s where label = 'cafe'), pg_temp.id('b3'));
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  (pg_temp.id('c4'), pg_temp.id('a0'), pg_temp.id('b4'), 'Sami'),
  (pg_temp.id('c5'), pg_temp.id('a0'), pg_temp.id('b5'), 'Tanvir'),
  (pg_temp.id('c6'), pg_temp.id('b0'), pg_temp.id('b4'), 'Sami');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values
  (pg_temp.id('d1'), pg_temp.id('a0'), (select id from s where label = 'turf'), 'Pitch 1', 'pitch', 14),
  (pg_temp.id('d2'), pg_temp.id('b0'), (select id from s where label = 'other'), 'Pitch 1', 'pitch', 14);
insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha, status, hold_until) values
  (pg_temp.id('e1'), pg_temp.id('a0'), pg_temp.id('d1'), pg_temp.id('c4'), tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour'), 250000, 'pending', now() + interval '15 minutes'),
  (pg_temp.id('e2'), pg_temp.id('a0'), pg_temp.id('d1'), pg_temp.id('c4'), tstzrange(now() + interval '2 days', now() + interval '2 days 1 hour'), 250000, 'pending', null),
  (pg_temp.id('e3'), pg_temp.id('b0'), pg_temp.id('d2'), pg_temp.id('c6'), tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour'), 250000, 'pending', null),
  -- a booked one, for the payment checks (a pending booking can't be paid at all)
  (pg_temp.id('e4'), pg_temp.id('a0'), pg_temp.id('d1'), pg_temp.id('c5'), tstzrange(now() + interval '3 days', now() + interval '3 days 1 hour'), 250000, 'confirmed', null);

-- The columns.
select has_column('public', 'resource_bookings', 'hold_until', 'a booking can carry a hold');
select has_column('public', 'organizations', 'bkash_number', 'the brand has a bKash number');
select has_column('public', 'organizations', 'nagad_number', 'and a Nagad number');
select has_column('public', 'payments', 'reference', 'a payment keeps its transaction ID');
select is((select status::text from public.resource_bookings where id = pg_temp.id('e1')), 'pending', 'a booking can be pending');
select throws_ok($$ update public.organizations set bkash_number = '12345' where id = '00000000-0000-4000-8000-0000000036a0' $$,
  '23514', null, 'a number must be an 11-digit Bangladeshi mobile number');
select lives_ok($$ update public.organizations set bkash_number = '01712345678', nagad_number = '01812345678' where id = '00000000-0000-4000-8000-0000000036a0' $$,
  'a real number is fine');

-- Payments: cash, bKash or Nagad; a transaction ID only for the last two.
select throws_ok($$ insert into public.payments (resource_booking_id, amount_poisha, method) values ('00000000-0000-4000-8000-0000000036e4', 250000, 'card') $$,
  '23514', null, 'no other way of paying');
select throws_ok($$ insert into public.payments (resource_booking_id, amount_poisha, method) values ('00000000-0000-4000-8000-0000000036e4', 250000, 'bkash') $$,
  '23514', null, 'a bKash payment needs its transaction ID');

-- Claims: one per booking, each transaction ID once per brand.
insert into public.payment_claims (organization_id, booking_id, method, sender_phone, trx_id, amount_poisha) values
  (pg_temp.id('a0'), pg_temp.id('e2'), 'bkash', '01911111111', '9JK7ABC123', 250000);
select throws_ok($$ insert into public.payment_claims (organization_id, booking_id, method, sender_phone, trx_id, amount_poisha)
  values ('00000000-0000-4000-8000-0000000036a0', '00000000-0000-4000-8000-0000000036e1', 'nagad', '01911111111', '9JK7ABC123', 250000) $$,
  '23505', null, 'a transaction ID is used once at the brand');
select lives_ok($$ insert into public.payment_claims (organization_id, booking_id, method, sender_phone, trx_id, amount_poisha)
  values ('00000000-0000-4000-8000-0000000036b0', '00000000-0000-4000-8000-0000000036e3', 'bkash', '01911111111', '9JK7ABC123', 250000) $$,
  'another brand may see the same one');
select throws_ok($$ insert into public.payment_claims (organization_id, booking_id, method, sender_phone, trx_id, amount_poisha)
  values ('00000000-0000-4000-8000-0000000036a0', '00000000-0000-4000-8000-0000000036e1', 'bkash', '0191111', 'ABCDEF12', 250000) $$,
  '23514', null, 'the sender''s number is checked');

-- Who can read a claim: the booking's player and the team for its section; nobody writes from the browser.
select pg_temp.as_user('b4');
select is((select count(*)::int from public.payment_claims where organization_id = pg_temp.id('a0')), 1, 'the player reads their own claim');
select pg_temp.as_user('b1');
select is((select count(*)::int from public.payment_claims), 1, 'the owner reads it');
select pg_temp.as_user('b2');
select is((select count(*)::int from public.payment_claims), 1, 'the turf staff read it');
select pg_temp.as_user('b3');
select is((select count(*)::int from public.payment_claims), 0, 'the café staff don''t');
select pg_temp.as_user('b5');
select is((select count(*)::int from public.payment_claims), 0, 'nor does another player');
select throws_ok($$ insert into public.payment_claims (organization_id, booking_id, method, sender_phone, trx_id, amount_poisha)
  values ('00000000-0000-4000-8000-0000000036a0', '00000000-0000-4000-8000-0000000036e1', 'bkash', '01911111111', 'ZZZZZZ99', 250000) $$,
  '42501', null, 'claims are only written by the database''s own functions');
reset role;

select * from finish();
rollback;
