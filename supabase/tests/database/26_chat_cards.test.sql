-- "Need players" cards and join requests (stage C1): posting a card for your own upcoming booking (spots up to the
-- space's capacity − 1, one card per booking, 3 open per player) or for an open-play session (team, or a player who
-- asked for a seat); asking to join, withdrawing, accepting (never past the spots), declining, leaving, removing,
-- closing — and the notification each one sends. Org …26a0.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000026' || suffix)::uuid $$;
create function pg_temp.booking_card(u text, booking text, spots int) returns text language sql as $$
  select status from public.post_booking_card(pg_temp.id('a0'), pg_temp.id(u), pg_temp.id(booking), spots, null)
$$;
create function pg_temp.ask(u text, card uuid) returns text language sql as $$ select public.request_to_join(card, pg_temp.id(u)) $$;
create function pg_temp.notes(p_kind text, p_profile text) returns int language sql as $$
  select count(*)::int from public.notifications where kind::text = p_kind and profile_id = pg_temp.id(p_profile)
$$;

-- A b1/c1 Sami · B b2/c2 Tanvir · C b3/c3 Nadia (10 requests waiting) · T b4/c4 staff with a profile · P b5/c5 Priya
-- (asked for a seat) · Q b6/c6 Rafi · D b7/c7 Dina · M b8/c8 muted · X b9/c9 owns the 10 cards C waits on
insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-26@test.local' from generate_series(1, 9) n;
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-26', 'Chat 26', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b4'), 'staff');
insert into public.player_profiles (id, organization_id, user_id, display_name)
  select pg_temp.id('c' || n), pg_temp.id('a0'), pg_temp.id('b' || n),
         (array['Sami', 'Tanvir', 'Nadia', 'Tee', 'Priya', 'Rafi', 'Dina', 'Mute', 'Xavier'])[n]
  from generate_series(1, 9) n;
insert into public.chat_mutes (organization_id, profile_id) values (pg_temp.id('a0'), pg_temp.id('c8'));
insert into public.sections (id, organization_id, name, kind, slug, accent) values (pg_temp.id('a1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf', '#43a66b');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values
  (pg_temp.id('a2'), pg_temp.id('a0'), pg_temp.id('a1'), 'Pitch 1', 'pitch', 14),
  (pg_temp.id('a3'), pg_temp.id('a0'), pg_temp.id('a1'), 'Solo nets', 'pitch', 1);
-- Bookings: e1 A's (tomorrow), e0 A's (yesterday), e2 A's, e3 A's on the 1-person space, e4/e5 A's (cards already
-- open), e6 D's, e8 M's, e9 B's; 80–89 X's ten (cards 90–99).
insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha)
select pg_temp.id(b.suffix), pg_temp.id('a0'), pg_temp.id(b.space), pg_temp.id(b.who),
       tstzrange(now() + b.offset_hours * interval '1 hour', now() + (b.offset_hours + 1) * interval '1 hour'), 0
from (values ('e1', 'a2', 'c1', 24), ('e0', 'a2', 'c1', -24), ('e2', 'a2', 'c1', 48), ('e3', 'a3', 'c1', 24),
             ('e4', 'a2', 'c1', 72), ('e5', 'a2', 'c1', 96), ('e6', 'a2', 'c7', 30), ('e8', 'a2', 'c8', 30), ('e9', 'a2', 'c2', 30))
       as b(suffix, space, who, offset_hours);
insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha)
  select pg_temp.id('8' || n), pg_temp.id('a0'), pg_temp.id('a2'), pg_temp.id('c9'),
         tstzrange(now() + (100 + n) * interval '1 hour', now() + (101 + n) * interval '1 hour'), 0
  from generate_series(0, 9) n;
-- Cards inserted directly: A's two others (f4, f5), D's 1-spot card (d1), X's ten (90–99, C waits on all), a started one (d2).
create function pg_temp.card(card text, booking text, poster text, poster_name text, spots int, starts timestamptz) returns void language sql as $$
  insert into public.chat_cards (id, organization_id, kind, resource_booking_id, poster_user_id, poster_profile_id, poster_name,
    section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed)
  values (pg_temp.id(card), pg_temp.id('a0'), 'booking', pg_temp.id(booking), pg_temp.id('b' || substr(poster, 2)), pg_temp.id(poster), poster_name,
    pg_temp.id('a1'), 'Turf', 'turf', '#43a66b', 'Pitch 1', starts, starts + interval '1 hour', spots)
