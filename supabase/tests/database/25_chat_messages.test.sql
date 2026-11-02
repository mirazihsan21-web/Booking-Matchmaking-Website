-- Posting and removing chat messages (stage C1): who the sender is (a team member always posts as the brand, even
-- with a player profile), the 500-character rule, mutes, the rate limits, and removal by the author or the venue
-- (the text moves to the archive; removing a card's message closes the card).
-- Org …25a0; users …25b1–…25b9 (A, B, staff T with a profile, N with nothing, M muted, X mute ended, Y, Z).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000025' || suffix)::uuid $$;
create function pg_temp.post(u text, body text) returns text language sql as $$
  select status from public.post_chat_message(pg_temp.id('a0'), pg_temp.id(u), body)
$$;

insert into auth.users (id, email)
  select pg_temp.id('b' || n), 'u' || n || '-25@test.local' from generate_series(1, 9) n;
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-25', 'Chat 25', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b4'), 'staff');
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  (pg_temp.id('c1'), pg_temp.id('a0'), pg_temp.id('b1'), 'Sami'),
  (pg_temp.id('c2'), pg_temp.id('a0'), pg_temp.id('b2'), 'Tanvir'),
  (pg_temp.id('c4'), pg_temp.id('a0'), pg_temp.id('b4'), 'Tee as a player'),
  (pg_temp.id('c6'), pg_temp.id('a0'), pg_temp.id('b6'), 'Muted'),
  (pg_temp.id('c7'), pg_temp.id('a0'), pg_temp.id('b7'), 'Was muted'),
  (pg_temp.id('c8'), pg_temp.id('a0'), pg_temp.id('b8'), 'Yusuf'),
  (pg_temp.id('c9'), pg_temp.id('a0'), pg_temp.id('b9'), 'Zara');
insert into public.chat_mutes (organization_id, profile_id, until) values
  (pg_temp.id('a0'), pg_temp.id('c6'), now() + interval '1 day'),
  (pg_temp.id('a0'), pg_temp.id('c7'), now() - interval '1 minute');
-- B already sent 30 messages a minute ago.
insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, body, created_at)
  select pg_temp.id('a0'), pg_temp.id('b2'), pg_temp.id('c2'), 'player', 'Tanvir', 'msg ' || n, now() - interval '1 minute' from generate_series(1, 30) n;
-- A's card for a booking, with B waiting to join.
insert into public.sections (id, organization_id, name, kind, slug) values (pg_temp.id('a1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values (pg_temp.id('a2'), pg_temp.id('a0'), pg_temp.id('a1'), 'Pitch 1', 'pitch', 14);
insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha)
values (pg_temp.id('e1'), pg_temp.id('a0'), pg_temp.id('a2'), pg_temp.id('c1'), tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour'), 0);
insert into public.chat_cards (id, organization_id, kind, resource_booking_id, poster_user_id, poster_profile_id, poster_name,
  section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed)
values (pg_temp.id('f1'), pg_temp.id('a0'), 'booking', pg_temp.id('e1'), pg_temp.id('b1'), pg_temp.id('c1'), 'Sami',
  pg_temp.id('a1'), 'Turf', 'turf', '#43a66b', 'Pitch 1', now() + interval '1 day', now() + interval '1 day 1 hour', 3);
insert into public.chat_messages (id, organization_id, author_user_id, author_profile_id, author_kind, author_name, card_id, created_at)
values (pg_temp.id('d9'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', pg_temp.id('f1'), now() - interval '1 hour');
insert into public.chat_join_requests (organization_id, card_id, profile_id) values (pg_temp.id('a0'), pg_temp.id('f1'), pg_temp.id('c2'));

create temp table posted as select * from public.post_chat_message(pg_temp.id('a0'), pg_temp.id('b1'), '  hello all  ');
select is((select status from posted), 'posted', 'a player posts');
select row_eq(
  $$ select author_kind::text, author_name, author_profile_id, body from public.chat_messages where id = (select message_id from posted) $$,
  row('player'::text, 'Sami'::text, '00000000-0000-4000-8000-0000000025c1'::uuid, 'hello all'::text),
  'as their profile name, with the text trimmed');

create temp table team_posted as select * from public.post_chat_message(pg_temp.id('a0'), pg_temp.id('b4'), 'Pitch 2 is free at 9');
select is((select status from team_posted), 'posted', 'a team member posts');
select row_eq(
  $$ select author_kind::text, author_name, author_profile_id from public.chat_messages where id = (select message_id from team_posted) $$,
  row('team'::text, 'Chat 25'::text, null::uuid),
  'as the brand, even though they also have a player profile');

select is(pg_temp.post('b3', 'hi'), 'no_profile', 'someone with no profile and not on the team cannot post');
select is(pg_temp.post('b1', 'again'), 'too_fast', 'a second message within 3 seconds is refused');
select is(pg_temp.post('b2', 'one more'), 'too_fast', '30 messages in 10 minutes is the limit');
select is(pg_temp.post('b6', 'let me talk'), 'muted', 'a muted player cannot post');
select is(pg_temp.post('b7', 'back again'), 'posted', 'a mute that has ended no longer applies');
select is(pg_temp.post('b9', repeat('খ', 501)), 'invalid', '501 characters is too long');
select is(pg_temp.post('b9', E'  \n '), 'invalid', 'an empty message is refused');
select is(pg_temp.post('b8', repeat('খ', 500)), 'posted', '500 Bangla letters fit');

-- Removing
select is(public.remove_chat_message((select message_id from posted), pg_temp.id('b2'), false), 'not_allowed', 'a player cannot remove someone else''s message');
select is(public.remove_chat_message((select message_id from posted), pg_temp.id('b1'), false), 'removed', 'the author removes their message');
select row_eq(
  $$ select state::text, body from public.chat_messages where id = (select message_id from posted) $$,
  row('removed_by_author'::text, null::text), 'its text is gone from the room');
select is((select body from public.chat_message_archive where message_id = (select message_id from posted)), 'hello all', 'and kept for the team');
select is(public.remove_chat_message((select message_id from team_posted), pg_temp.id('b2'), true), 'not_allowed', 'only the team removes as the venue');
select is(
  public.remove_chat_message((select id from public.chat_messages where author_user_id = pg_temp.id('b2') limit 1), pg_temp.id('b4'), true),
  'removed', 'the team removes a player''s message');
select is(public.remove_chat_message(pg_temp.id('d9'), pg_temp.id('b1'), false), 'not_allowed', 'a poster closes their card rather than removing it');
select is(public.remove_chat_message(pg_temp.id('d9'), pg_temp.id('b4'), true), 'removed', 'the team removes a card');
select is((select status::text from public.chat_cards where id = pg_temp.id('f1')), 'closed', 'which closes it');
select row_eq(
  $$ select r.status::text, n.kind::text, n.payload ->> 'reason', n.link from public.chat_join_requests r
     join public.notifications n on n.profile_id = r.profile_id and n.kind = 'chat_card_closed'
     where r.card_id = '00000000-0000-4000-8000-0000000025f1' $$,
  row('expired'::text, 'chat_card_closed'::text, 'closed'::text, '/chat/games/00000000-0000-4000-8000-0000000025f1'::text),
  'and tells the player who was waiting');
select is(public.remove_chat_message(gen_random_uuid(), pg_temp.id('b4'), true), 'not_found', 'a missing message');

select ok(
  not has_function_privilege('authenticated', 'public.post_chat_message(uuid, uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.remove_chat_message(uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.chat_guard(uuid, uuid, uuid)', 'execute'),
  'only the server can call these');

select * from finish();
rollback;
