-- Players chat (stage C2): photos. A message may be just a photo; the path must be the sender's own upload, exist in
-- the chat-photos bucket and not be on another message; 10 photos an hour. Removing queues the photo for deletion
-- (once no report on it is open); hiding by reports keeps it; the purge queues old and never-posted photos and drops
-- old conversations; the job takes and forgets queued paths. Org …32a0.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000032' || suffix)::uuid $$;
-- `<user b?>/<file f?>.jpg`
create function pg_temp.photo(u text, f text) returns text language sql as $$ select pg_temp.id(u)::text || '/' || pg_temp.id(f)::text || '.jpg' $$;
create function pg_temp.post(u text, body text, path text) returns text language sql as $$
  select status from public.post_chat_message(pg_temp.id('a0'), pg_temp.id(u), body, path)
$$;
create function pg_temp.queued(path text) returns boolean language sql as $$ select exists (select 1 from public.chat_photo_trash where chat_photo_trash.path = $1) $$;

-- A b1/c1 · B b2/c2 · C b3/c3 · T b4 staff · X b5/c5 (10 photos this hour)
insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-32@test.local' from generate_series(1, 5) n;
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-32', 'Chat 32', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b4'), 'staff');
insert into public.player_profiles (id, organization_id, user_id, display_name)
  select pg_temp.id('c' || n), pg_temp.id('a0'), pg_temp.id('b' || n), (array['Sami', 'Tanvir', 'Nadia', 'Tee', 'Xavier'])[n]
  from generate_series(1, 5) n where n <> 4;
insert into storage.objects (bucket_id, name, created_at) values
  ('chat-photos', pg_temp.photo('b1', 'f1'), now()),
  ('chat-photos', pg_temp.photo('b1', 'f2'), now()),
  ('chat-photos', pg_temp.photo('b1', 'f3'), now()),
  ('chat-photos', pg_temp.photo('b1', 'f4'), now() - interval '40 days'),
  ('chat-photos', pg_temp.photo('b2', 'f5'), now()),
  ('chat-photos', pg_temp.photo('b5', 'f6'), now()),
  ('chat-photos', pg_temp.photo('b3', 'e1'), now() - interval '2 days'),
  ('chat-photos', pg_temp.photo('b3', 'e2'), now() - interval '1 hour');
-- X's ten photos this hour; A's old photo message; A's photo message that three players will report.
insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, photo_path, created_at)
  select pg_temp.id('a0'), pg_temp.id('b5'), pg_temp.id('c5'), 'player', 'Xavier', 'x-' || n || '.jpg', now() - interval '30 minutes'
  from generate_series(1, 10) n;
insert into public.chat_messages (id, organization_id, author_user_id, author_profile_id, author_kind, author_name, photo_path, created_at) values
  (pg_temp.id('d4'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', pg_temp.photo('b1', 'f4'), now() - interval '31 days'),
  (pg_temp.id('d3'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', pg_temp.photo('b1', 'f3'), now() - interval '2 hours');
insert into public.chat_conversations (id, organization_id, profile_low, profile_high, last_message_at)
values (pg_temp.id('aa'), pg_temp.id('a0'), pg_temp.id('c2'), pg_temp.id('c3'), now() - interval '31 days');

-- Posting
create temp table only_photo as select * from public.post_chat_message(pg_temp.id('a0'), pg_temp.id('b1'), null, pg_temp.photo('b1', 'f1'));
select is((select status from only_photo), 'posted', 'a photo on its own is a message');
select row_eq($$ select body, photo_path from public.chat_messages where id = (select message_id from only_photo) $$,
  row(null::text, pg_temp.photo('b1', 'f1')), 'with no words');
select is(pg_temp.post('b2', 'our team', pg_temp.photo('b2', 'f5')), 'posted', 'a photo with a caption');
select is(pg_temp.post('b3', null, pg_temp.photo('b1', 'f2')), 'bad_photo', 'nobody posts someone else''s photo');
select is(pg_temp.post('b1', null, pg_temp.photo('b1', 'f9')), 'bad_photo', 'nor a photo that was never uploaded');
select is(pg_temp.post('b2', 'again', pg_temp.photo('b2', 'f5')), 'bad_photo', 'nor a photo already on a message');
select is(pg_temp.post('b5', null, pg_temp.photo('b5', 'f6')), 'too_many_photos', '10 photos an hour');
select is(pg_temp.post('b3', '  ', null), 'invalid', 'neither words nor a photo is nothing to send');

-- Removing
select is(public.remove_chat_message((select message_id from only_photo), pg_temp.id('b1'), false), 'removed', 'the author removes their photo');
select ok(pg_temp.queued(pg_temp.photo('b1', 'f1')), 'and it is queued for deletion');
select is(public.report_chat_message((select id from public.chat_messages where photo_path = pg_temp.photo('b2', 'f5')), pg_temp.id('b3'), 'photo', null),
  'reported', 'a photo is reported');
select is(public.remove_chat_message((select id from public.chat_messages where photo_path = pg_temp.photo('b2', 'f5')), pg_temp.id('b2'), false),
  'removed', 'then its author removes it');
select ok(not pg_temp.queued(pg_temp.photo('b2', 'f5')), 'it stays while the report is open, for the team to see');
select is(public.resolve_chat_reports((select id from public.chat_messages where photo_path = pg_temp.photo('b2', 'f5')), pg_temp.id('b4'), 'remove'),
  'resolved', 'the team resolves the report');
select ok(pg_temp.queued(pg_temp.photo('b2', 'f5')), 'and now it is queued');
select is((select count(*)::int from (select public.report_chat_message(pg_temp.id('d3'), pg_temp.id(u), 'photo', null) from unnest(array['b2', 'b3', 'b5']) u) r), 3,
  'three players report a photo');
select ok(not pg_temp.queued(pg_temp.photo('b1', 'f3')), 'hidden by reports, it is kept');
select is(public.resolve_chat_reports(pg_temp.id('d3'), pg_temp.id('b4'), 'dismiss'), 'resolved', 'dismissed, it comes back');

-- Purge and the queue
select set_eq($$ select * from public.purge_chat() $$,
  array[pg_temp.photo('b1', 'f4'), pg_temp.photo('b3', 'e1')],
  'the purge queues a month-old message''s photo and a photo uploaded two days ago but never posted (not one from an hour ago)');
select is((select count(*)::int from public.chat_conversations where id = pg_temp.id('aa')), 0, 'and drops a conversation quiet for 30 days');
select ok(pg_temp.photo('b1', 'f1') in (select * from public.take_chat_photo_trash(10)), 'the job takes queued paths');
select public.forget_chat_photo_trash(array[pg_temp.photo('b1', 'f1')]);
select ok(not pg_temp.queued(pg_temp.photo('b1', 'f1')), 'and forgets them once Storage has deleted them');

select * from finish();
rollback;
