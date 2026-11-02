-- Players chat (stage C1) — fixes from the final review: asking, withdrawing and asking again tells the poster once;
-- a closed card whose booking is cancelled still tells the accepted players; a card hidden by reports loses its note
-- through the API and takes no requests (dismiss brings the note back); an accepted player can still drop out of
-- (and the poster can still take someone off) a closed card before the game. Org …29a0.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create function pg_temp.id(suffix text) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000029' || suffix)::uuid $$;
create function pg_temp.card(card text, booking text, hours int, status text, note text) returns void language sql as $$
  insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha)
  values (pg_temp.id(booking), pg_temp.id('a0'), pg_temp.id('a2'), pg_temp.id('c1'),
          tstzrange(now() + hours * interval '1 hour', now() + (hours + 1) * interval '1 hour'), 0);
  insert into public.chat_cards (id, organization_id, kind, resource_booking_id, poster_user_id, poster_profile_id, poster_name,
    section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed, status, note)
  values (pg_temp.id(card), pg_temp.id('a0'), 'booking', pg_temp.id(booking), pg_temp.id('b1'), pg_temp.id('c1'), 'Sami',
    pg_temp.id('a1'), 'Turf', 'turf', '#43a66b', 'Pitch 1', now() + hours * interval '1 hour', now() + (hours + 1) * interval '1 hour', 3,
    status::public.chat_card_status, note);
  insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, card_id, created_at)
  values (pg_temp.id('a0'), pg_temp.id('b1'), pg_temp.id('c1'), 'player', 'Sami', pg_temp.id(card), now() - interval '1 hour');
$$;
create function pg_temp.card_message(card text) returns uuid language sql as $$ select id from public.chat_messages where card_id = pg_temp.id(card) $$;

-- A b1/c1 Sami (posts) · B b2/c2 Tanvir · C b3/c3 Nadia · E b5/c5 Esha · T b4 staff
insert into auth.users (id, email) select pg_temp.id('b' || n), 'u' || n || '-29@test.local' from generate_series(1, 5) n;
insert into public.organizations (id, slug, name, business_type, status) values (pg_temp.id('a0'), 'chat-29', 'Chat 29', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.id('a0'), pg_temp.id('b4'), 'staff');
insert into public.player_profiles (id, organization_id, user_id, display_name)
  select pg_temp.id('c' || n), pg_temp.id('a0'), pg_temp.id('b' || n), (array['Sami', 'Tanvir', 'Nadia', 'Tee', 'Esha'])[n]
  from generate_series(1, 5) n where n <> 4;
insert into public.sections (id, organization_id, name, kind, slug) values (pg_temp.id('a1'), pg_temp.id('a0'), 'Turf', 'turf', 'turf');
insert into public.resources (id, organization_id, section_id, name, kind, capacity) values (pg_temp.id('a2'), pg_temp.id('a0'), pg_temp.id('a1'), 'Pitch 1', 'pitch', 14);
select pg_temp.card('f1', 'e1', 24, 'open', 'secret note');
select pg_temp.card('f2', 'e2', 48, 'closed', null);
select pg_temp.card('f3', 'e3', 72, 'closed', null);
insert into public.chat_join_requests (organization_id, card_id, profile_id, status) values
  (pg_temp.id('a0'), pg_temp.id('f2'), pg_temp.id('c2'), 'accepted'),
  (pg_temp.id('a0'), pg_temp.id('f3'), pg_temp.id('c2'), 'accepted'),
  (pg_temp.id('a0'), pg_temp.id('f3'), pg_temp.id('c3'), 'accepted');
update public.chat_cards set spots_taken = 1 where id = pg_temp.id('f2');
update public.chat_cards set spots_taken = 2 where id = pg_temp.id('f3');

-- Asking, withdrawing and asking again tells the poster once.
select is(public.request_to_join(pg_temp.id('f1'), pg_temp.id('b2')), 'requested', 'a player asks');
select is(public.withdraw_join_request(pg_temp.id('f1'), pg_temp.id('b2')), 'withdrawn', 'withdraws');
select is(public.request_to_join(pg_temp.id('f1'), pg_temp.id('b2')), 'requested', 'and asks again');
select is((select count(*)::int from public.notifications where kind = 'chat_join_request' and profile_id = pg_temp.id('c1')), 1,
  'the poster hears it once, not every time');

-- A closed card whose booking is then cancelled.
update public.resource_bookings set status = 'cancelled' where id = pg_temp.id('e2');
create temp table closed as select * from public.close_due_chat_cards();
select is((select outcome from closed where card_id = pg_temp.id('f2')), 'cancelled', 'a closed card is picked up when its booking is cancelled');
select is((select status::text from public.chat_cards where id = pg_temp.id('f2')), 'cancelled', 'and says so');
select is((select count(*)::int from public.notifications where kind = 'chat_game_cancelled' and profile_id = pg_temp.id('c2')
           and payload ->> 'card_id' = pg_temp.id('f2')::text), 1, 'and the accepted player is told');

-- A card hidden by reports.
select is(public.report_chat_message(pg_temp.card_message('f1'), pg_temp.id(u), 'spam', null), 'reported', 'reported by ' || u)
from unnest(array['b2', 'b3', 'b5']) u;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000029b3","role":"authenticated"}';
select is((select note from public.chat_cards where id = pg_temp.id('f1')), null, 'a hidden card''s note cannot be read through the API');
reset role;
select is(public.request_to_join(pg_temp.id('f1'), pg_temp.id('b5')), 'not_open', 'and the card takes no requests');
select is((select body_copy from public.chat_reports where message_id = pg_temp.card_message('f1') and reporter_profile_id = pg_temp.id('c5')),
  'Pitch 1, secret note', 'the reports keep the note');
select is(public.resolve_chat_reports(pg_temp.card_message('f1'), pg_temp.id('b4'), 'dismiss'), 'resolved', 'the team dismisses the reports');
select row_eq(
  $$ select c.note, m.state::text, m.body from public.chat_cards c join public.chat_messages m on m.card_id = c.id
     where c.id = '00000000-0000-4000-8000-0000000029f1' $$,
  row('secret note'::text, 'visible'::text, null::text), 'the note comes back on the card (the card''s message still has no text)');

-- Dropping out of a closed card before the game.
select is(public.leave_card(pg_temp.id('f3'), pg_temp.id('b2')), 'left', 'an accepted player can still drop out after the poster closed the card');
select is((select count(*)::int from public.notifications where kind = 'chat_join_left' and profile_id = pg_temp.id('c1')
           and payload ->> 'card_id' = pg_temp.id('f3')::text), 1, 'and the poster is told');
select is(public.remove_from_card(pg_temp.id('f3'), pg_temp.id('b1'), pg_temp.id('c3')), 'removed', 'the poster can still take someone off');
select row_eq($$ select status::text, spots_taken::int from public.chat_cards where id = '00000000-0000-4000-8000-0000000029f3' $$,
  row('closed'::text, 0), 'the card stays closed');

select * from finish();
rollback;
