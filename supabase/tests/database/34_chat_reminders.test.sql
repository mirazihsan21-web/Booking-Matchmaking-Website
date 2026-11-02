-- Players chat (stage C2): the unread private-message reminder. One notification (bell + email through the outbox)
-- when a message from the other person has waited unread for 15 minutes; not again for 12 hours; never for a message
-- that's newer than 15 minutes, already read, your own, or removed. Org …34a0.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000034' || suffix)::uuid $$;
create function pg_temp.notes(profile text) returns int language sql as $$
  select count(*)::int from public.notifications where kind = 'chat_private_message' and profile_id = pg_temp.id(profile)
$$;
create function pg_temp.say(conversation text, author text, author_name text, ago interval, state text default 'visible') returns void language sql as $$
  insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, body, conversation_id, created_at, state)
  values (pg_temp.id('a0'), pg_temp.id('b' || substr(author, 2)), pg_temp.id(author), 'player', author_name,
          case when state = 'visible' then 'hello' end, pg_temp.id(conversation), now() - ago, state::public.chat_message_state)
$$;

-- A b1/c1 Sami · B b2/c2 Tanvir · C b3/c3 Nadia · D b4/c4 Dina
insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-34@test.local' from generate_series(1, 4) n;
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-34', 'Chat 34', 'turf', 'live');
insert into public.player_profiles (id, organization_id, user_id, display_name)
  select pg_temp.id('c' || n), pg_temp.id('a0'), pg_temp.id('b' || n), (array['Sami', 'Tanvir', 'Nadia', 'Dina'])[n] from generate_series(1, 4) n;
insert into public.chat_conversations (id, organization_id, profile_low, profile_high) values
  (pg_temp.id('f1'), pg_temp.id('a0'), pg_temp.id('c1'), pg_temp.id('c2')),  -- A → B, 20 minutes unread
  (pg_temp.id('f2'), pg_temp.id('a0'), pg_temp.id('c1'), pg_temp.id('c3')),  -- A → C, only 10 minutes old
  (pg_temp.id('f3'), pg_temp.id('a0'), pg_temp.id('c2'), pg_temp.id('c3')),  -- B → C, already read
  (pg_temp.id('f4'), pg_temp.id('a0'), pg_temp.id('c1'), pg_temp.id('c4'));  -- A → D, removed
select pg_temp.say('f1', 'c1', 'Sami', interval '20 minutes');
select pg_temp.say('f2', 'c1', 'Sami', interval '10 minutes');
select pg_temp.say('f3', 'c2', 'Tanvir', interval '30 minutes');
select pg_temp.say('f4', 'c1', 'Sami', interval '30 minutes', 'removed_by_author');
insert into public.chat_conversation_reads (conversation_id, organization_id, profile_id, read_at)
values (pg_temp.id('f3'), pg_temp.id('a0'), pg_temp.id('c3'), now() - interval '5 minutes');

select is(public.due_private_message_reminders(), 1, 'one message has waited unread for 15 minutes');
select row_eq(
  $$ select payload ->> 'sender_name', link from public.notifications where kind = 'chat_private_message' and profile_id = '00000000-0000-4000-8000-0000000034c2' $$,
  row('Sami'::text, '/chat/private/00000000-0000-4000-8000-0000000034c1'::text),
  'its reader hears who it is from, with a link to the conversation');
select is(pg_temp.notes('c3') + pg_temp.notes('c4'), 0,
  'nothing for a message only 10 minutes old, one already read, or one removed');
select is(pg_temp.notes('c1'), 0, 'nor for your own messages');
select is(public.due_private_message_reminders(), 0, 'running again sends nothing more');
select pg_temp.say('f1', 'c1', 'Sami', interval '-30 minutes'); -- a new one, half an hour from now
select public.due_private_message_reminders(now() + interval '11 hours');
select is(pg_temp.notes('c2'), 1, 'the same reader is not reminded again within 12 hours');
select public.due_private_message_reminders(now() + interval '13 hours');
select is(pg_temp.notes('c2'), 2, 'but after 12 hours a new unread message reminds them again');
select ok(
  not has_function_privilege('authenticated', 'public.due_private_message_reminders(timestamptz)', 'execute'),
  'only the job sends reminders');

select * from finish();
rollback;
