-- Paying for online bookings by bKash or Nagad — booking, sending the details, holds ending (spec §2, §4.3).
-- A player's online booking of a priced space is pending with a 15-minute hold and no "booked" notice yet; a ৳0
-- space and a staff booking stay instant; with no number it can't be requested. Only the booking's player sends
-- the details, within the hold, for a service the brand has, with a transaction ID used once. Holds that end are
-- cancelled by the job (a booking whose details were sent never is). Org …37a0: turf (Pitch 1 ৳2,500/h, Table ৳0),
-- players A (b1/c1) and B (b2/c2), turf staff b3.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000037' || suffix)::uuid $$;
create function pg_temp.at(days int, hhmm text) returns timestamptz language sql as $$
  select ((now() at time zone 'Asia/Dhaka')::date + days + hhmm::time) at time zone 'Asia/Dhaka';
$$;
-- Books as a player online (p_by_player) unless `staff`.
create function pg_temp.book(resource text, profile text, starts timestamptz, staff boolean default false) returns text language sql as $$
  select status || coalesce(':' || booking_id::text, '') from public.book_resource(
    pg_temp.id('a0'), pg_temp.id(resource), starts, 1, pg_temp.id(profile), null, null,
    case when staff then pg_temp.id('b3') else pg_temp.id('b' || substr(profile, 2)) end, not staff)
$$;
create function pg_temp.booking(result text) returns uuid language sql as $$ select split_part(result, ':', 2)::uuid $$;
create temp table r (label text primary key, result text);

insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-37@test.local' from generate_series(1, 3) n;
insert into public.organizations (id, slug, name, business_type, status, bkash_number) values
  (pg_temp.id('a0'), 'pay-37', 'Pay 37', 'turf', 'live', '01712345678');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b3'), 'staff');
