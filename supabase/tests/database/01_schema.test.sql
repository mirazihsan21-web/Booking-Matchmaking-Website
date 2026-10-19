-- Schema shape and the booking invariants that live in constraints.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select has_table('public', t, format('table %s exists', t))
from unnest(array[
  'venues', 'venue_tables', 'games', 'players', 'player_games', 'availability', 'sessions',
  'seat_requests', 'groups', 'bookings', 'waitlist_entries', 'seat_offers', 'messages', 'events'
]) as t;

select has_enum('public', e, format('enum %s exists', e))
from unnest(array[
  'session_status', 'booking_status', 'booking_source', 'waitlist_status', 'offer_status', 'message_direction'
]) as e;

select is_empty(
  $$
    select c.conrelid::regclass::text, a.attname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indkey[0] = a.attnum and i.indpred is null
      )
  $$,
  'every foreign key column leads a non-partial index'
);

-- Fixtures
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'owner@test.local');
insert into public.venues (id, name, owner_id)
values ('00000000-0000-4000-8000-0000000000a1', 'Test Café', '00000000-0000-4000-8000-000000000001');
insert into public.venue_tables (id, venue_id, name, capacity)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'Table 1', 4);
insert into public.games (id, venue_id, name, min_players, max_players, duration_min)
values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'Catan', 3, 4, 90);
insert into public.players (id, venue_id, name, phone, skill) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', 'Maya K.', '+447700900001', 3),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000a1', 'Leo B.', '+447700900002', 4);
insert into public.sessions (id, venue_id, starts_at, ends_at, seat_price_cents)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', now(), now() + interval '4 hours', 800);
insert into public.groups (id, venue_id, session_id, table_id, game_id, capacity)
values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', 4);
insert into public.waitlist_entries (id, venue_id, session_id, player_id, queue_position)
values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000000d2', 1);

-- Review Focus 5: bad data is rejected by CHECK constraints.
select throws_ok(
  $$ insert into public.players (venue_id, name, phone, skill)
     values ('00000000-0000-4000-8000-0000000000a1', 'Too Good', '+447700900009', 6) $$,
  '23514', null, 'skill above 5 is rejected'
);
select throws_ok(
  $$ insert into public.players (venue_id, name, phone, skill)
     values ('00000000-0000-4000-8000-0000000000a1', 'No Phone', 'not-a-phone', 3) $$,
  '23514', null, 'a malformed phone is rejected'
);
select throws_ok(
  $$ insert into public.games (venue_id, name, min_players, max_players, duration_min)
     values ('00000000-0000-4000-8000-0000000000a1', 'Backwards', 5, 4, 30) $$,
  '23514', null, 'a game with min_players > max_players is rejected'
);

-- Seat invariants
insert into public.bookings (id, venue_id, session_id, group_id, player_id, seat_no, price_cents)
values ('00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 1, 800);

select throws_ok(
  $$ insert into public.bookings (venue_id, session_id, group_id, player_id, seat_no, price_cents)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
             '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 2, 800) $$,
  '23505', null, 'a player cannot hold two live bookings in one session'
);
select throws_ok(
  $$ insert into public.bookings (venue_id, session_id, group_id, player_id, seat_no, price_cents)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
             '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d2', 1, 800) $$,
  '23505', null, 'two live bookings cannot share a seat'
);

update public.bookings set status = 'cancelled', cancelled_at = now() where id = '00000000-0000-4000-8000-0000000001b1';
select lives_ok(
  $$ insert into public.bookings (venue_id, session_id, group_id, player_id, seat_no, price_cents)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
             '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d2', 1, 800) $$,
  'a cancelled booking frees its seat'
);

insert into public.seat_offers (venue_id, group_id, seat_no, waitlist_entry_id, expires_at)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 2,
        '00000000-0000-4000-8000-0000000001a1', now() + interval '15 minutes');
select throws_ok(
  $$ insert into public.seat_offers (venue_id, group_id, seat_no, waitlist_entry_id, expires_at)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 2,
             '00000000-0000-4000-8000-0000000001a1', now() + interval '15 minutes') $$,
  '23505', null, 'only one pending offer per seat'
);

select * from finish();
rollback;
