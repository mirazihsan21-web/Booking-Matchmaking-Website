-- Paying online by bKash or Nagad — finishing touches. Sending the details after the venue cancelled the request
-- answers "already handled" (not_pending), while a hold that ran out (or the player's own cancel) still answers
-- hold_over; a player cancelling their own unpaid hold gets no "Booking cancelled" notice (the venue's cancel still
-- tells them); a recorded payment's transaction ID can't be changed, not even while voiding it.
-- Org …40a0: turf (Pitch 1 ৳2,500/h), bKash 01712345678; player b1/c1; owner b2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000040' || suffix)::uuid $$;
create function pg_temp.request(days int) returns uuid language sql as $$
  select booking_id from public.book_resource('00000000-0000-4000-8000-0000000040a0', '00000000-0000-4000-8000-0000000040d1',
    ((now() at time zone 'Asia/Dhaka')::date + days + time '20:00') at time zone 'Asia/Dhaka', 1,
    '00000000-0000-4000-8000-0000000040c1', null, null, '00000000-0000-4000-8000-0000000040b1', true)
$$;
create function pg_temp.send(booking uuid, trx text) returns text language sql as $$
  select public.submit_payment_claim(booking, '00000000-0000-4000-8000-0000000040b1', 'bkash', '01911111111', trx)
$$;
create function pg_temp.cancelled_notices(booking uuid) returns int language sql as $$
  select count(*)::int from public.notifications where kind = 'booking_cancelled' and payload ->> 'booking_id' = booking::text
$$;
create temp table k (label text primary key, id uuid);

insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-40@test.local' from generate_series(1, 2) n;
insert into public.organizations (id, slug, name, business_type, status, bkash_number) values (pg_temp.id('a0'), 'pay-40', 'Pay 40', 'turf', 'live', '01712345678');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b2'), 'owner');
insert into public.sections (id, organization_id, name, kind, slug, max_upcoming_bookings) values (pg_temp.id('f1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf', 10);
insert into public.player_profiles (id, organization_id, user_id, display_name) values (pg_temp.id('c1'), pg_temp.id('a0'), pg_temp.id('b1'), 'Sami');
insert into public.resources (id, organization_id, section_id, name, kind, capacity, price_per_hour_poisha) values
  (pg_temp.id('d1'), pg_temp.id('a0'), pg_temp.id('f1'), 'Pitch 1', 'pitch', 14, 250000);
insert into k values ('venue', pg_temp.request(1)), ('expired', pg_temp.request(2)), ('own', pg_temp.request(3)), ('paid', pg_temp.request(4)), ('venue2', pg_temp.request(5));

-- Sending after the venue cancelled: already handled.
select is(public.cancel_resource_booking((select id from k where label = 'venue'), pg_temp.id('b2')), 'cancelled', 'the owner cancels a held request');
select is(pg_temp.send((select id from k where label = 'venue'), 'FIN40AAA'), 'not_pending', 'sending the details afterwards: already handled by the venue');
-- After the hold ran out, or the player's own cancel: the hold is over.
update public.resource_bookings set hold_until = now() - interval '1 minute' where id = (select id from k where label = 'expired');
select public.expire_payment_holds();
select is(pg_temp.send((select id from k where label = 'expired'), 'FIN40BBB'), 'hold_over', 'after the hold ran out: hold over');
select is(public.cancel_resource_booking((select id from k where label = 'own'), pg_temp.id('b1')), 'cancelled', 'the player cancels their own unpaid hold');
select is(pg_temp.send((select id from k where label = 'own'), 'FIN40CCC'), 'hold_over', 'after their own cancel: hold over');

-- Notices.
select is(pg_temp.cancelled_notices((select id from k where label = 'own')), 0, 'cancelling their own unpaid hold sends the player no notice');
select is(public.cancel_resource_booking((select id from k where label = 'venue2'), pg_temp.id('b2')), 'cancelled', 'the owner cancels another held request');
select is((select (payload ->> 'by_venue')::boolean from public.notifications where kind = 'booking_cancelled' and payload ->> 'booking_id' = (select id from k where label = 'venue2')::text),
  true, 'the venue''s cancel still tells the player');

-- A recorded bKash payment keeps its transaction ID.
select is(pg_temp.send((select id from k where label = 'paid'), 'FIN40DDD'), 'submitted', 'the player sends their details');
select public.decide_payment_claim((select id from k where label = 'paid'), pg_temp.id('b2'), 'confirm');
select throws_ok(format($$ update public.payments set voided_at = now(), reference = 'CHANGED40' where resource_booking_id = %L $$, (select id from k where label = 'paid')),
  'P0001', 'payment_is_void_only', 'the transaction ID can''t be changed, not even while voiding the payment');

select * from finish();
rollback;
