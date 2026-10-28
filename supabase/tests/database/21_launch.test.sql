-- Before the live job tick starts: games whose start has passed but are still open are closed quietly,
-- with no "no seat" notifications (they would reach players weeks late). Org (…21a0), player P (…21d1).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000021d1', 'launch21@test.local');
insert into public.organizations (id, slug, name, status) values ('00000000-0000-4000-8000-0000000021a0', 'launch-org-21', 'Launch Org', 'live');
create temp table s as select public.add_section('00000000-0000-4000-8000-0000000021a0', 'turf', 'Turf') as id;
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  ('00000000-0000-4000-8000-0000000021e1', '00000000-0000-4000-8000-0000000021a0', '00000000-0000-4000-8000-0000000021d1', 'P');
-- Game A started yesterday and is still open, with a request and a waiting player; game B is in two days.
insert into public.open_play_sessions (id, organization_id, section_id, starts_at, ends_at, seat_price_poisha, status) values
  ('00000000-0000-4000-8000-0000000021f1', '00000000-0000-4000-8000-0000000021a0', (select id from s), now() - interval '1 day', now() - interval '23 hours', 30000, 'open'),
  ('00000000-0000-4000-8000-0000000021f2', '00000000-0000-4000-8000-0000000021a0', (select id from s), now() + interval '2 days', now() + interval '49 hours', 30000, 'open');
insert into public.seat_requests (organization_id, session_id, profile_id) values
  ('00000000-0000-4000-8000-0000000021a0', '00000000-0000-4000-8000-0000000021f1', '00000000-0000-4000-8000-0000000021e1');
insert into public.waitlist_entries (id, organization_id, session_id, profile_id, queue_position) values
  ('00000000-0000-4000-8000-0000000021b1', '00000000-0000-4000-8000-0000000021a0', '00000000-0000-4000-8000-0000000021f1', '00000000-0000-4000-8000-0000000021e1', 1);

create temp table closed as select private.close_past_sessions_quietly() as n;
select is((select n from closed), 1, 'one past game closed');
select is((select status::text from public.open_play_sessions where id = '00000000-0000-4000-8000-0000000021f1'), 'closed', 'the past game is closed');
select is((select status::text from public.open_play_sessions where id = '00000000-0000-4000-8000-0000000021f2'), 'open', 'a future game is untouched');
select is((select status::text from public.waitlist_entries where id = '00000000-0000-4000-8000-0000000021b1'), 'expired', 'its waitlist place has expired');
select is((select count(*) from public.notifications where organization_id = '00000000-0000-4000-8000-0000000021a0'), 0::bigint, 'and nobody is told');

select * from finish();
rollback;
