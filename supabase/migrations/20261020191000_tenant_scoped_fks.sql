-- Stage A review fix: a row may only reference rows of its own organization.
--
-- RLS checks WHO writes a row, not where its foreign keys point. Through PostgREST an owner of venue A
-- could add a resource under venue B's branch, and a player at A could request a seat in B's session or
-- favourite B's activity. Every reference between tenant tables now carries organization_id:
-- (x_id, organization_id) → parent (id, organization_id), keeping the original ON DELETE action.
--
-- Each new index leads with x_id, so "every FK column leads an index" (01_schema) and the advisors'
-- unindexed-foreign-key check both still hold. Tested in supabase/tests/database/06_tenant_refs.test.sql.

alter table public.branches add constraint branches_id_organization_id_key unique (id, organization_id);
alter table public.resources add constraint resources_id_organization_id_key unique (id, organization_id);
alter table public.activities add constraint activities_id_organization_id_key unique (id, organization_id);
alter table public.open_play_sessions add constraint open_play_sessions_id_organization_id_key unique (id, organization_id);
alter table public.player_profiles add constraint player_profiles_id_organization_id_key unique (id, organization_id);
alter table public.groups add constraint groups_id_organization_id_key unique (id, organization_id);
alter table public.waitlist_entries add constraint waitlist_entries_id_organization_id_key unique (id, organization_id);

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('resources',                   'branch_id',         'branches',           'cascade'),
      ('open_play_sessions',          'branch_id',         'branches',           'cascade'),
      ('open_play_sessions',          'activity_id',       'activities',         'restrict'),
      ('open_play_session_resources', 'session_id',        'open_play_sessions', 'cascade'),
      ('open_play_session_resources', 'resource_id',       'resources',          'restrict'),
      ('resource_reservations',       'resource_id',       'resources',          'cascade'),
      ('profile_activities',          'profile_id',        'player_profiles',    'cascade'),
      ('profile_activities',          'activity_id',       'activities',         'cascade'),
      ('availability',                'profile_id',        'player_profiles',    'cascade'),
      ('seat_requests',               'session_id',        'open_play_sessions', 'cascade'),
      ('seat_requests',               'profile_id',        'player_profiles',    'cascade'),
      ('groups',                      'session_id',        'open_play_sessions', 'cascade'),
      ('groups',                      'resource_id',       'resources',          'cascade'),
      ('groups',                      'activity_id',       'activities',         'cascade'),
      ('bookings',                    'session_id',        'open_play_sessions', 'cascade'),
      ('bookings',                    'group_id',          'groups',             'cascade'),
      ('bookings',                    'profile_id',        'player_profiles',    'cascade'),
      ('waitlist_entries',            'session_id',        'open_play_sessions', 'cascade'),
      ('waitlist_entries',            'profile_id',        'player_profiles',    'cascade'),
      ('seat_offers',                 'group_id',          'groups',             'cascade'),
      ('seat_offers',                 'waitlist_entry_id', 'waitlist_entries',   'cascade'),
      -- Only the profile column is cleared; the message stays with its venue.
      ('messages',                    'profile_id',        'player_profiles',    'set null (profile_id)'),
      ('events',                      'session_id',        'open_play_sessions', 'cascade')
    ) as v (child, col, parent, on_delete)
  loop
    execute format('alter table public.%1$I drop constraint %2$I', r.child, r.child || '_' || r.col || '_fkey');
    execute format(
      'alter table public.%1$I add constraint %2$I foreign key (%3$I, organization_id)
         references public.%4$I (id, organization_id) on delete %5$s',
      r.child, r.child || '_' || r.col || '_fkey', r.col, r.parent, r.on_delete);
    execute format('drop index if exists public.%I', r.child || '_' || r.col || '_idx');
    execute format('create index %1$I on public.%2$I (%3$I, organization_id)', r.child || '_' || r.col || '_idx', r.child, r.col);
  end loop;
end $$;
