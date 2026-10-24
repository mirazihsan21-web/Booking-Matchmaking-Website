-- Notifications (the outbox): a player reads only their own and may only mark them read.
-- Org N (…8a0) with players P (…8b1) and Q (…8b2) and staff member S (…8b3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000008b1', 'notif-p@test.local'),
  ('00000000-0000-4000-8000-0000000008b2', 'notif-q@test.local'),
  ('00000000-0000-4000-8000-0000000008b3', 'notif-s@test.local');
insert into public.organizations (id, slug, name, business_type, status)
values ('00000000-0000-4000-8000-0000000008a0', 'notif-org-n', 'Org N', 'turf', 'live');
insert into public.organization_members (organization_id, user_id, role)
values ('00000000-0000-4000-8000-0000000008a0', '00000000-0000-4000-8000-0000000008b3', 'staff');
insert into public.player_profiles (id, organization_id, user_id, display_name) values
  ('00000000-0000-4000-8000-0000000008c1', '00000000-0000-4000-8000-0000000008a0', '00000000-0000-4000-8000-0000000008b1', 'P'),
  ('00000000-0000-4000-8000-0000000008c2', '00000000-0000-4000-8000-0000000008a0', '00000000-0000-4000-8000-0000000008b2', 'Q');
insert into public.notifications (id, organization_id, profile_id, kind, payload, link)
values ('00000000-0000-4000-8000-0000000008d1', '00000000-0000-4000-8000-0000000008a0', '00000000-0000-4000-8000-0000000008c1',
        'booking_confirmed', '{"resource_name":"Pitch 1"}', '/me/bookings');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000008b1","role":"authenticated"}';
select is((select count(*)::int from public.notifications where organization_id = '00000000-0000-4000-8000-0000000008a0'), 1,
  'a player sees their own notification');
select throws_ok(
  $$ insert into public.notifications (organization_id, profile_id, kind, link)
     values ('00000000-0000-4000-8000-0000000008a0', '00000000-0000-4000-8000-0000000008c1', 'booking_confirmed', '/x') $$,
  '42501', null, 'players cannot create notifications'
);
select lives_ok(
  $$ update public.notifications set read_at = now() where id = '00000000-0000-4000-8000-0000000008d1' $$,
  'a player can mark their notification read'
);
select throws_ok(
  $$ update public.notifications set kind = 'offer' where id = '00000000-0000-4000-8000-0000000008d1' $$,
  '42501', null, 'a player cannot change anything else'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000008b2","role":"authenticated"}';
select is((select count(*)::int from public.notifications where organization_id = '00000000-0000-4000-8000-0000000008a0'), 0,
  'another player at the same venue sees nothing');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000008b3","role":"authenticated"}';
select is((select count(*)::int from public.notifications where organization_id = '00000000-0000-4000-8000-0000000008a0'), 0,
  'venue staff do not read players'' notifications');
reset role;

select ok(
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'),
  'notifications are published to Realtime'
);

select * from finish();
rollback;
