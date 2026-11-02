-- The every-minute job's chat work (stage C1): cards close when their booking or session is cancelled (accepted and
-- waiting players are told) or their game starts (quietly); session cards with no seats left close as full; and
-- after 30 days messages, cards, resolved reports and ended mutes are deleted. Org …28a0.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000028' || suffix)::uuid $$;
create function pg_temp.card(card text, kind text, booking text, session text, starts timestamptz) returns void language sql as $$
  insert into public.chat_cards (id, organization_id, kind, resource_booking_id, session_id, poster_user_id, poster_profile_id, poster_name,
    section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed, spots_taken)
  values (pg_temp.id(card), pg_temp.id('a0'), kind::public.chat_card_kind, case when booking is null then null else pg_temp.id(booking) end,
    case when session is null then null else pg_temp.id(session) end, pg_temp.id('b1'), pg_temp.id('c1'), 'Sami',
    pg_temp.id('a1'), 'Turf', 'turf', '#43a66b', 'Pitch 1', starts, starts + interval '1 hour',
    case when kind = 'booking' then 3 end, case when kind = 'booking' then 1 else 0 end)
$$;

insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-28@test.local' from generate_series(1, 4) n;
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-28', 'Chat 28', 'turf', 'live');
insert into public.player_profiles (id, organization_id, user_id, display_name)
  select pg_temp.id('c' || n), pg_temp.id('a0'), pg_temp.id('b' || n), (array['Sami', 'Tanvir', 'Nadia', 'Dina'])[n] from generate_series(1, 4) n;
