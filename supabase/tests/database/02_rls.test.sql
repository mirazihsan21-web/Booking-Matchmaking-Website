-- Row-level security: owners see their venue, players see their own rows, anon sees nothing,
-- and booking-flow tables are written only through RPCs (service_role).
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- Fixtures (as postgres). A* = owner A, B* = owner B, P = player with login, Q = another player.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner-a@test.local'),
  ('00000000-0000-4000-8000-00000000000b', 'owner-b@test.local'),
  ('00000000-0000-4000-8000-00000000000c', 'player-p@test.local'),
  ('00000000-0000-4000-8000-00000000000d', 'player-q@test.local');
insert into public.venues (id, name, owner_id) values
  ('00000000-0000-4000-8000-0000000000a1', 'Venue A', '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-0000000000b1', 'Venue B', '00000000-0000-4000-8000-00000000000b');
insert into public.games (id, venue_id, name, min_players, max_players, duration_min) values
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 'Catan', 3, 4, 90),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b1', 'Azul', 2, 4, 40);
insert into public.venue_tables (id, venue_id, name, capacity)
values ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a1', 'Table 1', 4);
insert into public.players (id, venue_id, user_id, name, phone, skill) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000c', 'Pat P.', '+447700900001', 3),
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000d', 'Quinn Q.', '+447700900002', 4),
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000b1', null, 'Bea B.', '+447700900003', 2);
insert into public.sessions (id, venue_id, starts_at, ends_at, seat_price_cents)
values ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a1', now(), now() + interval '4 hours', 800);
insert into public.groups (id, venue_id, session_id, table_id, game_id, capacity)
values ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a4',
        '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a2', 4);
insert into public.bookings (venue_id, session_id, group_id, player_id, seat_no, price_cents) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000c1', 1, 800),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000d1', 2, 800);
insert into public.events (venue_id, session_id, type)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a4', 'booking_cancelled');

-- Owner A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select count(*)::int from public.players where venue_id = '00000000-0000-4000-8000-0000000000a1'), 2, 'owner sees their venue''s players');
select is((select count(*)::int from public.players where venue_id = '00000000-0000-4000-8000-0000000000b1'), 0, 'owner sees no other venue''s players');
select is((select count(*)::int from public.bookings), 2, 'owner sees every booking in their venue');
select is((select count(*)::int from public.events), 1, 'owner sees their venue''s events');
select throws_ok(
  $$ insert into public.bookings (venue_id, session_id, group_id, player_id, seat_no, price_cents)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a4',
             '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000c1', 3, 800) $$,
  '42501', null, 'owners cannot write bookings directly (RPC only)'
);

-- Owner B
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
with changed as (update public.games set name = 'Hijacked' where venue_id = '00000000-0000-4000-8000-0000000000a1' returning 1)
select is(count(*)::int, 0, 'an owner cannot update another venue''s games') from changed;

-- Player P
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}';
select is((select count(*)::int from public.players), 1, 'a player sees only their own player row');
select is((select count(*)::int from public.games), 1, 'a player sees their venue''s games only');
select is((select count(*)::int from public.bookings), 1, 'a player sees only their own bookings');
select is((select count(*)::int from public.events), 0, 'a player sees no events');
with changed as (update public.players set name = 'Pat Renamed' where id = '00000000-0000-4000-8000-0000000000c1' returning 1)
select is(count(*)::int, 1, 'a player can update their own profile') from changed;
with changed as (update public.players set name = 'Quinn Renamed' where id = '00000000-0000-4000-8000-0000000000d1' returning 1)
select is(count(*)::int, 0, 'a player cannot update someone else''s profile') from changed;
select lives_ok(
  $$ insert into public.availability (venue_id, player_id, weekday, start_time, end_time)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 5, '18:00', '23:00') $$,
  'a player can add their own availability'
);
select throws_ok(
  $$ insert into public.availability (venue_id, player_id, weekday, start_time, end_time)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 5, '18:00', '23:00') $$,
  '42501', null, 'a player cannot add availability for someone else'
);
select throws_ok(
  $$ insert into public.availability (venue_id, player_id, weekday, start_time, end_time)
     values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', 5, '18:00', '23:00') $$,
  '42501', null, 'a player cannot file their own rows under another venue'
);
-- Review fix: a player must not be able to re-home their row (tenant isolation)
select throws_ok(
  $$ update public.players set venue_id = '00000000-0000-4000-8000-0000000000b1'
     where id = '00000000-0000-4000-8000-0000000000c1' $$,
  '42501', null, 'a player cannot move themselves into another venue'
);
-- Review fix: priority and request time are server-owned (fairness)
select lives_ok(
  $$ insert into public.seat_requests (venue_id, session_id, player_id)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c1') $$,
  'a player can request a seat'
);
select throws_ok(
  $$ insert into public.seat_requests (venue_id, session_id, player_id, priority)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c1', 32767) $$,
  '42501', null, 'a player cannot set their own priority'
);
select throws_ok(
  $$ update public.seat_requests set created_at = '2000-01-01'
     where player_id = '00000000-0000-4000-8000-0000000000c1' $$,
  '42501', null, 'a player cannot backdate their request'
);

-- Anonymous
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from public.venues), 0, 'anon sees no venues');

reset role;
select * from finish();
rollback;
