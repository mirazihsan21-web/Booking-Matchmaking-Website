-- Players chat (stage C2): who can read private messages, conversations, read markers and blocks; who can see a chat
-- photo in the private chat-photos bucket (room photos: signed-in people while the message is visible; private
-- photos: the two people; the team: while a report on it is open); uploads only into your own folder; the table
-- rules for photos. Org …30a0; players A b1/c1, B b2/c2, C b3/c3; staff T b4.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000030' || suffix)::uuid $$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(u), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.sees_object(path text) returns int language sql as $$
  select count(*)::int from storage.objects where bucket_id = 'chat-photos' and name = path
$$;

insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-30@test.local' from generate_series(1, 4) n;
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-30', 'Chat 30', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b4'), 'staff');
insert into public.player_profiles (id, organization_id, user_id, display_name)
  select pg_temp.id('c' || n), pg_temp.id('a0'), pg_temp.id('b' || n), (array['Sami', 'Tanvir', 'Nadia'])[n] from generate_series(1, 3) n;
insert into public.chat_conversations (id, organization_id, profile_low, profile_high) values (pg_temp.id('f1'), pg_temp.id('a0'), pg_temp.id('c1'), pg_temp.id('c2'));
insert into public.chat_messages (id, organization_id, author_user_id, author_profile_id, author_kind, author_name, body, conversation_id, photo_path) values
  (pg_temp.id('d1'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', 'psst', pg_temp.id('f1'), null),
  (pg_temp.id('d2'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', 'room pic', null, '00000000-0000-4000-8000-0000000030b1/room.jpg'),
  (pg_temp.id('d3'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', null, pg_temp.id('f1'), '00000000-0000-4000-8000-0000000030b1/priv.jpg');
insert into storage.objects (bucket_id, name) values
  ('chat-photos', '00000000-0000-4000-8000-0000000030b1/room.jpg'),
  ('chat-photos', '00000000-0000-4000-8000-0000000030b1/priv.jpg');
insert into public.chat_blocks (organization_id, blocker_profile_id, blocked_profile_id) values
  (pg_temp.id('a0'), pg_temp.id('c1'), pg_temp.id('c3')),
  (pg_temp.id('a0'), pg_temp.id('c2'), pg_temp.id('c3'));
-- A card, for the card-has-no-photo rule.
insert into public.sections (id, organization_id, name, kind, slug) values (pg_temp.id('a1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values (pg_temp.id('a2'), pg_temp.id('a0'), pg_temp.id('a1'), 'Pitch 1', 'pitch', 14);
insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha)
values (pg_temp.id('e1'), pg_temp.id('a0'), pg_temp.id('a2'), pg_temp.id('c1'), tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour'), 0);
insert into public.chat_cards (id, organization_id, kind, resource_booking_id, poster_user_id, poster_profile_id, poster_name,
  section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed)
values (pg_temp.id('e2'), pg_temp.id('a0'), 'booking', pg_temp.id('e1'), pg_temp.id('b1'), pg_temp.id('c1'), 'Sami',
  pg_temp.id('a1'), 'Turf', 'turf', '#43a66b', 'Pitch 1', now() + interval '1 day', now() + interval '1 day 1 hour', 3);

-- Private messages and conversations
select pg_temp.as_user('b1');
select is((select count(*)::int from public.chat_messages where id = pg_temp.id('d1')), 1, 'the sender reads a private message');
select is((select count(*)::int from public.chat_conversations), 1, 'and the conversation');
select lives_ok($$ insert into public.chat_conversation_reads (conversation_id, organization_id, profile_id, read_at)
  values ('00000000-0000-4000-8000-0000000030f1', '00000000-0000-4000-8000-0000000030a0', '00000000-0000-4000-8000-0000000030c1', now()) $$,
  'a participant marks the conversation read');
select lives_ok($$ update public.chat_conversation_reads set read_at = now() where profile_id = '00000000-0000-4000-8000-0000000030c1' $$,
  'and moves the marker on');
select throws_ok($$ update public.chat_conversation_reads set emailed_at = now() where profile_id = '00000000-0000-4000-8000-0000000030c1' $$,
  '42501', null, 'but cannot touch when the reminder went');
select is((select count(*)::int from public.chat_blocks), 1, 'a player reads only their own blocks');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('chat-photos', '00000000-0000-4000-8000-0000000030b1/new.jpg') $$,
  'a player uploads into their own photo folder');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('chat-photos', '00000000-0000-4000-8000-0000000030b2/new.jpg') $$,
  '42501', null, 'not into someone else''s');

select pg_temp.as_user('b2');
select is((select count(*)::int from public.chat_messages where id = pg_temp.id('d1')), 1, 'the other person reads it');
select is(pg_temp.sees_object('00000000-0000-4000-8000-0000000030b1/priv.jpg'), 1, 'and can see its photo');

select pg_temp.as_user('b3');
select is((select count(*)::int from public.chat_messages where id = pg_temp.id('d1')), 0, 'nobody else reads a private message');
select is((select count(*)::int from public.chat_conversations), 0, 'nor sees the conversation');
select is(pg_temp.sees_object('00000000-0000-4000-8000-0000000030b1/priv.jpg'), 0, 'nor its photo');
select is((select count(*)::int from public.chat_messages where id = pg_temp.id('d2')), 1, 'the room is still open to everyone signed in');
select is(pg_temp.sees_object('00000000-0000-4000-8000-0000000030b1/room.jpg'), 1, 'with its photos');
select throws_ok($$ insert into public.chat_conversation_reads (conversation_id, organization_id, profile_id, read_at)
  values ('00000000-0000-4000-8000-0000000030f1', '00000000-0000-4000-8000-0000000030a0', '00000000-0000-4000-8000-0000000030c3', now()) $$,
  '42501', null, 'an outsider cannot add a read marker to a conversation');
select throws_ok($$ select count(*) from public.chat_photo_trash $$, '42501', null, 'signed-in people cannot read the photo trash');

select pg_temp.as_user('b4');
select is((select count(*)::int from public.chat_messages where id = pg_temp.id('d1')), 0, 'the team does not read private messages');
reset role;

-- A room photo hidden by reports: players lose it, the team sees it while a report is open.
update public.chat_messages set state = 'hidden_by_reports', body = null where id = pg_temp.id('d2');
insert into public.chat_reports (organization_id, message_id, reporter_profile_id, reason, author_name_copy)
values (pg_temp.id('a0'), pg_temp.id('d2'), pg_temp.id('c2'), 'photo', 'Sami');
select pg_temp.as_user('b3');
select is(pg_temp.sees_object('00000000-0000-4000-8000-0000000030b1/room.jpg'), 0, 'a hidden photo is gone for players');
select pg_temp.as_user('b4');
select is(pg_temp.sees_object('00000000-0000-4000-8000-0000000030b1/room.jpg'), 1, 'the team sees it while the report is open');
reset role;

set local role anon;
select throws_ok($$ select count(*) from public.chat_conversations $$, '42501', null, 'visitors get nothing');
reset role;

-- Table rules
select throws_ok($$ insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, card_id, photo_path)
  values ('00000000-0000-4000-8000-0000000030a0', '00000000-0000-4000-8000-0000000030b1', '00000000-0000-4000-8000-0000000030c1', 'player', 'Sami',
          '00000000-0000-4000-8000-0000000030e2', '00000000-0000-4000-8000-0000000030b1/card.jpg') $$,
  '23514', null, 'a card has no photo');
select throws_ok($$ insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, photo_path)
  values ('00000000-0000-4000-8000-0000000030a0', '00000000-0000-4000-8000-0000000030b2', '00000000-0000-4000-8000-0000000030c2', 'player', 'Tanvir',
          '00000000-0000-4000-8000-0000000030b1/priv.jpg') $$,
  '23505', null, 'a photo belongs to one message');
select lives_ok($$ insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, photo_path)
  values ('00000000-0000-4000-8000-0000000030a0', '00000000-0000-4000-8000-0000000030b2', '00000000-0000-4000-8000-0000000030c2', 'player', 'Tanvir',
          '00000000-0000-4000-8000-0000000030b2/only.jpg') $$,
  'a photo with no words is a message');
select ok(exists (select 1 from storage.buckets where id = 'chat-photos' and not public and file_size_limit = 2097152), 'the photo bucket is private, 2 MB');

select * from finish();
rollback;
