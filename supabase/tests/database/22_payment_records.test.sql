-- Cash records keep their history (website fixes after the R3 review): who voided is recorded when staff cancel a
-- seat or a whole game; deleting a user who handled cash keeps the payment; a booking with cash can't be deleted;
-- the void time is the database's. Org (…22a0); staff S (…22d1), player P (…22d2).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000022d' || n)::uuid $$;
create function pg_temp.act_as(n int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'role', 'authenticated')::text, true);
$$;
create temp table s as select null::uuid as id;
grant select on s to authenticated;

insert into auth.users (id, email) select pg_temp.u(n), 'records22-' || n || '@test.local' from generate_series(1, 2) n;
insert into public.organizations (id, slug, name, status) values ('00000000-0000-4000-8000-0000000022a0', 'records-org-22', 'Records Org', 'live');
update s set id = public.add_section('00000000-0000-4000-8000-0000000022a0', 'turf', 'Turf');
insert into public.organization_members (organization_id, user_id, role) values ('00000000-0000-4000-8000-0000000022a0', pg_temp.u(1), 'staff');
insert into public.section_staff (organization_id, section_id, user_id) values ('00000000-0000-4000-8000-0000000022a0', (select id from s), pg_temp.u(1));
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values
  ('00000000-0000-4000-8000-0000000022c1', '00000000-0000-4000-8000-0000000022a0', (select id from s), 'Pitch 1', 'pitch', 14);
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  ('00000000-0000-4000-8000-0000000022e2', '00000000-0000-4000-8000-0000000022a0', pg_temp.u(2), 'P');
insert into public.resource_bookings (id, organization_id, resource_id, guest_name, guest_phone, period, price_poisha) values
  ('00000000-0000-4000-8000-0000000022b1', '00000000-0000-4000-8000-0000000022a0', '00000000-0000-4000-8000-0000000022c1', 'Rahim', '01712345678',
   tstzrange(now() + interval '1 day', now() + interval '25 hours'), 60000),
  ('00000000-0000-4000-8000-0000000022b2', '00000000-0000-4000-8000-0000000022a0', '00000000-0000-4000-8000-0000000022c1', 'Karim', '01712345679',
   tstzrange(now() + interval '2 days', now() + interval '49 hours'), 60000);
-- Two matched games, each with P seated.
insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min) values
  ('00000000-0000-4000-8000-0000000022a1', '00000000-0000-4000-8000-0000000022a0', (select id from s), '5-a-side', 2, 10, 60);
insert into public.open_play_sessions (id, organization_id, section_id, starts_at, ends_at, seat_price_poisha, status) values
  ('00000000-0000-4000-8000-0000000022f1', '00000000-0000-4000-8000-0000000022a0', (select id from s), now() + interval '3 days', now() + interval '73 hours', 30000, 'matched'),
  ('00000000-0000-4000-8000-0000000022f2', '00000000-0000-4000-8000-0000000022a0', (select id from s), now() + interval '4 days', now() + interval '97 hours', 30000, 'matched');
insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity) values
  ('00000000-0000-4000-8000-000000002291', '00000000-0000-4000-8000-0000000022a0', '00000000-0000-4000-8000-0000000022f1', '00000000-0000-4000-8000-0000000022c1', '00000000-0000-4000-8000-0000000022a1', 10),
  ('00000000-0000-4000-8000-000000002292', '00000000-0000-4000-8000-0000000022a0', '00000000-0000-4000-8000-0000000022f2', '00000000-0000-4000-8000-0000000022c1', '00000000-0000-4000-8000-0000000022a1', 10);
insert into public.bookings (id, organization_id, session_id, group_id, profile_id, seat_no, price_poisha) values
  ('00000000-0000-4000-8000-000000002281', '00000000-0000-4000-8000-0000000022a0', '00000000-0000-4000-8000-0000000022f1', '00000000-0000-4000-8000-000000002291', '00000000-0000-4000-8000-0000000022e2', 1, 30000),
  ('00000000-0000-4000-8000-000000002282', '00000000-0000-4000-8000-0000000022a0', '00000000-0000-4000-8000-0000000022f2', '00000000-0000-4000-8000-000000002292', '00000000-0000-4000-8000-0000000022e2', 1, 30000);

-- Staff S takes cash for both seats and both walk-ins.
set local role authenticated;
select pg_temp.act_as(1);
insert into public.payments (seat_booking_id, amount_poisha) values ('00000000-0000-4000-8000-000000002281', 30000), ('00000000-0000-4000-8000-000000002282', 30000);
insert into public.payments (resource_booking_id, amount_poisha) values ('00000000-0000-4000-8000-0000000022b1', 60000), ('00000000-0000-4000-8000-0000000022b2', 60000);
reset role;

-- The app cancels as the service role (no auth.uid()), naming the staff member who pressed Cancel.
select * from public.cancel_booking('00000000-0000-4000-8000-000000002281', true, pg_temp.u(1));
select is((select voided_by from public.payments where seat_booking_id = '00000000-0000-4000-8000-000000002281'), pg_temp.u(1),
  'a staff seat cancel records who voided the cash');
select public.cancel_open_play_session('00000000-0000-4000-8000-0000000022f2', pg_temp.u(1));
select is((select voided_by from public.payments where seat_booking_id = '00000000-0000-4000-8000-000000002282'), pg_temp.u(1),
  'so does cancelling the whole game');

-- The void time is the database's, whatever the request says.
set local role authenticated;
select pg_temp.act_as(1);
update public.payments set voided_at = '2000-01-01' where resource_booking_id = '00000000-0000-4000-8000-0000000022b1';
reset role;
select is((select voided_at from public.payments where resource_booking_id = '00000000-0000-4000-8000-0000000022b1'), now(),
  'a void is stamped with the database''s time');

-- Signed-in staff still can't rewrite who voided.
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$ update public.payments set voided_by = null where resource_booking_id = '00000000-0000-4000-8000-0000000022b1' $$,
  'P0001', 'payment_is_void_only', 'staff can''t erase who voided a payment'
);
reset role;

-- A booking with a cash record can't be deleted (the record would go with it).
select throws_ok(
  $$ delete from public.resource_bookings where id = '00000000-0000-4000-8000-0000000022b2' $$,
  '23503', null, 'a booking with cash can''t be deleted'
);

-- Deleting the staff member's login keeps every payment they took or voided, unattributed.
-- As a real deletion runs (dashboard or admin API): no signed-in user.
select set_config('request.jwt.claims', '', true);
select lives_ok($$ delete from auth.users where id = pg_temp.u(1) $$, 'a user who handled cash can be deleted');
select is((select count(*) from public.payments where organization_id = '00000000-0000-4000-8000-0000000022a0'), 4::bigint, 'and the payments stay');
select is((select count(*) from public.payments where organization_id = '00000000-0000-4000-8000-0000000022a0' and (taken_by is not null or voided_by is not null)), 0::bigint,
  'with nobody named');

select * from finish();
rollback;