insert into public.sections (id, organization_id, name, kind, slug) values (pg_temp.id('f1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf');
insert into public.section_staff (organization_id, section_id, user_id) values (pg_temp.id('a0'), pg_temp.id('f1'), pg_temp.id('b3'));
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  (pg_temp.id('c1'), pg_temp.id('a0'), pg_temp.id('b1'), 'Sami'),
  (pg_temp.id('c2'), pg_temp.id('a0'), pg_temp.id('b2'), 'Tanvir');
insert into public.resources (id, organization_id, section_id, name, kind, capacity, price_per_hour_poisha) values
  (pg_temp.id('d1'), pg_temp.id('a0'), pg_temp.id('f1'), 'Pitch 1', 'pitch', 14, 250000),
  (pg_temp.id('d2'), pg_temp.id('a0'), pg_temp.id('f1'), 'Table', 'table', 4, null);

-- Requesting a priced space online: pending, held 15 minutes, no "booked" notice.
insert into r values ('a1', pg_temp.book('d1', 'c1', pg_temp.at(1, '20:00')));
select is(split_part((select result from r where label = 'a1'), ':', 1), 'pending', 'a player''s online booking of a priced space is pending');
select is((select status::text from public.resource_bookings where id = pg_temp.booking((select result from r where label = 'a1'))), 'pending', 'and stored as pending');
select ok((select hold_until between now() + interval '14 minutes' and now() + interval '16 minutes' from public.resource_bookings
  where id = pg_temp.booking((select result from r where label = 'a1'))), 'held for 15 minutes');
select is((select count(*)::int from public.resource_reservations where source = 'booking' and source_id = pg_temp.booking((select result from r where label = 'a1'))), 1,
  'the slot is held');
select is((select count(*)::int from public.notifications where profile_id = pg_temp.id('c1')), 0, 'and nobody is told "booked" yet');
select is(pg_temp.book('d1', 'c2', pg_temp.at(1, '20:00')), 'taken', 'another player can''t take the held slot');

-- The limit counts pending bookings.
update public.sections set max_upcoming_bookings = 1 where id = pg_temp.id('f1');
select is(pg_temp.book('d1', 'c1', pg_temp.at(2, '20:00')), 'limit_reached', 'a pending booking counts toward the limit');
update public.sections set max_upcoming_bookings = 10 where id = pg_temp.id('f1');

-- Instant as before: a ৳0 space, and a booking by the team.
select is(split_part(pg_temp.book('d2', 'c1', pg_temp.at(1, '20:00')), ':', 1), 'booked', 'a space priced at the venue is booked straight away');
select is(split_part(pg_temp.book('d1', 'c2', pg_temp.at(1, '18:00'), true), ':', 1), 'booked', 'a booking by the team is booked straight away');

-- No number: priced spaces can't be requested.
update public.organizations set bkash_number = null where id = pg_temp.id('a0');
select is(pg_temp.book('d1', 'c2', pg_temp.at(3, '20:00')), 'payment_closed', 'with no number, a priced space can''t be requested');
select is((select count(*)::int from public.resource_bookings where resource_id = pg_temp.id('d1') and lower(period) = pg_temp.at(3, '20:00')), 0, 'and nothing is held');
update public.organizations set bkash_number = '01712345678' where id = pg_temp.id('a0');

-- Sending the details.
create function pg_temp.send(booking uuid, who text, method text, phone text, trx text) returns text language sql as $$
  select public.submit_payment_claim(booking, pg_temp.id(who), method, phone, trx)
$$;
select is(pg_temp.send(pg_temp.booking((select result from r where label = 'a1')), 'b2', 'bkash', '01911111111', '9JK7ABC123'), 'not_yours', 'only the booking''s player sends its details');
select is(pg_temp.send(pg_temp.booking((select result from r where label = 'a1')), 'b1', 'nagad', '01911111111', '9JK7ABC123'), 'method_closed', 'not by a service the venue has no number for');
select is(pg_temp.send(pg_temp.booking((select result from r where label = 'a1')), 'b1', 'bkash', '0191111111', '9JK7ABC123'), 'invalid', 'a 10-digit sender number is refused');
select is(pg_temp.send(pg_temp.booking((select result from r where label = 'a1')), 'b1', 'bkash', '01911111111', 'AB12'), 'invalid', 'so is a 4-character transaction ID');
select is(pg_temp.send(pg_temp.booking((select result from r where label = 'a1')), 'b1', 'bkash', '01911111111', ' 9jk7 abc123 '), 'submitted', 'the player sends their details');
select row_eq(
  format($$ select method, sender_phone, trx_id, amount_poisha, status from public.payment_claims where booking_id = %L $$, pg_temp.booking((select result from r where label = 'a1'))),
  row('bkash'::text, '01911111111'::text, '9JK7ABC123'::text, 250000, 'submitted'::text),
  'kept with the transaction ID tidied and the booking''s price');
select is((select hold_until from public.resource_bookings where id = pg_temp.booking((select result from r where label = 'a1'))), null, 'the hold gives way to waiting for the venue');
select is(pg_temp.send(pg_temp.booking((select result from r where label = 'a1')), 'b1', 'bkash', '01911111111', 'ZZZ99999'), 'not_pending', 'details are sent once');
insert into r values ('a2', pg_temp.book('d1', 'c1', pg_temp.at(4, '20:00')));
select is(pg_temp.send(pg_temp.booking((select result from r where label = 'a2')), 'b1', 'bkash', '01922222222', '9JK7 ABC123'), 'trx_used', 'a transaction ID is used once (spaces and case don''t matter)');
select is(pg_temp.send(pg_temp.booking((select result from r where label = 'a1')), 'b1', 'bkash', '01911111111', 'ZZZ99999'), 'not_pending', 'and a booking already waiting for the venue takes nothing more');

-- Holds that end.
insert into r values ('a3', pg_temp.book('d1', 'c2', pg_temp.at(5, '20:00')));
update public.resource_bookings set hold_until = now() - interval '1 minute' where id = pg_temp.booking((select result from r where label = 'a3'));
select is(public.expire_payment_holds(), 1, 'the job ends one hold that ran out');
select is((select status::text from public.resource_bookings where id = pg_temp.booking((select result from r where label = 'a3'))), 'cancelled', 'that booking is cancelled');
select is((select count(*)::int from public.resource_reservations where source = 'booking' and source_id = pg_temp.booking((select result from r where label = 'a3'))), 0, 'and its slot is free');
select is((select count(*)::int from public.notifications where profile_id = pg_temp.id('c2') and kind = 'booking_hold_expired'), 1, 'its player hears the hold ended');
select is(public.expire_payment_holds(now() + interval '3 days'), 1,
  'later on only the newer hold ends (a2) — a booking whose details were sent is never ended, even after it starts');
select is((select status::text from public.resource_bookings where id = pg_temp.booking((select result from r where label = 'a1'))), 'pending', 'a1 is still waiting for the venue');

-- Review Focus 1: details sent after the hold ended, when someone else took the slot, attach to nothing.
insert into r values ('a4', pg_temp.book('d1', 'c1', pg_temp.at(6, '20:00')));
select public.expire_payment_holds(now() + interval '16 minutes');
insert into r values ('b4', pg_temp.book('d1', 'c2', pg_temp.at(6, '20:00')));
select is(split_part((select result from r where label = 'b4'), ':', 1), 'pending', 'once the hold ended, someone else can request the slot');
select is(pg_temp.send(pg_temp.booking((select result from r where label = 'a4')), 'b1', 'bkash', '01933333333', 'LATE1234'), 'hold_over', 'the first player''s late details are refused');
select is((select count(*)::int from public.payment_claims where trx_id = 'LATE1234'), 0, 'and attach to no booking');

-- Only the job and the site call these.
set local role authenticated;
select throws_ok($$ select public.submit_payment_claim('00000000-0000-4000-8000-0000000037ff', '00000000-0000-4000-8000-0000000037b1', 'bkash', '01911111111', 'ABCDEF12') $$,
  '42501', null, 'signed-in users can''t send details directly');
select throws_ok($$ select public.expire_payment_holds() $$, '42501', null, 'nor end holds');
reset role;

select * from finish();
rollback;
