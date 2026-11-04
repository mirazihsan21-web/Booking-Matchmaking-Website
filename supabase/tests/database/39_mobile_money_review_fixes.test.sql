-- Paying online by bKash or Nagad — fixes from the final review. A pending request can't be paid in cash at the
-- desk (it would break Confirm and leave a live payment on a cancelled booking); Confirm still records its own
-- payment; a hold that ended tells the player how to reach the venue in case they had already sent money.
-- Org …39a0: turf (Pitch 1 ৳2,500/h), bKash 01712345678; player b1/c1; owner b2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000039' || suffix)::uuid $$;
create function pg_temp.request(days int) returns uuid language sql as $$
  select booking_id from public.book_resource('00000000-0000-4000-8000-0000000039a0', '00000000-0000-4000-8000-0000000039d1',
    ((now() at time zone 'Asia/Dhaka')::date + days + time '20:00') at time zone 'Asia/Dhaka', 1,
    '00000000-0000-4000-8000-0000000039c1', null, null, '00000000-0000-4000-8000-0000000039b1', true)
$$;
create temp table k (label text primary key, id uuid);

insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-39@test.local' from generate_series(1, 2) n;
insert into public.organizations (id, slug, name, business_type, status, bkash_number) values (pg_temp.id('a0'), 'pay-39', 'Pay 39', 'turf', 'live', '01712345678');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b2'), 'owner');
insert into public.sections (id, organization_id, name, kind, slug) values (pg_temp.id('f1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf');
insert into public.player_profiles (id, organization_id, user_id, display_name) values (pg_temp.id('c1'), pg_temp.id('a0'), pg_temp.id('b1'), 'Sami');
insert into public.resources (id, organization_id, section_id, name, kind, capacity, price_per_hour_poisha) values
  (pg_temp.id('d1'), pg_temp.id('a0'), pg_temp.id('f1'), 'Pitch 1', 'pitch', 14, 250000);
insert into k values ('one', pg_temp.request(1)), ('two', pg_temp.request(2));

-- A pending request isn't paid at the desk.
select throws_ok(format($$ insert into public.payments (resource_booking_id, amount_poisha) values (%L, 250000) $$, (select id from k where label = 'one')),
  'P0001', 'booking_not_payable', 'cash can''t be recorded on a request still waiting for its payment check');
-- Confirm still records the bKash payment (it books the request first).
select is(public.submit_payment_claim((select id from k where label = 'one'), pg_temp.id('b1'), 'bkash', '01911111111', 'FIX39ONE'), 'submitted', 'the player sends their details');
select is(public.decide_payment_claim((select id from k where label = 'one'), pg_temp.id('b2'), 'confirm'), 'confirmed', 'the owner confirms');
select is((select count(*)::int from public.payments where resource_booking_id = (select id from k where label = 'one') and voided_at is null and method = 'bkash'), 1,
  'and its bKash payment is recorded');

-- A hold that ends tells the player the venue's number, in case they had already paid.
update public.resource_bookings set hold_until = now() - interval '1 minute' where id = (select id from k where label = 'two');
select public.expire_payment_holds();
select is((select payload ->> 'contact_phone' from public.notifications where profile_id = pg_temp.id('c1') and kind = 'booking_hold_expired'), '01712345678',
  'the hold-ended notice carries the venue''s number');

select * from finish();
rollback;
