-- The players chat (stage C1): who can read which chat rows, that the browser can't write them (everything goes
-- through the server), the live-update publication, and the table rules (500 characters, a team message has no
-- player profile, one open card per booking). Org …24a0 with a section, a pitch, players A/B/C and staff T.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000024' || suffix)::uuid $$;

insert into auth.users (id, email) values
  (pg_temp.id('b1'), 'a24@test.local'), (pg_temp.id('b2'), 'b24@test.local'),
  (pg_temp.id('b3'), 'c24@test.local'), (pg_temp.id('b4'), 't24@test.local');
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-24', 'Chat Arena', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b4'), 'staff');
insert into public.sections (id, organization_id, name, kind, slug) values (pg_temp.id('a1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf');
insert into public.resources (id, organization_id, section_id, name, kind, capacity)
values (pg_temp.id('a2'), pg_temp.id('a0'), pg_temp.id('a1'), 'Pitch 1', 'pitch', 14);
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  (pg_temp.id('c1'), pg_temp.id('a0'), pg_temp.id('b1'), 'Sami'),
  (pg_temp.id('c2'), pg_temp.id('a0'), pg_temp.id('b2'), 'Tanvir'),
  (pg_temp.id('c3'), pg_temp.id('a0'), pg_temp.id('b3'), 'Nadia');
insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha)
values (pg_temp.id('e1'), pg_temp.id('a0'), pg_temp.id('a2'), pg_temp.id('c1'),
        tstzrange(now() + interval '2 days', now() + interval '2 days 1 hour'), 250000);

insert into public.chat_cards (id, organization_id, kind, resource_booking_id, poster_user_id, poster_profile_id, poster_name,
  section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed)
values (pg_temp.id('f1'), pg_temp.id('a0'), 'booking', pg_temp.id('e1'), pg_temp.id('b1'), pg_temp.id('c1'), 'Sami',
  pg_temp.id('a1'), 'Turf', 'turf', '#43a66b', 'Pitch 1', now() + interval '2 days', now() + interval '2 days 1 hour', 3);
