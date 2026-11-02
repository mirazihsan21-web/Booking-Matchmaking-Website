-- Reports, mutes and the venue's word list (stage C1): one report per message per player and 20 a day; each report
-- keeps a copy; 3 players reporting hides the message at once (its text leaves the API); the team removes or
-- dismisses (a hidden message comes back); the team mutes for 1 day, 7 days or until unmuted, and keeps a word list.
-- Org …27a0; staff T b4; players A b1 (writes), B b2, C b3, D b5, E b6 (20 reports today), X b7.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000027' || suffix)::uuid $$;
create function pg_temp.report(u text, message text) returns text language sql as $$
  select public.report_chat_message(pg_temp.id(message), pg_temp.id(u), 'spam', null)
$$;
create function pg_temp.word(u text, word text, add boolean) returns text language sql as $$
  select public.set_chat_blocked_word(pg_temp.id('a0'), pg_temp.id(u), word, add)
$$;

insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-27@test.local' from generate_series(1, 7) n;
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-27', 'Chat 27', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b4'), 'staff');
insert into public.player_profiles (id, organization_id, user_id, display_name)
  select pg_temp.id('c' || n), pg_temp.id('a0'), pg_temp.id('b' || n), (array['Sami', 'Tanvir', 'Nadia', 'Tee', 'Dina', 'Esha', 'Xavier'])[n]
  from generate_series(1, 7) n where n <> 4;