$$;
select pg_temp.card('f4', 'e4', 'c1', 'Sami', 2, now() + interval '72 hours');
select pg_temp.card('f5', 'e5', 'c1', 'Sami', 2, now() + interval '96 hours');
select pg_temp.card('d1', 'e6', 'c7', 'Dina', 1, now() + interval '30 hours');
select pg_temp.card('d2', 'e9', 'c2', 'Tanvir', 2, now() - interval '5 minutes');
select pg_temp.card('9' || n, '8' || n, 'c9', 'Xavier', 2, now() + interval '100 hours') from generate_series(0, 9) n;
insert into public.chat_join_requests (organization_id, card_id, profile_id)
  select pg_temp.id('a0'), pg_temp.id('9' || n), pg_temp.id('c3') from generate_series(0, 9) n;
insert into public.chat_join_requests (organization_id, card_id, profile_id) values
  (pg_temp.id('a0'), pg_temp.id('d1'), pg_temp.id('c2')), (pg_temp.id('a0'), pg_temp.id('d1'), pg_temp.id('c6'));
-- An open-play session P asked for a seat in, and a cancelled one.
insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min, team_mode)
values (pg_temp.id('a5'), pg_temp.id('a0'), pg_temp.id('a1'), '5-a-side', 6, 10, 60, 'none');
insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha, status) values
  (pg_temp.id('aa'), pg_temp.id('a0'), pg_temp.id('a1'), pg_temp.id('a5'), now() + interval '2 days', now() + interval '2 days 1 hour', 30000, 'open'),
  (pg_temp.id('ab'), pg_temp.id('a0'), pg_temp.id('a1'), pg_temp.id('a5'), now() + interval '3 days', now() + interval '3 days 1 hour', 30000, 'cancelled');
insert into public.seat_requests (organization_id, session_id, profile_id) values (pg_temp.id('a0'), pg_temp.id('aa'), pg_temp.id('c5'));

-- Posting a booking card
create temp table posted as select * from public.post_booking_card(pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('e1'), 3, 'split the cost');
select is((select status from posted), 'posted', 'a player posts a card for their own booking');
select row_eq(
  $$ select title, section_name, poster_name, spots_needed::int, spots_taken::int, status::text, note from public.chat_cards where id = (select card_id from posted) $$,
  row('Pitch 1'::text, 'Turf'::text, 'Sami'::text, 3, 0, 'open'::text, 'split the cost'::text),
  'the card shows the space, section, poster and spots');
select is((select count(*)::int from public.chat_messages where card_id = (select card_id from posted) and author_profile_id = pg_temp.id('c1')), 1,
  'and appears in the room');
select is(pg_temp.booking_card('b2', 'e1', 2), 'not_yours', 'nobody posts a card for someone else''s booking');
select is(pg_temp.booking_card('b1', 'e0', 2), 'not_yours', 'nor for a game that has started');
select is(pg_temp.booking_card('b1', 'e2', 14), 'bad_spots', 'a 14-person pitch has room for 13 more');
select is(pg_temp.booking_card('b1', 'e3', 1), 'single_space', 'a one-person space cannot have a card');
select is(pg_temp.booking_card('b1', 'e1', 2), 'already_posted', 'one card per booking');
select is(pg_temp.booking_card('b1', 'e2', 13), 'too_many_cards', 'three open cards at once');
select is(pg_temp.booking_card('b4', 'e1', 2), 'no_profile', 'a team member does not post booking cards, even with a player profile');
select is(pg_temp.booking_card('b8', 'e8', 2), 'muted', 'a muted player cannot post');

-- Asking to join
select is(pg_temp.ask('b1', (select card_id from posted)), 'own_card', 'you cannot ask to join your own game');
select is(pg_temp.ask('b2', (select card_id from posted)), 'requested', 'a player asks to join');
select is((select (payload ->> 'player_name') || ' / ' || link from public.notifications where kind = 'chat_join_request' and profile_id = pg_temp.id('c1')),
  'Tanvir / /chat/games/' || (select card_id from posted), 'and the poster hears who');
select is(pg_temp.ask('b2', (select card_id from posted)), 'already_asked', 'once');
select is(pg_temp.ask('b3', (select card_id from posted)), 'too_many_waiting', 'at most 10 requests waiting per player');
select is(pg_temp.ask('b8', (select card_id from posted)), 'muted', 'a muted player cannot ask');
select is(public.withdraw_join_request((select card_id from posted), pg_temp.id('b2')), 'withdrawn', 'a player withdraws');
select is(pg_temp.ask('b2', (select card_id from posted)), 'requested', 'and may ask again');
select is(pg_temp.ask('b2', pg_temp.id('d2')), 'not_open', 'a game that has started takes no more requests');

