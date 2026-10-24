-- The email outbox: claiming pending notifications for the tick, and recording how sending went.
-- Org E (…9a0) with player P (…9b1). Claims are scoped by checking the fixture rows only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000009b1', 'outbox-p@test.local');
insert into public.organizations (id, slug, name, business_type, status)
values ('00000000-0000-4000-8000-0000000009a0', 'outbox-org-e', 'Org E', 'turf', 'live');
insert into public.player_profiles (id, organization_id, user_id, display_name)
values ('00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-0000000009a0', '00000000-0000-4000-8000-0000000009b1', 'P');
insert into public.notifications (id, organization_id, profile_id, kind, link) values
  ('00000000-0000-4000-8000-0000000009d1', '00000000-0000-4000-8000-0000000009a0', '00000000-0000-4000-8000-0000000009c1', 'booking_confirmed', '/me/bookings');

-- Claiming
create temp table first_claim as select * from public.claim_pending_emails(1000);
select is(
  (select email_status::text || '/' || email_attempts from first_claim where id = '00000000-0000-4000-8000-0000000009d1'),
  'sending/1', 'a claim takes a pending row, marks it sending and counts the attempt'
);
select is(
  (select count(*)::int from public.claim_pending_emails(1000) where id = '00000000-0000-4000-8000-0000000009d1'),
  0, 'a claimed row is not claimed again'
);
update public.notifications set email_claimed_at = now() - interval '6 minutes' where id = '00000000-0000-4000-8000-0000000009d1';
select is(
  (select email_attempts::int from public.claim_pending_emails(1000) where id = '00000000-0000-4000-8000-0000000009d1'),
  2, 'a claim stuck for over 5 minutes is taken again'
);

-- Finishing
update public.notifications set email_attempts = 1 where id = '00000000-0000-4000-8000-0000000009d1';
select is(public.finish_email('00000000-0000-4000-8000-0000000009d1', 'failed'), 'pending', 'a first failure is retried');
update public.notifications set email_attempts = 3 where id = '00000000-0000-4000-8000-0000000009d1';
select is(public.finish_email('00000000-0000-4000-8000-0000000009d1', 'failed'), 'failed', 'the third failure is final');
select is(public.finish_email('00000000-0000-4000-8000-0000000009d1', 'sent'), 'sent', 'a sent email is recorded');
select isnt((select emailed_at from public.notifications where id = '00000000-0000-4000-8000-0000000009d1'), null, 'with the time it went');
select throws_ok(
  $$ select public.finish_email('00000000-0000-4000-8000-0000000009d1', 'bounced') $$,
  '22023', null, 'an unknown outcome is refused'
);

-- Only the server's job runner may call these
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000009b1","role":"authenticated"}';
select throws_ok($$ select * from public.claim_pending_emails(1) $$, '42501', null, 'players cannot claim emails');
select throws_ok($$ select public.finish_email('00000000-0000-4000-8000-0000000009d1', 'sent') $$, '42501', null, 'players cannot finish emails');
reset role;

select * from finish();
rollback;
