-- Offers, cancellations and closing (Stage B2): create_offer / issue_offer_token / accept_offer /
-- decline_offer / expire_offers / cancel_booking / close_started_sessions / cancel_open_play_session.
-- Org O (…13a0, offers last 900 s) with Pitch 1 and 5-a-side; players pg_temp.p(1…21). Sessions:
-- T1 matched two days ahead (P1–P10 seated, P11/P12/P18/P19/P20 waiting); T2 matched, starting in
-- 5 minutes (seat 10 free, P13 waiting); T3 closed (P1 seated, P14 waiting); T4 matched, started
-- 5 minutes ago (P15 waiting, P21 holding an offer); T5 open, started (P16 and P17 asked).
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

create function pg_temp.p(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000001301' || lpad(to_hex(n), 2, '0'))::uuid;
$$;
create function pg_temp.s(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000013f' || n)::uuid;
$$;
create function pg_temp.g(n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000013e' || n)::uuid;
$$;
create function pg_temp.entry(sn int, pn int) returns uuid language sql as $$
  select id from public.waitlist_entries where session_id = pg_temp.s(sn) and profile_id = pg_temp.p(pn);
$$;
create function pg_temp.booking(sn int, pn int) returns uuid language sql as $$
  select id from public.bookings where session_id = pg_temp.s(sn) and profile_id = pg_temp.p(pn) and status <> 'cancelled';
$$;

insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000001300' || lpad(to_hex(n), 2, '0'))::uuid, 'of-' || n || '@test.local'
from generate_series(1, 21) n;
insert into public.organizations (id, slug, name, business_type, status)
values ('00000000-0000-4000-8000-0000000013a0', 'of-org-o', 'Org O', 'turf', 'live');
insert into public.branches (id, organization_id, name, offer_ttl_seconds)
values ('00000000-0000-4000-8000-0000000013b0', '00000000-0000-4000-8000-0000000013a0', 'Main', 900);
insert into public.resources (id, organization_id, branch_id, name, kind, capacity)
values ('00000000-0000-4000-8000-0000000013c1', '00000000-0000-4000-8000-0000000013a0', '00000000-0000-4000-8000-0000000013b0', 'Pitch 1', 'pitch', 14);
insert into public.activities (id, organization_id, name, min_players, max_players, duration_min, team_mode, team_size)
values ('00000000-0000-4000-8000-0000000013d1', '00000000-0000-4000-8000-0000000013a0', '5-a-side', 10, 10, 60, 'two_teams', 5);
insert into public.player_profiles (id, organization_id, user_id, display_name, skill)
select pg_temp.p(n), '00000000-0000-4000-8000-0000000013a0',
       ('00000000-0000-4000-8000-0000001300' || lpad(to_hex(n), 2, '0'))::uuid, 'P' || n, 3
from generate_series(1, 21) n;

insert into public.open_play_sessions (id, organization_id, branch_id, activity_id, starts_at, ends_at, seat_price_poisha, status)
select pg_temp.s(n), '00000000-0000-4000-8000-0000000013a0', '00000000-0000-4000-8000-0000000013b0',
       '00000000-0000-4000-8000-0000000013d1', now() + starts, now() + starts + interval '1 hour', 30000, st::public.session_status
from (values (1, interval '2 days', 'matched'), (2, interval '5 minutes', 'matched'), (3, interval '2 days', 'closed'),
             (4, interval '-5 minutes', 'matched'), (5, interval '-5 minutes', 'open')) as v(n, starts, st);
insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity)
select pg_temp.g(n), '00000000-0000-4000-8000-0000000013a0', pg_temp.s(n), '00000000-0000-4000-8000-0000000013c1',
       '00000000-0000-4000-8000-0000000013d1', 10
from generate_series(1, 4) n;
insert into public.bookings (organization_id, session_id, group_id, profile_id, seat_no, price_poisha, team)
select '00000000-0000-4000-8000-0000000013a0', pg_temp.s(sn), pg_temp.g(sn), pg_temp.p(n), n, 30000, case when n <= 5 then 1 else 2 end
from (values (1, 10), (2, 9), (3, 1)) as v(sn, last), generate_series(1, last) n;
insert into public.waitlist_entries (organization_id, session_id, profile_id, queue_position, status)
select '00000000-0000-4000-8000-0000000013a0', pg_temp.s(sn), pg_temp.p(pn), pos, st::public.waitlist_status
from (values (1, 11, 1, 'waiting'), (1, 12, 2, 'waiting'), (1, 18, 3, 'waiting'), (1, 19, 4, 'waiting'), (1, 20, 5, 'waiting'),
             (2, 13, 1, 'waiting'), (3, 14, 1, 'waiting'), (4, 15, 1, 'waiting'), (4, 21, 2, 'offered')) as v(sn, pn, pos, st);
insert into public.seat_requests (organization_id, session_id, profile_id)
select '00000000-0000-4000-8000-0000000013a0', pg_temp.s(5), pg_temp.p(n) from generate_series(16, 17) n;

create temp table o (label text primary key, id uuid);

-- ── cancel_booking ──────────────────────────────────────────────────────────
select is((select seat_no from public.cancel_booking(pg_temp.booking(1, 6), true)), 6::smallint, 'a venue cancel frees the seat');
select is((select (payload->>'by_venue') || ' ' || link from public.notifications where kind = 'seat_cancelled' and profile_id = pg_temp.p(6)),
  'true /me/bookings', 'and tells the player the venue cancelled it');

-- ── create_offer / issue_offer_token / accept_offer ─────────────────────────
insert into o select 'a', public.create_offer(pg_temp.g(1), 6::smallint, pg_temp.entry(1, 11));
select ok((select token_hash ~ '^[0-9a-f]{64}$' from public.seat_offers where id = (select id from o where label = 'a')),
  'an offer stores only a hash');
select is((select link || ' ' || (payload->>'offer_id') || ' ' || (payload->>'team') from public.notifications
           where kind = 'offer' and profile_id = pg_temp.p(11)),
  '/me/offers/' || (select id from o where label = 'a') || ' ' || (select id from o where label = 'a') || ' 2',
  'the offer notification links to the in-app offer and names the seat''s team');
select ok((select expires_at = now() + interval '900 seconds' from public.seat_offers where id = (select id from o where label = 'a')),
  'an offer lasts the branch''s offer time');
select is(public.issue_offer_token((select id from o where label = 'a'), repeat('ab', 32)), 'issued', 'the email step sets the token');
select is((select token_hash from public.seat_offers where id = (select id from o where label = 'a')), repeat('ab', 32),
  'and only its hash is kept');
select is(public.accept_offer((select id from o where label = 'a')), 'accepted', 'the player takes the seat');
select is((select seat_no || ' ' || team || ' ' || source from public.bookings where id = pg_temp.booking(1, 11)), '6 2 waitlist',
  'in the vacated seat, on its team');
select is((select count(*)::int from public.notifications where kind = 'seat_confirmed' and profile_id = pg_temp.p(11) and payload->>'via' = 'offer'), 1,
  'and is told');

-- ── decline_offer ───────────────────────────────────────────────────────────
do $$ begin perform public.cancel_booking(pg_temp.booking(1, 7)); end $$;
select is((select payload->>'by_venue' from public.notifications where kind = 'seat_cancelled' and profile_id = pg_temp.p(7)), 'false',
  'a player''s own cancel is not the venue''s');
insert into o select 'b', public.create_offer(pg_temp.g(1), 7::smallint, pg_temp.entry(1, 12));
do $$ begin perform public.decline_offer((select id from o where label = 'b')); end $$;
select is(public.issue_offer_token((select id from o where label = 'b'), repeat('cd', 32)), 'not_pending', 'a declined offer gets no token');
select isnt((select token_hash from public.seat_offers where id = (select id from o where label = 'b')), repeat('cd', 32),
  'and keeps its old hash');

-- ── expire_offers ───────────────────────────────────────────────────────────
do $$ begin perform public.cancel_booking(pg_temp.booking(1, 8)); end $$;
insert into o select 'c', public.create_offer(pg_temp.g(1), 8::smallint, pg_temp.entry(1, 18));
update public.seat_offers set expires_at = now() - interval '1 second' where id = (select id from o where label = 'c');
select is((select seat_no from public.expire_offers() where offer_id = (select id from o where label = 'c')), 8::smallint,
  'a past-due offer is expired and its seat returned');
select is((select link from public.notifications where kind = 'offer_expired' and profile_id = pg_temp.p(18)), '/sessions/' || pg_temp.s(1),
  'and its player is told');

-- ── cancel_open_play_session on a matched session ──────────────────────────
do $$ begin perform public.cancel_booking(pg_temp.booking(1, 9)); end $$;
insert into o select 'd', public.create_offer(pg_temp.g(1), 9::smallint, pg_temp.entry(1, 19));
select is(public.cancel_open_play_session(pg_temp.s(1)), 'cancelled', 'a matched session can be cancelled');
select is((select count(*)::int from public.bookings where session_id = pg_temp.s(1) and status = 'confirmed'), 0, 'every seat is cancelled');
select is((select status::text from public.seat_offers where id = (select id from o where label = 'd')), 'expired', 'the live offer is withdrawn');
select is((select status::text from public.waitlist_entries where id = pg_temp.entry(1, 20)), 'withdrawn', 'and so is the waitlist');
select is((select count(*) || '/' || count(distinct profile_id) from public.notifications
           where kind = 'session_cancelled' and payload->>'session_id' = pg_temp.s(1)::text),
  '9/9', 'everyone seated, waiting or offered is told once');
select is(public.accept_offer((select id from o where label = 'd')), 'closed', 'an offer on a cancelled session answers closed');
select is(pg_temp.booking(1, 19), null, 'and books nothing');
select is(public.decline_offer((select id from o where label = 'd')), 'closed', 'declining it answers closed too');

-- ── closed sessions ─────────────────────────────────────────────────────────
select throws_ok(format($$ select public.create_offer(%L, 2::smallint, %L) $$, pg_temp.g(3), pg_temp.entry(3, 14)),
  'P0001', 'session_closed', 'no offers on a closed session');
select is((select count(*)::int from public.cancel_booking(pg_temp.booking(3, 1), true)), 0, 'a seat in a closed session cannot be cancelled');
select is((select status::text from public.bookings where session_id = pg_temp.s(3) and profile_id = pg_temp.p(1)), 'confirmed', 'and stays booked');

-- ── an offer never outlasts the start ──────────────────────────────────────
insert into o select 'e', public.create_offer(pg_temp.g(2), 10::smallint, pg_temp.entry(2, 13));
select ok((select x.expires_at = s.starts_at from public.seat_offers x join public.open_play_sessions s on s.id = pg_temp.s(2)
           where x.id = (select id from o where label = 'e')),
  'an offer made 5 minutes before the start ends at the start');

-- ── close_started_sessions ──────────────────────────────────────────────────
insert into public.seat_offers (organization_id, group_id, seat_no, waitlist_entry_id, expires_at, token_hash)
values ('00000000-0000-4000-8000-0000000013a0', pg_temp.g(4), 1, pg_temp.entry(4, 21), now() - interval '5 minutes', repeat('ef', 32));
select is_empty(format($$ select 1 from public.expire_offers() where group_id = %L $$, pg_temp.g(4)),
  'an offer on a started session is left for closing');
create temp table closed as select id from public.close_started_sessions() as t(id);
select ok(pg_temp.s(4) in (select id from closed) and pg_temp.s(5) in (select id from closed)
          and (select bool_and(status = 'closed') from public.open_play_sessions where id in (pg_temp.s(4), pg_temp.s(5))),
  'started sessions are closed');
select is((select string_agg(p.display_name || ':' || (n.payload->>'reason'), ',' order by p.display_name)
           from public.notifications n join public.player_profiles p on p.id = n.profile_id
           where n.kind = 'no_seat' and n.payload->>'session_id' = pg_temp.s(4)::text),
  'P15:waitlist,P21:waitlist', 'waiting and offered players hear there was no seat');
select is((select string_agg(p.display_name || ':' || (n.payload->>'reason'), ',' order by p.display_name)
           from public.notifications n join public.player_profiles p on p.id = n.profile_id
           where n.kind = 'no_seat' and n.payload->>'session_id' = pg_temp.s(5)::text),
  'P16:not_enough_players,P17:not_enough_players', 'requesters of a session that never matched hear why');
select is((select status::text from public.seat_offers where group_id = pg_temp.g(4)), 'expired', 'the started session''s offer is expired');

-- ── grants ──────────────────────────────────────────────────────────────────
select is_empty(
  $$ select f from unnest(array['public.issue_offer_token(uuid, text)', 'public.close_started_sessions()',
                                'public.cancel_booking(uuid, boolean)', 'public.create_offer(uuid, smallint, uuid)']) as f
     where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
        or not has_function_privilege('service_role', f, 'execute') $$,
  'offer and session functions are service_role only'
);

select * from finish();
rollback;
