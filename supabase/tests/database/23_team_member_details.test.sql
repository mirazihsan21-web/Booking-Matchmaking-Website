-- Team members have their own name and mobile (team and player accounts): a new member is named from their
-- Google name (full_name, then name), else their email before "@", cut to 60 characters; a name given on
-- insert is kept; the mobile uses the players' +E.164 form; the helpers aren't callable by signed-in users.
-- Org (…23a0); users …23d1–…23d7.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-4000-8000-0000000023d' || n)::uuid $$;
create function pg_temp.name_of(n int) returns text language sql as $$
  select display_name from public.organization_members where user_id = pg_temp.u(n)
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.u(1), 'miraz23@test.local', '{"full_name": "Miraz Ihsan", "name": "Miraz"}'),
  (pg_temp.u(2), 'only23@test.local', '{"name": "Only Name"}'),
  (pg_temp.u(3), 'desk.person@test.local', '{}'),
  (pg_temp.u(4), 'blank23@test.local', '{"full_name": "   "}'),
  (pg_temp.u(5), 'long23@test.local', json_build_object('full_name', 'A' || repeat('b', 69))::jsonb),
  (pg_temp.u(6), 'chosen23@test.local', '{"full_name": "Google Name"}');
insert into public.organizations (id, slug, name, status) values ('00000000-0000-4000-8000-0000000023a0', 'team-details-23', 'Team Org', 'live');
insert into public.organization_members (organization_id, user_id, role)
  select '00000000-0000-4000-8000-0000000023a0', pg_temp.u(n), 'staff' from generate_series(1, 5) n;
insert into public.organization_members (organization_id, user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000023a0', pg_temp.u(6), 'owner', 'Chosen');

select has_column('public', 'organization_members', 'display_name', 'members have a name');
select col_not_null('public', 'organization_members', 'display_name', 'every member has one');
select has_column('public', 'organization_members', 'phone', 'and may have a mobile');

select is(pg_temp.name_of(1), 'Miraz Ihsan', 'a new member is named from their Google full name');
select is(pg_temp.name_of(2), 'Only Name', 'else from their Google name');
select is(pg_temp.name_of(3), 'desk.person', 'else from their email before "@"');
select is(pg_temp.name_of(4), 'blank23', 'a blank Google name falls back to the email');
select is(pg_temp.name_of(5), left('A' || repeat('b', 69), 60), 'a long name is cut to 60 characters');
select is(pg_temp.name_of(6), 'Chosen', 'a name given on insert is kept');

select throws_ok(
  $$ update public.organization_members set phone = '01712345678' where user_id = '00000000-0000-4000-8000-0000000023d1' $$,
  '23514', null, 'a mobile must be in the +E.164 form the app stores'
);

select throws_ok(
  $$ update public.organization_members set display_name = '   ' where user_id = '00000000-0000-4000-8000-0000000023d1' $$,
  '23514', null, 'a name cannot be blank'
);
select throws_ok(
  $$ update public.organization_members set display_name = repeat('x', 61) where user_id = '00000000-0000-4000-8000-0000000023d1' $$,
  '23514', null, 'nor longer than 60 characters'
);

select ok(not has_function_privilege('authenticated', 'private.member_display_name(uuid)', 'execute'), 'signed-in users cannot call the naming helper');
select ok(not has_function_privilege('authenticated', 'private.fill_member_display_name()', 'execute'), 'nor the trigger function');
select ok(not has_function_privilege('anon', 'private.member_display_name(uuid)', 'execute'), 'signed-out visitors cannot call the naming helper');
select ok(not has_function_privilege('anon', 'private.fill_member_display_name()', 'execute'), 'nor the trigger function');

select * from finish();
rollback;
