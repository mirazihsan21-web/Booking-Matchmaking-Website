-- Booking RPCs: cancel → offer → accept / decline / expire, with every reply edge case.
-- IDs: org=…0a1, branch=…0a2, resource=…0b1, activity=…0c1, session=…0e1, group=…0f1,
--      profiles …1d1–…1da (users …5d1–…5da), bookings …2b1–…2b4, waitlist entries …3a4–…3a9.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'owner@test.local');
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000005d' || n)::uuid, 'player-' || n || '@test.local'
from unnest(array['1', '2', '3', '4', '5', '6', '7', '8', '9', 'a']) as n;
insert into public.organizations (id, slug, name, business_type, created_by)
values ('00000000-0000-4000-8000-0000000000a1', 'test-cafe', 'Test Café', 'boardgame_cafe', '00000000-0000-4000-8000-000000000001');
insert into public.branches (id, organization_id, name, offer_ttl_seconds)
values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 'Main', 900);
insert into public.resources (id, organization_id, branch_id, name, kind, capacity)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'Table 1', 'table', 4);
insert into public.activities (id, organization_id, name, min_players, max_players, duration_min)
values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'Azul', 2, 4, 40);
insert into public.open_play_sessions (id, organization_id, branch_id, starts_at, ends_at, seat_price_poisha)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2',
        now() + interval '1 day', now() + interval '1 day 4 hours', 80000);
insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity)
values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', 4);
insert into public.player_profiles (id, organization_id, user_id, display_name, skill)
select ('00000000-0000-4000-8000-0000000001d' || n)::uuid, '00000000-0000-4000-8000-0000000000a1',
       ('00000000-0000-4000-8000-0000000005d' || n)::uuid, 'Player ' || n, 3
from unnest(array['1', '2', '3', '4', '5', '6', '7', '8', '9', 'a']) as n;
insert into public.bookings (id, organization_id, session_id, group_id, profile_id, seat_no, price_poisha)
select ('00000000-0000-4000-8000-0000000002b' || n)::uuid, '00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1',
       ('00000000-0000-4000-8000-0000000001d' || n)::uuid, n::smallint, 80000
from unnest(array[1, 2, 3, 4]) as n;
insert into public.waitlist_entries (id, organization_id, session_id, profile_id, queue_position)
select ('00000000-0000-4000-8000-0000000003a' || n)::uuid, '00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000000000e1', ('00000000-0000-4000-8000-0000000001d' || n)::uuid, n
from unnest(array[5, 6, 7, 8, 9]) as n;

-- cancel_booking
select is((select seat_no from public.cancel_booking('00000000-0000-4000-8000-0000000002b1')), 1::smallint,
  'cancel_booking returns the freed seat');
select is((select status::text from public.bookings where id = '00000000-0000-4000-8000-0000000002b1'), 'cancelled',
  'cancel_booking marks the booking cancelled');
select is((select count(*)::int from public.cancel_booking('00000000-0000-4000-8000-0000000002b1')), 1,
  'cancelling twice still returns the seat');
select is((select count(*)::int from public.events
           where type = 'booking_cancelled' and payload ->> 'booking_id' = '00000000-0000-4000-8000-0000000002b1'), 1,
  'cancelling twice writes one booking_cancelled event');
update public.bookings set status = 'attended' where id = '00000000-0000-4000-8000-0000000002b4';
select throws_ok($$ select * from public.cancel_booking('00000000-0000-4000-8000-0000000002b4') $$,
  'P0001', 'booking_not_cancellable', 'an attended booking cannot be cancelled');
select is((select count(*)::int from public.cancel_booking('00000000-0000-4000-8000-00000000ffff')), 0,
  'cancelling an unknown booking returns no rows');

-- create_offer
select throws_ok($$ select public.create_offer('00000000-0000-4000-8000-0000000000f1', 2::smallint, '00000000-0000-4000-8000-0000000003a5') $$,
  'P0001', 'seat_not_free', 'an occupied seat cannot be offered');
select isnt(public.create_offer('00000000-0000-4000-8000-0000000000f1', 1::smallint, '00000000-0000-4000-8000-0000000003a5'), null::uuid,
  'create_offer returns an offer id');
select is((select status::text from public.waitlist_entries where id = '00000000-0000-4000-8000-0000000003a5'), 'offered',
  'offering moves the entry to offered');
