-- Stage B1: booking history can't be deleted by accident.
--
-- References from the booking-flow tables to the rows they record were `on delete cascade`, so deleting
-- one player profile, activity or session silently erased its bookings, waitlist entries and offers.
-- They become `on delete no action` (same composite keys and names as 20261020191000_tenant_scoped_fks):
-- deleting a single row with history is refused, while deleting a whole organization still works because
-- `no action` is checked at the end of the statement, after the organization's own cascades.
-- Tested in supabase/tests/database/07_history.test.sql.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('groups',           'session_id',        'open_play_sessions'),
      ('groups',           'resource_id',       'resources'),
      ('groups',           'activity_id',       'activities'),
      ('bookings',         'session_id',        'open_play_sessions'),
      ('bookings',         'group_id',          'groups'),
      ('bookings',         'profile_id',        'player_profiles'),
      ('waitlist_entries', 'session_id',        'open_play_sessions'),
      ('waitlist_entries', 'profile_id',        'player_profiles'),
      ('seat_offers',      'group_id',          'groups'),
      ('seat_offers',      'waitlist_entry_id', 'waitlist_entries'),
      ('events',           'session_id',        'open_play_sessions')
    ) as v (child, col, parent)
  loop
    execute format('alter table public.%1$I drop constraint %2$I', r.child, r.child || '_' || r.col || '_fkey');
    execute format(
      'alter table public.%1$I add constraint %2$I foreign key (%3$I, organization_id)
         references public.%4$I (id, organization_id) on delete no action',
      r.child, r.child || '_' || r.col || '_fkey', r.col, r.parent);
  end loop;
end $$;