insert into public.chat_messages (id, organization_id, author_user_id, author_profile_id, author_kind, author_name, body, created_at) values
  (pg_temp.id('d1'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', 'buy cheap boots', now() - interval '1 hour'),
  (pg_temp.id('d2'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', 'second one', now() - interval '1 hour');
-- E has already reported 20 of X's messages today.
insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, body, created_at)
  select pg_temp.id('a0'), pg_temp.id('b7'), pg_temp.id('c7'), 'player', 'Xavier', 'x ' || n, now() - interval '2 hours'
  from generate_series(1, 20) n;
insert into public.chat_reports (organization_id, message_id, reporter_profile_id, reason, author_name_copy)
  select pg_temp.id('a0'), m.id, pg_temp.id('c6'), 'spam', 'Xavier' from public.chat_messages m where m.author_user_id = pg_temp.id('b7');
-- A's card with a note, and its room message.
insert into public.sections (id, organization_id, name, kind, slug) values (pg_temp.id('a1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values (pg_temp.id('a2'), pg_temp.id('a0'), pg_temp.id('a1'), 'Pitch 1', 'pitch', 14);
insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha)
values (pg_temp.id('aa'), pg_temp.id('a0'), pg_temp.id('a2'), pg_temp.id('c1'), tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour'), 0);
insert into public.chat_cards (id, organization_id, kind, resource_booking_id, poster_user_id, poster_profile_id, poster_name,
  section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed, note)
values (pg_temp.id('ab'), pg_temp.id('a0'), 'booking', pg_temp.id('aa'), pg_temp.id('b1'), pg_temp.id('c1'), 'Sami',
  pg_temp.id('a1'), 'Turf', 'turf', '#43a66b', 'Pitch 1', now() + interval '1 day', now() + interval '1 day 1 hour', 3, 'split');
insert into public.chat_messages (id, organization_id, author_user_id, author_profile_id, author_kind, author_name, card_id, created_at)
values (pg_temp.id('d4'), pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', pg_temp.id('ab'), now() - interval '1 hour');

-- Reporting
select is(pg_temp.report('b1', 'd1'), 'own_message', 'you cannot report your own message');
select is(pg_temp.report('b2', 'd1'), 'reported', 'a player reports a message');
select is(pg_temp.report('b2', 'd1'), 'already_reported', 'once');
select row_eq($$ select body_copy, author_name_copy, status::text from public.chat_reports
                where message_id = '00000000-0000-4000-8000-0000000027d1' and reporter_profile_id = '00000000-0000-4000-8000-0000000027c2' $$,
  row('buy cheap boots'::text, 'Sami'::text, 'open'::text), 'the report keeps a copy of what was said');
select is(pg_temp.report('b6', 'd2'), 'too_many_reports', 'at most 20 reports a day');
select is(pg_temp.report('b4', 'd2'), 'no_profile', 'the team removes rather than reports');
select is(pg_temp.report('b3', 'd1'), 'reported', 'a second player reports it');
select is((select state::text from public.chat_messages where id = pg_temp.id('d1')), 'visible', 'two reports leave it up');
select is(pg_temp.report('b5', 'd1'), 'reported', 'a third player reports it');
select row_eq($$ select state::text, body from public.chat_messages where id = '00000000-0000-4000-8000-0000000027d1' $$,
  row('hidden_by_reports'::text, null::text), 'three reports hide it at once');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000027b2","role":"authenticated"}';
select is((select body from public.chat_messages where id = pg_temp.id('d1')), null, 'and its text cannot be read through the API');
reset role;

-- Resolving
select is(public.resolve_chat_reports(pg_temp.id('d1'), pg_temp.id('b2'), 'dismiss'), 'not_allowed', 'only the team resolves reports');
select is(public.resolve_chat_reports(pg_temp.id('d1'), pg_temp.id('b4'), 'dismiss'), 'resolved', 'the team dismisses them');
select row_eq($$ select state::text, body from public.chat_messages where id = '00000000-0000-4000-8000-0000000027d1' $$,
  row('visible'::text, 'buy cheap boots'::text), 'and the hidden message comes back');
select is((select count(*)::int from public.chat_reports where message_id = pg_temp.id('d1') and status = 'dismissed'), 3, 'every report on it is dismissed');
select is(public.resolve_chat_reports(pg_temp.id('d1'), pg_temp.id('b4'), 'dismiss'), 'nothing_open', 'nothing is left to resolve');
select is(pg_temp.report('b2', 'd2'), 'reported', 'a report on another message');
select is(public.remove_chat_message(pg_temp.id('d2'), pg_temp.id('b1'), false), 'removed', 'which its author then removes');
select is((select body_copy from public.chat_reports where message_id = pg_temp.id('d2')), 'second one', 'the report still has the copy');
select is(public.resolve_chat_reports(pg_temp.id('d2'), pg_temp.id('b4'), 'remove'), 'resolved', 'the team removes it');
select row_eq($$ select m.state::text, r.status::text from public.chat_messages m join public.chat_reports r on r.message_id = m.id
                where m.id = '00000000-0000-4000-8000-0000000027d2' $$,
  row('removed_by_venue'::text, 'removed'::text), 'removed by the venue, and the report is closed');
select is(pg_temp.report('b3', 'd4'), 'reported', 'a card is reported through its message');
select is((select body_copy from public.chat_reports where message_id = pg_temp.id('d4')), 'Pitch 1, split', 'with the card''s title and note copied');
select is((select public.resolve_chat_reports(pg_temp.id('d4'), pg_temp.id('b4'), 'remove') || ' ' || (select status::text from public.chat_cards where id = pg_temp.id('ab')))::text,
  'resolved open', 'removing a reported card...');
select is((select status::text from public.chat_cards where id = pg_temp.id('ab')), 'closed', '...closes the card');

-- Mutes
select is(public.mute_chat_player(pg_temp.id('a0'), pg_temp.id('b2'), pg_temp.id('c1'), 1), 'not_allowed', 'only the team mutes');
select is(public.mute_chat_player(pg_temp.id('a0'), pg_temp.id('b4'), pg_temp.id('c1'), 1), 'muted', 'the team mutes a player for a day');
select ok((select until between now() + interval '23 hours 59 minutes' and now() + interval '1 day 1 minute' from public.chat_mutes where profile_id = pg_temp.id('c1')),
  'until this time tomorrow');
select is((select status from public.post_chat_message(pg_temp.id('a0'), pg_temp.id('b1'), 'let me talk')), 'muted', 'a muted player cannot post');
select is(public.mute_chat_player(pg_temp.id('a0'), pg_temp.id('b4'), pg_temp.id('c1'), null), 'muted', 'or until unmuted');
select is((select until from public.chat_mutes where profile_id = pg_temp.id('c1')), null, 'which has no end');
select is(public.mute_chat_player(pg_temp.id('a0'), pg_temp.id('b4'), pg_temp.id('c1'), 3), 'invalid', 'a mute is 1 day, 7 days or until unmuted');
select is(public.unmute_chat_player(pg_temp.id('a0'), pg_temp.id('b4'), pg_temp.id('c1')), 'unmuted', 'the team unmutes');
select is((select status from public.post_chat_message(pg_temp.id('a0'), pg_temp.id('b1'), 'thanks')), 'posted', 'and the player can post again');

-- The venue's words
select is(pg_temp.word('b4', 'gadha', true), 'added', 'the team adds a word');
select is(pg_temp.word('b4', 'gadha', true), 'exists', 'once');
select is(pg_temp.word('b4', 'gadha', false) || ' ' || pg_temp.word('b4', 'gadha', false), 'removed not_found', 'and removes it');
insert into public.chat_blocked_words (organization_id, word) select pg_temp.id('a0'), 'word' || n from generate_series(1, 500) n;
select is(pg_temp.word('b4', 'one more', true) || ' ' || pg_temp.word('b4', 'x', true) || ' ' || pg_temp.word('b2', 'rude', true),
  'too_many_words invalid not_allowed', 'the list holds 500 words of 2–40 characters, and only the team edits it');

select * from finish();
rollback;