select ok((select expires_at = now() + interval '900 seconds' from public.seat_offers
           where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a5'),
  'the offer expires after the venue TTL');
select throws_ok($$ select public.create_offer('00000000-0000-4000-8000-0000000000f1', 1::smallint, '00000000-0000-4000-8000-0000000003a6') $$,
  'P0001', 'offer_pending', 'a seat with a pending offer cannot be offered again');

-- accept_offer: success, then a duplicate YES (Review Focus 3)
select is(public.accept_offer((select id from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a5')),
  'accepted', 'accepting a live offer books the seat');
select is((select count(*)::int from public.bookings
           where profile_id = '00000000-0000-4000-8000-0000000001d5' and source = 'waitlist' and seat_no = 1
             and price_poisha = 80000 and status = 'confirmed'), 1,
  'the waitlisted player now holds seat 1 at the session price');
select is((select status::text from public.waitlist_entries where id = '00000000-0000-4000-8000-0000000003a5'), 'promoted',
  'the entry is promoted');
select ok((select (payload ->> 'seconds_since_cancel')::int >= 0 from public.events where type = 'seat_filled'),
  'a seat_filled event records the refill time');
select is(public.accept_offer((select id from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a5')),
  'already_accepted', 'a duplicate YES is a no-op');
select is((select count(*)::int from public.bookings
           where profile_id = '00000000-0000-4000-8000-0000000001d5' and status <> 'cancelled'), 1,
  'a duplicate YES never creates a second booking');

-- A late YES after expiry (Review Focus 3)
do $$
begin
  perform public.cancel_booking('00000000-0000-4000-8000-0000000002b2');
  perform public.create_offer('00000000-0000-4000-8000-0000000000f1', 2::smallint, '00000000-0000-4000-8000-0000000003a6');
end $$;
update public.seat_offers set expires_at = now() - interval '1 second'
where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a6';
select is(public.accept_offer((select id from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a6')),
  'expired', 'a YES after expiry is refused');
select is((select count(*)::int from public.bookings where profile_id = '00000000-0000-4000-8000-0000000001d6'), 0,
  'a late YES creates no booking');
-- Review fix: expiry has one owner, so the freed seat reaches the next candidate
select results_eq(
  $$ select offer_id, seat_no from public.expire_offers() $$,
  $$ select id, seat_no from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a6' $$,
  'a late YES leaves the seat for expire_offers to hand on'
);
select is((select status::text from public.waitlist_entries where id = '00000000-0000-4000-8000-0000000003a6'), 'expired',
  'the late player''s entry expires');
select is((select status::text from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a6'), 'expired',
  'the offer is marked expired');
select throws_ok($$ select public.create_offer('00000000-0000-4000-8000-0000000000f1', 2::smallint, '00000000-0000-4000-8000-0000000003a6') $$,
  'P0001', 'entry_not_waiting', 'an entry that is no longer waiting cannot be offered a seat');

-- decline_offer
do $$
begin
  perform public.create_offer('00000000-0000-4000-8000-0000000000f1', 2::smallint, '00000000-0000-4000-8000-0000000003a7');
end $$;
select is(public.decline_offer((select id from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a7')),
  'declined', 'a NO declines the offer');
select is((select status::text from public.waitlist_entries where id = '00000000-0000-4000-8000-0000000003a7'), 'withdrawn',
  'declining withdraws the player from tonight''s waitlist');
select is(public.accept_offer((select id from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a7')),
  'declined', 'a YES after a NO is refused');
select is(public.decline_offer((select id from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a7')),
  'not_pending', 'declining twice reports not_pending');
select is(public.decline_offer('00000000-0000-4000-8000-00000000ffff'), 'not_found', 'declining an unknown offer reports not_found');
select is(public.accept_offer('00000000-0000-4000-8000-00000000ffff'), 'not_found', 'accepting an unknown offer reports not_found');

-- expire_offers
do $$
begin
  perform public.cancel_booking('00000000-0000-4000-8000-0000000002b3');
  perform public.create_offer('00000000-0000-4000-8000-0000000000f1', 2::smallint, '00000000-0000-4000-8000-0000000003a8');
  perform public.create_offer('00000000-0000-4000-8000-0000000000f1', 3::smallint, '00000000-0000-4000-8000-0000000003a9');
end $$;
update public.seat_offers set expires_at = now() - interval '1 second'
where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a8';
select results_eq(
  $$ select offer_id, seat_no from public.expire_offers() $$,
  $$ select id, seat_no from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a8' $$,
  'expire_offers returns only past-due pending offers'
);
select is((select status::text from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a9'), 'pending',
  'offers still in date stay pending');
select is((select status::text from public.waitlist_entries where id = '00000000-0000-4000-8000-0000000003a8'), 'expired',
  'expiring an offer expires its entry');

-- seat_taken: someone else got the seat while the offer was out
insert into public.bookings (organization_id, session_id, group_id, profile_id, seat_no, price_poisha)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1',
        '00000000-0000-4000-8000-0000000001da', 3, 80000);
select is(public.accept_offer((select id from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a9')),
  'seat_taken', 'a YES for a seat someone else took is refused');
select is((select status::text from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a9'), 'expired',
  'the stale offer is closed');
select is((select status::text from public.waitlist_entries where id = '00000000-0000-4000-8000-0000000003a9'), 'waiting',
  'the player goes back to waiting for another seat');

-- already_booked: player 4 still holds seat 4 (attended) and somehow gets an offer
insert into public.waitlist_entries (id, organization_id, session_id, profile_id, queue_position)
values ('00000000-0000-4000-8000-0000000003a4', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000001d4', 9);
do $$
begin
  perform public.create_offer('00000000-0000-4000-8000-0000000000f1', 2::smallint, '00000000-0000-4000-8000-0000000003a4');
end $$;
select is(public.accept_offer((select id from public.seat_offers where waitlist_entry_id = '00000000-0000-4000-8000-0000000003a4')),
  'already_booked', 'a player who already has a seat tonight cannot take a second');

-- Only service_role may call the RPCs
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.accept_offer('00000000-0000-4000-8000-00000000ffff') $$,
  '42501', null, 'signed-in users cannot call booking RPCs directly');
reset role;

select * from finish();
rollback;
