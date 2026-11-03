-- Paying for online bookings by bKash or Nagad — the team decides (spec §3.2, §4.3). Owners and the staff of the
-- booking's section confirm (booked, a bKash/Nagad payment recorded, the player told) or reject (cancelled, the slot
-- freed, the player told why, with the venue's number); a booking can't be marked Arrived while pending; the player
-- cancels their own request only before sending details, the team any time; only owners set the numbers.
-- Org …38a0: turf f1 (Pitch 1 ৳2,500/h), café f2. Owner b1, turf staff b2, café staff b3, players b4/c4 and b5/c5.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000038' || suffix)::uuid $$;
create function pg_temp.at(days int, hhmm text) returns timestamptz language sql as $$
  select ((now() at time zone 'Asia/Dhaka')::date + days + hhmm::time) at time zone 'Asia/Dhaka';
$$;
-- A request by player n on Pitch 1 at day `days` 20:00, with details sent unless `send` is false.
create function pg_temp.request(n int, days int, trx text, send boolean default true) returns uuid language plpgsql as $$
declare v uuid;
begin
  select booking_id into v from public.book_resource(pg_temp.id('a0'), pg_temp.id('d1'), pg_temp.at(days, '20:00'), 1, pg_temp.id('c' || n), null, null, pg_temp.id('b' || n), true);
  if send then perform public.submit_payment_claim(v, pg_temp.id('b' || n), 'bkash', '01911111111', trx); end if;
  return v;
end $$;
create temp table k (label text primary key, id uuid);

insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-38@test.local' from generate_series(1, 5) n;
insert into public.organizations (id, slug, name, business_type, status, bkash_number) values (pg_temp.id('a0'), 'pay-38', 'Pay 38', 'turf', 'live', '01712345678');
insert into public.sections (id, organization_id, name, kind, slug) values
  (pg_temp.id('f1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf'),
  (pg_temp.id('f2'), pg_temp.id('a0'), 'Café', 'boardgame_cafe', 'cafe');
insert into public.organization_members (organization_id, user_id, role) values
  (pg_temp.id('a0'), pg_temp.id('b1'), 'owner'), (pg_temp.id('a0'), pg_temp.id('b2'), 'staff'), (pg_temp.id('a0'), pg_temp.id('b3'), 'staff');
insert into public.section_staff (organization_id, section_id, user_id) values
  (pg_temp.id('a0'), pg_temp.id('f1'), pg_temp.id('b2')), (pg_temp.id('a0'), pg_temp.id('f2'), pg_temp.id('b3'));
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  (pg_temp.id('c4'), pg_temp.id('a0'), pg_temp.id('b4'), 'Sami'), (pg_temp.id('c5'), pg_temp.id('a0'), pg_temp.id('b5'), 'Tanvir');
insert into public.resources (id, organization_id, section_id, name, kind, capacity, price_per_hour_poisha) values
  (pg_temp.id('d1'), pg_temp.id('a0'), pg_temp.id('f1'), 'Pitch 1', 'pitch', 14, 250000);

insert into k values ('one', pg_temp.request(4, 1, 'TRXONE111')), ('two', pg_temp.request(5, 2, 'TRXTWO222')),
                     ('held', pg_temp.request(4, 3, null, false));
create function pg_temp.k(label text) returns uuid language sql as $$ select id from k where k.label = $1 $$;

-- Who may decide.
select is(public.decide_payment_claim(pg_temp.k('one'), pg_temp.id('b3'), 'confirm'), 'not_allowed', 'café staff can''t decide a turf payment');
select is(public.decide_payment_claim(pg_temp.k('one'), pg_temp.id('b5'), 'confirm'), 'not_allowed', 'nor can a player');
select is(public.decide_payment_claim(pg_temp.k('one'), pg_temp.id('b2'), 'maybe'), 'invalid', 'confirm or reject only');
select is(public.decide_payment_claim(pg_temp.k('held'), pg_temp.id('b2'), 'confirm'), 'nothing_sent', 'a request with no details yet can''t be decided');

-- Confirm.
select is(public.decide_payment_claim(pg_temp.k('one'), pg_temp.id('b2'), 'confirm'), 'confirmed', 'turf staff confirm a turf payment');
select is((select status::text from public.resource_bookings where id = pg_temp.k('one')), 'confirmed', 'the booking is booked');
select row_eq(
  format($$ select method, reference, amount_poisha, taken_by from public.payments where resource_booking_id = %L and voided_at is null $$, pg_temp.k('one')),
  row('bkash'::text, 'TRXONE111'::text, 250000, pg_temp.id('b2')),
  'a bKash payment of the price is recorded, with the transaction ID and who confirmed');
select row_eq(
  format($$ select status, decided_by from public.payment_claims where booking_id = %L $$, pg_temp.k('one')),
  row('confirmed'::text, pg_temp.id('b2')), 'the claim says who confirmed it');
select is((select count(*)::int from public.notifications where profile_id = pg_temp.id('c4') and kind = 'booking_confirmed'), 1, 'the player hears it''s booked');
select is((select payload ->> 'paid_method' from public.notifications where profile_id = pg_temp.id('c4') and kind = 'booking_confirmed'), 'bkash',
  'and that it was paid by bKash (not "pay at the venue")');
select is(public.decide_payment_claim(pg_temp.k('one'), pg_temp.id('b1'), 'confirm'), 'not_pending', 'deciding again changes nothing');
select is(public.set_resource_booking_status(pg_temp.k('two'), 'attended'), 'invalid', 'a pending booking can''t be marked Arrived');

-- Reject.
select is(public.decide_payment_claim(pg_temp.k('two'), pg_temp.id('b1'), 'reject', repeat('x', 201)), 'invalid', 'a reason is at most 200 characters');
select is(public.decide_payment_claim(pg_temp.k('two'), pg_temp.id('b1'), 'reject', 'Payment not found'), 'rejected', 'the owner rejects one');
select is((select status::text from public.resource_bookings where id = pg_temp.k('two')), 'cancelled', 'that booking is cancelled');
select is((select count(*)::int from public.resource_reservations where source = 'booking' and source_id = pg_temp.k('two')), 0, 'its slot is free');
select row_eq(
  format($$ select status, reason from public.payment_claims where booking_id = %L $$, pg_temp.k('two')),
  row('rejected'::text, 'Payment not found'::text), 'the claim keeps why');
select row_eq(
  $$ select payload ->> 'reason', payload ->> 'contact_phone' from public.notifications
     where profile_id = '00000000-0000-4000-8000-0000000038c5' and kind = 'booking_payment_rejected' $$,
  row('Payment not found'::text, '01712345678'::text), 'the player hears why, with the venue''s number');
select is((select count(*)::int from public.payments where resource_booking_id = pg_temp.k('two')), 0, 'and nothing was recorded as paid');

-- Cancelling a request.
select is(public.cancel_resource_booking(pg_temp.k('held'), pg_temp.id('b4')), 'cancelled', 'the player cancels their own request before sending details');
insert into k values ('sent', pg_temp.request(4, 4, 'TRXSENT33'));
select is(public.cancel_resource_booking(pg_temp.k('sent'), pg_temp.id('b4')), 'not_cancellable', 'but not after sending them (contact the venue)');
select is(public.cancel_resource_booking(pg_temp.k('sent'), pg_temp.id('b2')), 'cancelled', 'the team can');
select row_eq(
  format($$ select status, reason from public.payment_claims where booking_id = %L $$, pg_temp.k('sent')),
  row('rejected'::text, 'cancelled'::text), 'and its details are kept, marked cancelled');
select is(public.decide_payment_claim(pg_temp.k('sent'), pg_temp.id('b2'), 'confirm'), 'not_pending', 'a cancelled request can''t be confirmed');

-- The numbers.
select is((select status from public.set_payment_numbers(pg_temp.id('a0'), pg_temp.id('b2'), '01799999999', null)), 'not_allowed', 'staff can''t change the numbers');
select row_eq(
  $$ select status, old_bkash, old_nagad from public.set_payment_numbers('00000000-0000-4000-8000-0000000038a0', '00000000-0000-4000-8000-0000000038b1', '0179 999 9999', '01812345678') $$,
  row('saved'::text, '01712345678'::text, null::text), 'the owner changes them and hears what they were');
select row_eq(
  $$ select bkash_number, nagad_number from public.organizations where id = '00000000-0000-4000-8000-0000000038a0' $$,
  row('01799999999'::text, '01812345678'::text), 'saved without spaces');
select is((select status from public.set_payment_numbers(pg_temp.id('a0'), pg_temp.id('b1'), '0171', null)), 'invalid', 'a short number is refused');
select is((select bkash_number from public.organizations where id = pg_temp.id('a0')), '01799999999', 'and nothing changes');

set local role authenticated;
select throws_ok($$ select public.decide_payment_claim('00000000-0000-4000-8000-0000000038ff', '00000000-0000-4000-8000-0000000038b1', 'confirm') $$,
  '42501', null, 'signed-in users can''t decide directly');
select throws_ok($$ select * from public.set_payment_numbers('00000000-0000-4000-8000-0000000038a0', '00000000-0000-4000-8000-0000000038b1', null, null) $$,
  '42501', null, 'nor set the numbers directly');
reset role;

select * from finish();
rollback;
