-- Players chat (stage C2): private messages and blocks. Two players share one conversation; the team, yourself and
-- missing people can't be messaged; a block either way stops messages (even in an existing conversation) and join
-- requests both ways; muted players can't send; the photo checks and rate limits apply; the unread count; reporting a
-- private message is for its two people only. Org …33a0.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000033' || suffix)::uuid $$;
create function pg_temp.dm(u text, to_profile text, body text) returns text language sql as $$
  select status from public.post_private_message(pg_temp.id('a0'), pg_temp.id(u), pg_temp.id(to_profile), body, null)
$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(u), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.card(card text, booking text, poster text, hours int) returns void language sql as $$
  insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha)
  values (pg_temp.id(booking), pg_temp.id('a0'), pg_temp.id('a2'), pg_temp.id(poster),
          tstzrange(now() + hours * interval '1 hour', now() + (hours + 1) * interval '1 hour'), 0);
  insert into public.chat_cards (id, organization_id, kind, resource_booking_id, poster_user_id, poster_profile_id, poster_name,
    section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed)
  values (pg_temp.id(card), pg_temp.id('a0'), 'booking', pg_temp.id(booking), pg_temp.id('b' || substr(poster, 2)), pg_temp.id(poster), 'Poster',
    pg_temp.id('a1'), 'Turf', 'turf', '#43a66b', 'Pitch 1', now() + hours * interval '1 hour', now() + (hours + 1) * interval '1 hour', 3);
  insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, card_id, created_at)
  values (pg_temp.id('a0'), pg_temp.id('b' || substr(poster, 2)), pg_temp.id(poster), 'player', 'Poster', pg_temp.id(card), now() - interval '1 hour');
$$;

-- A b1/c1 Sami · B b2/c2 Tanvir · C b3/c3 Nadia · T b4/c4 staff with a player profile · M b5/c5 muted
insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-33@test.local' from generate_series(1, 5) n;
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-33', 'Chat 33', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b4'), 'staff');
insert into public.player_profiles (id, organization_id, user_id, display_name)
  select pg_temp.id('c' || n), pg_temp.id('a0'), pg_temp.id('b' || n), (array['Sami', 'Tanvir', 'Nadia', 'Tee', 'Mute'])[n] from generate_series(1, 5) n;
insert into public.chat_mutes (organization_id, profile_id) values (pg_temp.id('a0'), pg_temp.id('c5'));
insert into public.sections (id, organization_id, name, kind, slug) values (pg_temp.id('a1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values (pg_temp.id('a2'), pg_temp.id('a0'), pg_temp.id('a1'), 'Pitch 1', 'pitch', 14);
select pg_temp.card('f1', 'e1', 'c1', 24); -- A's card
select pg_temp.card('f2', 'e2', 'c2', 48); -- B's card

-- Posting
create temp table first as select * from public.post_private_message(pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c2'), 'psst', null);
select is((select status from first), 'posted', 'a player messages another player');
select is((select count(*)::int from public.chat_conversations where organization_id = pg_temp.id('a0')), 1, 'which starts their conversation');
select pg_temp.as_user('b2');
select is(public.chat_private_unread(pg_temp.id('a0')), 1, 'the other person has one unread message');
insert into public.chat_conversation_reads (conversation_id, organization_id, profile_id, read_at)
  select c.id, c.organization_id, '00000000-0000-4000-8000-0000000033c2', now() + interval '1 second'
  from public.chat_conversations c where c.organization_id = '00000000-0000-4000-8000-0000000033a0';
select is(public.chat_private_unread(pg_temp.id('a0')), 0, 'and none once they have read it');
reset role;
update public.chat_conversation_reads set read_at = now() - interval '1 minute' where profile_id = pg_temp.id('c1');
select is(pg_temp.dm('b2', 'c1', 'hello back'), 'posted', 'they reply');
select is((select count(*)::int from public.chat_conversations where organization_id = pg_temp.id('a0')), 1, 'in the same conversation');
select pg_temp.as_user('b1');
select is(public.chat_private_unread(pg_temp.id('a0')), 1, 'and the first player has one unread (their own messages never count)');
reset role;
select is(pg_temp.dm('b1', 'c2', 'again'), 'too_fast', 'the rate limit applies');
select is(pg_temp.dm('b1', 'c1', 'me'), 'not_found', 'nobody messages themselves');
select is(pg_temp.dm('b1', 'c4', 'hi team'), 'not_found', 'nor a team login');
select is(pg_temp.dm('b4', 'c2', 'hi'), 'no_profile', 'and the team sends no private messages');
select is(pg_temp.dm('b5', 'c2', 'hi'), 'muted', 'a muted player cannot send');
select is((select status from public.post_private_message(pg_temp.id('a0'), pg_temp.id('b3'), pg_temp.id('c1'), null,
  pg_temp.id('b3')::text || '/' || pg_temp.id('f9')::text || '.jpg')), 'bad_photo', 'a private photo passes the same checks');

-- Blocks
select is(public.block_chat_player(pg_temp.id('a0'), pg_temp.id('b2'), pg_temp.id('c2')), 'not_found', 'nobody blocks themselves');
select is(public.block_chat_player(pg_temp.id('a0'), pg_temp.id('b2'), pg_temp.id('c1')), 'blocked', 'a player blocks another');
update public.chat_messages set created_at = now() - interval '1 minute' where author_user_id in (pg_temp.id('b1'), pg_temp.id('b2'));
select is(pg_temp.dm('b1', 'c2', 'are you there?'), 'blocked', 'the blocked player cannot message them, even in their conversation');
select is(pg_temp.dm('b2', 'c1', 'bye'), 'blocked', 'nor the other way');
select is(public.request_to_join(pg_temp.id('f2'), pg_temp.id('b1')) || ' ' || public.request_to_join(pg_temp.id('f1'), pg_temp.id('b2')),
  'blocked blocked', 'and neither can ask to join the other''s game');
select is(public.unblock_chat_player(pg_temp.id('a0'), pg_temp.id('b2'), pg_temp.id('c1')), 'unblocked', 'unblocking');
select is(pg_temp.dm('b1', 'c2', 'back again'), 'posted', 'lets them talk again');

-- Reports
select is(public.report_chat_message((select message_id from first), pg_temp.id('b3'), 'abuse', null), 'not_found',
  'nobody outside a conversation can report it');
select is(public.report_chat_message((select message_id from first), pg_temp.id('b2'), 'abuse', null), 'reported',
  'the other person can');

select * from finish();
rollback;