insert into public.chat_messages (id, organization_id, author_user_id, author_profile_id, author_kind, author_name, body, card_id) values
  (pg_temp.id('d1'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', 'anyone for futsal?', null),
  (pg_temp.id('d2'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', null, pg_temp.id('f1'));
insert into public.chat_join_requests (organization_id, card_id, profile_id) values (pg_temp.id('a0'), pg_temp.id('f1'), pg_temp.id('c2'));
insert into public.chat_reports (organization_id, message_id, reporter_profile_id, reason, body_copy, author_name_copy)
values (pg_temp.id('a0'), pg_temp.id('d1'), pg_temp.id('c2'), 'spam', 'anyone for futsal?', 'Sami');
insert into public.chat_message_archive (message_id, organization_id, body) values (pg_temp.id('d1'), pg_temp.id('a0'), 'kept for the team');
insert into public.chat_blocked_words (organization_id, word) values (pg_temp.id('a0'), 'gadha');
insert into public.chat_mutes (organization_id, profile_id, until) values (pg_temp.id('a0'), pg_temp.id('c1'), now() + interval '1 day');

-- Visitors
set local role anon;
select throws_ok($$ select count(*) from public.chat_messages $$, '42501', null, 'visitors cannot read the chat');
select throws_ok($$ select count(*) from public.chat_cards $$, '42501', null, 'nor its cards');
reset role;

-- Player A (the poster)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000024b1","role":"authenticated"}';
select is((select count(*)::int from public.chat_messages where organization_id = pg_temp.id('a0')), 2, 'a signed-in player reads the room');
select is((select count(*)::int from public.chat_cards where organization_id = pg_temp.id('a0')), 1, 'and its cards');
select throws_ok($$ insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, body)
  values ('00000000-0000-4000-8000-0000000024a0', '00000000-0000-4000-8000-0000000024b1', '00000000-0000-4000-8000-0000000024c1', 'player', 'Sami', 'hi') $$,
  '42501', null, 'the browser cannot post messages');
select throws_ok($$ update public.chat_cards set spots_taken = 3 $$, '42501', null, 'nor change cards');
select throws_ok($$ insert into public.chat_join_requests (organization_id, card_id, profile_id)
  values ('00000000-0000-4000-8000-0000000024a0', '00000000-0000-4000-8000-0000000024f1', '00000000-0000-4000-8000-0000000024c3') $$,
  '42501', null, 'nor ask to join');
select throws_ok($$ insert into public.chat_reports (organization_id, message_id, reporter_profile_id, reason, author_name_copy)
  values ('00000000-0000-4000-8000-0000000024a0', '00000000-0000-4000-8000-0000000024d1', '00000000-0000-4000-8000-0000000024c1', 'spam', 'Sami') $$,
  '42501', null, 'nor report');
select is((select count(*)::int from public.chat_join_requests), 1, 'the poster reads the requests on their card');
select is((select count(*)::int from public.chat_reports), 0, 'players cannot read reports');
select is((select count(*)::int from public.chat_message_archive), 0, 'nor removed text');
select is((select count(*)::int from public.chat_blocked_words), 0, 'nor the venue word list');
select is((select count(*)::int from public.chat_mutes), 1, 'a muted player reads their own mute');
select lives_ok($$ insert into public.chat_reads (organization_id, user_id, room_read_at)
  values ('00000000-0000-4000-8000-0000000024a0', '00000000-0000-4000-8000-0000000024b1', now())
  on conflict (organization_id, user_id) do update set room_read_at = excluded.room_read_at $$, 'a player marks the room read');
select throws_ok($$ insert into public.chat_reads (organization_id, user_id, room_read_at)
  values ('00000000-0000-4000-8000-0000000024a0', '00000000-0000-4000-8000-0000000024b2', now()) $$,
  '42501', null, 'but not for someone else');

-- Player B (asked to join)
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000024b2","role":"authenticated"}';
select is((select count(*)::int from public.chat_join_requests), 1, 'a player reads their own request');
select is((select count(*)::int from public.chat_mutes), 0, 'but not someone else''s mute');
select is((select count(*)::int from public.chat_reads), 0, 'nor anyone else''s read marker');

-- Player C (not involved)
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000024b3","role":"authenticated"}';
select is((select count(*)::int from public.chat_join_requests), 0, 'other players cannot see who asked to join');

-- Staff T
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000024b4","role":"authenticated"}';
select is((select count(*)::int from public.chat_reports), 1, 'the team reads reports');
select is((select count(*)::int from public.chat_message_archive), 1, 'and removed text');
select is((select count(*)::int from public.chat_mutes), 1, 'and every mute');
reset role;

select is(
  (select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('chat_messages', 'chat_cards')),
  2, 'messages and cards are sent live');
select ok(has_table_privilege('service_role', 'public.chat_messages', 'INSERT,UPDATE,DELETE'), 'the server writes the chat');

select throws_ok($$ insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, body)
  values ('00000000-0000-4000-8000-0000000024a0', '00000000-0000-4000-8000-0000000024b1', '00000000-0000-4000-8000-0000000024c1', 'player', 'Sami', repeat('⚽', 501)) $$,
  '23514', null, 'a message is at most 500 characters');
select lives_ok($$ insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, body)
  values ('00000000-0000-4000-8000-0000000024a0', '00000000-0000-4000-8000-0000000024b1', '00000000-0000-4000-8000-0000000024c1', 'player', 'Sami', repeat('⚽', 500)) $$,
  '500 emoji fit');
select throws_ok($$ insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, body)
  values ('00000000-0000-4000-8000-0000000024a0', '00000000-0000-4000-8000-0000000024b4', '00000000-0000-4000-8000-0000000024c1', 'team', 'Chat Arena', 'hello') $$,
  '23514', null, 'a team message has no player profile');
select throws_ok($$ insert into public.chat_cards (organization_id, kind, resource_booking_id, poster_user_id, poster_profile_id, poster_name,
  section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed)
  values ('00000000-0000-4000-8000-0000000024a0', 'booking', '00000000-0000-4000-8000-0000000024e1', '00000000-0000-4000-8000-0000000024b1',
  '00000000-0000-4000-8000-0000000024c1', 'Sami', '00000000-0000-4000-8000-0000000024a1', 'Turf', 'turf', '#43a66b', 'Pitch 1', now(), now() + interval '1 hour', 2) $$,
  '23505', null, 'one open card per booking');

select * from finish();
rollback;