-- Deciding
select is(public.decide_join_request((select card_id from posted), pg_temp.id('b3'), pg_temp.id('c2'), true), 'not_yours', 'only the poster decides');
select is(public.decide_join_request((select card_id from posted), pg_temp.id('b1'), pg_temp.id('c2'), true), 'accepted', 'the poster accepts');
select is((select spots_taken::int from public.chat_cards where id = (select card_id from posted)), 1, 'which takes a spot');
select is(pg_temp.notes('chat_join_accepted', 'c2'), 1, 'and tells the player');
select is(public.decide_join_request(pg_temp.id('d1'), pg_temp.id('b7'), pg_temp.id('c2'), true), 'accepted', 'accepting the last spot');
select is((select status::text from public.chat_cards where id = pg_temp.id('d1')), 'full', 'fills the card');
select row_eq(
  $$ select r.status::text, (select n.payload ->> 'reason' from public.notifications n where n.kind = 'chat_card_closed' and n.profile_id = r.profile_id)
     from public.chat_join_requests r where r.card_id = '00000000-0000-4000-8000-0000000026d1' and r.profile_id = '00000000-0000-4000-8000-0000000026c6' $$,
  row('expired'::text, 'full'::text), 'and tells whoever was still waiting that it is full');
select is(public.decide_join_request(pg_temp.id('d1'), pg_temp.id('b7'), pg_temp.id('c6'), true), 'full', 'no one is accepted past the spots');
select is(public.leave_card(pg_temp.id('d1'), pg_temp.id('b2')), 'left', 'an accepted player can''t make it after all');
select row_eq($$ select status::text, spots_taken::int from public.chat_cards where id = '00000000-0000-4000-8000-0000000026d1' $$,
  row('open'::text, 0), 'which reopens the spot');
select is(pg_temp.notes('chat_join_left', 'c7'), 1, 'and tells the poster');
select is(public.remove_from_card((select card_id from posted), pg_temp.id('b1'), pg_temp.id('c2')), 'removed', 'the poster takes someone off their game');
select row_eq(
  $$ select (select spots_taken::int from public.chat_cards where id = (select card_id from posted)),
            (select (payload ->> 'after_accept')::boolean from public.notifications where kind = 'chat_join_declined' and profile_id = '00000000-0000-4000-8000-0000000026c2') $$,
  row(0, true), 'freeing the spot and telling them');
select is(pg_temp.ask('b6', (select card_id from posted)), 'requested', 'another player asks');
select is(public.decide_join_request((select card_id from posted), pg_temp.id('b1'), pg_temp.id('c6'), false), 'declined', 'the poster declines');
select is((select (payload ->> 'after_accept')::boolean from public.notifications where kind = 'chat_join_declined' and profile_id = pg_temp.id('c6')),
  false, 'and the player hears it didn''t work out');
select is(pg_temp.ask('b6', (select card_id from posted)), 'already_asked', 'a declined player cannot ask again');

-- Closing
select is(public.close_chat_card((select card_id from posted), pg_temp.id('b3')), 'not_yours', 'only the poster or the team closes a card');
select is(public.close_chat_card((select card_id from posted), pg_temp.id('b1')), 'closed', 'the poster closes it');
select is(public.close_chat_card((select card_id from posted), pg_temp.id('b1')), 'not_open', 'once');
select is(pg_temp.ask('b5', (select card_id from posted)), 'not_open', 'a closed card takes no requests');

-- Session cards
create temp table shared as select * from public.post_session_card(pg_temp.id('a0'), pg_temp.id('b5'), pg_temp.id('aa'), 'come along');
select row_eq(
  $$ select s.status, c.title, c.seat_price_poisha, c.spots_needed from shared s join public.chat_cards c on c.id = s.card_id $$,
  row('posted'::text, '5-a-side'::text, 30000, null::smallint), 'a player who asked for a seat shares the game');
select is((select status from public.post_session_card(pg_temp.id('a0'), pg_temp.id('b6'), pg_temp.id('aa'), null)), 'not_going',
  'a player who hasn''t asked for a seat cannot');
create temp table team_shared as select * from public.post_session_card(pg_temp.id('a0'), pg_temp.id('b4'), pg_temp.id('aa'), null);
select row_eq(
  $$ select s.status, c.poster_name, c.poster_profile_id from team_shared s join public.chat_cards c on c.id = s.card_id $$,
  row('posted'::text, 'Chat 26'::text, null::uuid), 'the team shares a game as the brand');
select is(pg_temp.ask('b2', (select card_id from shared)), 'not_open', 'a session card has no requests: you get a seat on the game''s page');
select is((select status from public.post_session_card(pg_temp.id('a0'), pg_temp.id('b7'), pg_temp.id('ab'), null)), 'not_found',
  'a cancelled game cannot be shared');

select is_empty($$ select 1 from public.notifications where kind::text like 'chat_%' and link not like '/chat/games/%' $$,
  'every chat notification links to its game page');
select ok(
  not has_function_privilege('authenticated', 'public.post_booking_card(uuid, uuid, uuid, int, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.decide_join_request(uuid, uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.request_to_join(uuid, uuid)', 'execute'),
  'only the server can call these');

select * from finish();
rollback;
