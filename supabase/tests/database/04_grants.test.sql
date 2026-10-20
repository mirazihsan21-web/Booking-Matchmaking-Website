-- Explicit table privileges (the Data API no longer exposes new tables by default).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select is_empty(
  $$ select t from unnest(array[
       'organization_members', 'organization_invites', 'platform_admins', 'resource_reservations',
       'player_profiles', 'profile_activities', 'availability', 'seat_requests', 'groups', 'bookings',
       'waitlist_entries', 'seat_offers', 'notifications', 'events', 'resource_bookings'
     ]) as t
     where has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') $$,
  'anon has no privileges on non-public tables'
);
select ok(has_column_privilege('anon', 'public.organizations', 'slug', 'SELECT'), 'anon can read an organization''s public columns');
select ok(not has_column_privilege('anon', 'public.organizations', 'created_by', 'SELECT'), 'anon cannot read who created an organization');
select ok(not has_table_privilege('anon', 'public.resources', 'INSERT,UPDATE,DELETE'), 'anon cannot write the public catalogue');

select table_privs_are('public', t, 'authenticated', array['SELECT'], format('authenticated can only read %s', t))
from unnest(array['groups', 'bookings', 'waitlist_entries', 'seat_offers', 'notifications', 'events', 'resource_bookings']) as t;

select ok(has_table_privilege('service_role', 'public.bookings', 'INSERT,UPDATE,DELETE'), 'service_role can write booking-flow tables');
select ok(has_column_privilege('authenticated', 'public.organizations', 'max_upcoming_bookings', 'UPDATE'), 'owners can change booking settings (RLS limits it to owners)');
select ok(not has_column_privilege('authenticated', 'public.organizations', 'status', 'UPDATE'), 'nobody can publish or suspend through the API');

select * from finish();
rollback;
