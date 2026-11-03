-- Players chat (stage C2) — fixes from the final review: the team never reads a private message's removed text (the
-- archive keeps room text only for them) nor a reported one's copy once they have decided; the unread reminder doesn't
-- repeat for the same unread message, and leaves blocked pairs alone (so does the unread count); never-posted uploads
-- are queued whoever made them; uploads need a profile or a team login and stop at 20 an hour. Org …35a0.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000035' || suffix)::uuid $$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(u), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.say(id text, conversation text, author text, body text, ago interval) returns void language sql as $$
  insert into public.chat_messages (id, organization_id, author_user_id, author_profile_id, author_kind, author_name, body, conversation_id, created_at)
  values (pg_temp.id(id), pg_temp.id('a0'), pg_temp.id('b' || substr(author, 2)), pg_temp.id(author), 'player', 'Player', body,
          case when conversation is null then null else pg_temp.id(conversation) end, now() - ago)
$$;

-- A b1/c1 · B b2/c2 · C b3/c3 · T b4 staff (no profile) · U b5 (signed in, no profile, not on the team)
insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-35@test.local' from generate_series(1, 5) n;
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-35', 'Chat 35', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b4'), 'staff');
insert into public.player_profiles (id, organization_id, user_id, display_name)
  select pg_temp.id('c' || n), pg_temp.id('a0'), pg_temp.id('b' || n), (array['Sami', 'Tanvir', 'Nadia'])[n] from generate_series(1, 3) n;
insert into public.chat_conversations (id, organization_id, profile_low, profile_high) values
  (pg_temp.id('f1'), pg_temp.id('a0'), pg_temp.id('c1'), pg_temp.id('c2')),
  (pg_temp.id('f2'), pg_temp.id('a0'), pg_temp.id('c2'), pg_temp.id('c3'));
select pg_temp.say('d1', 'f1', 'c1', 'a private secret', interval '2 hours');
select pg_temp.say('d2', null, 'c1', 'a room line', interval '2 hours');
select pg_temp.say('d3', 'f1', 'c1', 'reported privately', interval '2 hours');
select pg_temp.say('d4', 'f1', 'c1', 'are you coming?', interval '20 minutes');
select pg_temp.say('d5', 'f2', 'c3', 'from someone blocked', interval '20 minutes');
insert into public.chat_conversation_reads (conversation_id, organization_id, profile_id, read_at)
values (pg_temp.id('f1'), pg_temp.id('a0'), pg_temp.id('c2'), now() - interval '1 hour');
insert into public.chat_blocks (organization_id, blocker_profile_id, blocked_profile_id) values (pg_temp.id('a0'), pg_temp.id('c2'), pg_temp.id('c3'));
insert into storage.objects (bucket_id, name, created_at) values ('chat-photos', pg_temp.id('b5')::text || '/' || pg_temp.id('e1')::text || '.jpg', now() - interval '2 days');

-- The team never reads a private message's removed text, nor a reported one's copy once decided.
select is(public.remove_chat_message(pg_temp.id('d1'), pg_temp.id('b1'), false), 'removed', 'a player removes a private message');
select is(public.remove_chat_message(pg_temp.id('d2'), pg_temp.id('b1'), false), 'removed', 'and a room message');
select is(public.report_chat_message(pg_temp.id('d3'), pg_temp.id('b2'), 'abuse', null), 'reported', 'the other person reports a private message');
select pg_temp.as_user('b4');
select is((select string_agg(body, ',') from public.chat_message_archive where organization_id = pg_temp.id('a0')), 'a room line',
  'the team reads removed room text, never removed private text');
select is((select body_copy from public.chat_reports where message_id = pg_temp.id('d3')), 'reported privately', 'they see the reported copy while it is open');
reset role;
select is(public.resolve_chat_reports(pg_temp.id('d3'), pg_temp.id('b4'), 'dismiss'), 'resolved', 'the team decides');
select pg_temp.as_user('b4');
select is((select body_copy from public.chat_reports where message_id = pg_temp.id('d3')), null, 'and then the copy of the private message is gone');
reset role;

-- Reminders: once per unread message, and never about someone you blocked.
select is(public.due_private_message_reminders(), 1, 'one reminder: Sami''s unread message (not the one from Nadia, whom Tanvir blocked)');
select is(public.due_private_message_reminders(now() + interval '13 hours'), 0, 'and not again 13 hours later for the same unread message');
select pg_temp.as_user('b2');
select is(public.chat_private_unread(pg_temp.id('a0')), 1, 'the unread count leaves out a blocked conversation');
reset role;

-- Uploads.
select ok(pg_temp.id('b5')::text || '/' || pg_temp.id('e1')::text || '.jpg' in (select * from public.purge_chat()),
  'a never-posted upload is queued whoever uploaded it (here someone with no player profile)');
select pg_temp.as_user('b5');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('chat-photos', '00000000-0000-4000-8000-0000000035b5/new.jpg') $$,
  '42501', null, 'someone with no profile and not on the team cannot upload');
reset role;
select pg_temp.as_user('b1');
select lives_ok($$ do $d$ begin
  for n in 1..20 loop
    insert into storage.objects (bucket_id, name) values ('chat-photos', '00000000-0000-4000-8000-0000000035b1/' || n || '.jpg');
  end loop;
end $d$ $$, 'a player uploads 20 photos in an hour');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('chat-photos', '00000000-0000-4000-8000-0000000035b1/21.jpg') $$,
  '42501', null, 'but not a 21st');
select pg_temp.as_user('b4');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('chat-photos', '00000000-0000-4000-8000-0000000035b4/team.jpg') $$,
  'a team login can upload (the team posts in the room)');
reset role;

select * from finish();
rollback;