insert into public.sections (id, organization_id, name, kind, slug) values (pg_temp.id('a1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values (pg_temp.id('a2'), pg_temp.id('a0'), pg_temp.id('a1'), 'Pitch 1', 'pitch', 14);
insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha, status) values
  (pg_temp.id('e1'), pg_temp.id('a0'), pg_temp.id('a2'), pg_temp.id('c1'), tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour'), 0, 'cancelled'),
  (pg_temp.id('e2'), pg_temp.id('a0'), pg_temp.id('a2'), pg_temp.id('c1'), tstzrange(now() - interval '5 minutes', now() + interval '55 minutes'), 0, 'confirmed'),
  (pg_temp.id('e5'), pg_temp.id('a0'), pg_temp.id('a2'), pg_temp.id('c1'), tstzrange(now() - interval '32 days', now() - interval '31 days'), 0, 'attended');
insert into public.open_play_sessions (id, organization_id, section_id, starts_at, ends_at, seat_price_poisha, status) values
  (pg_temp.id('aa'), pg_temp.id('a0'), pg_temp.id('a1'), now() + interval '2 days', now() + interval '2 days 1 hour', 0, 'cancelled'),
  (pg_temp.id('ab'), pg_temp.id('a0'), pg_temp.id('a1'), now() + interval '3 days', now() + interval '3 days 1 hour', 0, 'open');

select pg_temp.card('f1', 'booking', 'e1', null, now() + interval '1 day');     -- its booking was cancelled
select pg_temp.card('f2', 'booking', 'e2', null, now() - interval '5 minutes'); -- its game has started
select pg_temp.card('f3', 'session', null, 'aa', now() + interval '2 days');    -- its session was cancelled
select pg_temp.card('f4', 'session', null, 'ab', now() + interval '3 days');    -- its session is full
select pg_temp.card('f5', 'booking', 'e5', null, now() - interval '32 days');   -- a month old
update public.chat_cards set status = 'closed' where id = pg_temp.id('f5');
insert into public.chat_join_requests (organization_id, card_id, profile_id, status) values
  (pg_temp.id('a0'), pg_temp.id('f1'), pg_temp.id('c2'), 'accepted'),
  (pg_temp.id('a0'), pg_temp.id('f1'), pg_temp.id('c3'), 'pending'),
  (pg_temp.id('a0'), pg_temp.id('f2'), pg_temp.id('c4'), 'pending'),
  (pg_temp.id('a0'), pg_temp.id('f5'), pg_temp.id('c2'), 'accepted');

-- Closing
create temp table closed as select * from public.close_due_chat_cards();
select is((select string_agg(outcome, ',' order by outcome) from closed where card_id in (pg_temp.id('f1'), pg_temp.id('f2'), pg_temp.id('f3'))),
  'cancelled,cancelled,started', 'cancelled bookings and sessions, and started games, are closed');
select is((select status::text from public.chat_cards where id = pg_temp.id('f1')), 'cancelled', 'a card whose booking was cancelled says so');
select is((select string_agg(p.display_name, ',' order by p.display_name) from public.notifications n join public.player_profiles p on p.id = n.profile_id
           where n.kind = 'chat_game_cancelled' and n.payload ->> 'card_id' = pg_temp.id('f1')::text),
  'Nadia,Tanvir', 'and the accepted and waiting players are told once each');
select is((select status::text from public.chat_join_requests where card_id = pg_temp.id('f1') and profile_id = pg_temp.id('c3')), 'expired', 'the waiting request expires');
select is((select status::text from public.chat_cards where id = pg_temp.id('f3')), 'cancelled', 'a card whose session was cancelled too');
select is((select status::text from public.chat_cards where id = pg_temp.id('f2')), 'started', 'a card whose game started is closed');
select is((select count(*)::int from public.notifications where profile_id = pg_temp.id('c4')), 0, 'quietly');
select is((select status::text from public.chat_join_requests where card_id = pg_temp.id('f2')), 'expired', 'its waiting request expires');
select is((select count(*)::int from public.close_due_chat_cards() where card_id in (pg_temp.id('f1'), pg_temp.id('f2'), pg_temp.id('f3'))), 0,
  'running it again changes nothing');
select is(public.close_session_cards(array[pg_temp.id('ab')]), 1, 'a session card with no seats left');
select is((select status::text from public.chat_cards where id = pg_temp.id('f4')), 'full', 'shows full');

-- Purging
insert into public.chat_messages (id, organization_id, author_user_id, author_profile_id, author_kind, author_name, body, created_at) values
  (pg_temp.id('d1'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', 'old', now() - interval '31 days'),
  (pg_temp.id('d2'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', 'recent', now() - interval '29 days');
insert into public.chat_reports (organization_id, message_id, reporter_profile_id, reason, author_name_copy, status, resolved_at) values
  (pg_temp.id('a0'), pg_temp.id('d2'), pg_temp.id('c2'), 'spam', 'Sami', 'dismissed', now() - interval '31 days'),
  (pg_temp.id('a0'), pg_temp.id('d2'), pg_temp.id('c3'), 'spam', 'Sami', 'open', null);
insert into public.chat_mutes (organization_id, profile_id, until) values
  (pg_temp.id('a0'), pg_temp.id('c2'), now() - interval '31 days'),
  (pg_temp.id('a0'), pg_temp.id('c3'), null);
select is((select count(*)::int from public.purge_chat()), 0, 'the purge has no photos to delete in stage C1');
select is((select string_agg(body, ',') from public.chat_messages where id in (pg_temp.id('d1'), pg_temp.id('d2'))), 'recent',
  'messages older than 30 days are deleted');
select is((select count(*)::int from public.chat_cards where id = pg_temp.id('f5')), 0, 'cards 30 days after their game');
select is((select count(*)::int from public.chat_join_requests where card_id = pg_temp.id('f5')), 0, 'with their requests');
select is((select count(*)::int from public.chat_reports where message_id = pg_temp.id('d2') and status = 'dismissed'), 0, 'resolved reports after 30 days');
select is((select count(*)::int from public.chat_reports where message_id = pg_temp.id('d2') and status = 'open'), 1, 'but not open ones');
select is((select string_agg(profile_id::text, ',') from public.chat_mutes where organization_id = pg_temp.id('a0')), pg_temp.id('c3')::text,
  'mutes that ended 30 days ago are deleted, active ones stay');
select ok(
  not has_function_privilege('authenticated', 'public.close_due_chat_cards()', 'execute')
  and not has_function_privilege('authenticated', 'public.purge_chat(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.close_session_cards(uuid[])', 'execute'),
  'only the job runs these');

select * from finish();
rollback;
