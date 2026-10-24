-- One Brand R1: staff per section. The owner runs every section; a staff member reads and runs only
-- the sections they are given (section_staff). Players' access to their own rows is unchanged.

-- ── section_staff ───────────────────────────────────────────────────────────
create table public.section_staff (
  organization_id uuid not null,
  section_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (section_id, user_id),
  constraint section_staff_section_id_fkey foreign key (section_id, organization_id)
    references public.sections (id, organization_id) on delete cascade,
  -- Leaving the team (or being removed) takes the person off every section.
  constraint section_staff_member_fkey foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id) on delete cascade
);
create index section_staff_user_id_idx on public.section_staff (user_id);
create index section_staff_organization_id_idx on public.section_staff (organization_id, user_id);

alter table public.section_staff enable row level security;
revoke all on public.section_staff from anon, authenticated;
grant select on public.section_staff to authenticated;
grant all on public.section_staff to service_role;

-- Written only by the server (invites, role changes): no insert/update/delete policies.
create policy section_staff_select on public.section_staff for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_org_owner(organization_id)));

-- Today's staff keep seeing everything: one row per section of their organization.
insert into public.section_staff (organization_id, section_id, user_id)
select m.organization_id, s.id, m.user_id
from public.organization_members m
join public.sections s on s.organization_id = m.organization_id
where m.role = 'staff';

-- ── invites name the sections a new staff member gets ───────────────────────
alter table public.organization_invites add column section_ids uuid[] not null default '{}';
-- Staff invites made before sections get every section (as today's staff do). An organization with
-- staff invites but no section would fail the check below; every venue is created with a section.
update public.organization_invites i
set section_ids = coalesce((select array_agg(s.id order by s.position, s.name) from public.sections s where s.organization_id = i.organization_id), '{}')
where i.role = 'staff';
alter table public.organization_invites add constraint organization_invites_section_ids_check
  check ((role = 'owner' and cardinality(section_ids) = 0) or (role = 'staff' and cardinality(section_ids) > 0));

-- ── helpers ─────────────────────────────────────────────────────────────────
-- The section's organization owner, or a member given this section.
create function private.is_section_staff(section uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sections s
    join public.organization_members m on m.organization_id = s.organization_id and m.user_id = (select auth.uid())
    where s.id = section
      and (m.role = 'owner' or exists (select 1 from public.section_staff ss where ss.section_id = s.id and ss.user_id = m.user_id))
  );
$$;

create function private.is_session_staff(session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.open_play_sessions o where o.id = session and private.is_section_staff(o.section_id));
$$;

create function private.is_resource_staff(resource uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.resources r where r.id = resource and private.is_section_staff(r.section_id));
$$;

-- ── staff reads go through the row's section ────────────────────────────────
drop policy seat_requests_select on public.seat_requests;
create policy seat_requests_select on public.seat_requests for select to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)) or (select private.is_session_staff(session_id)));

drop policy bookings_select on public.bookings;
create policy bookings_select on public.bookings for select to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)) or (select private.is_session_staff(session_id)));

drop policy waitlist_entries_select on public.waitlist_entries;
create policy waitlist_entries_select on public.waitlist_entries for select to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)) or (select private.is_session_staff(session_id)));

-- An event with no session (venue-wide) is the owner's.
drop policy events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (
    case when session_id is null then (select private.is_org_owner(organization_id))
         else (select private.is_session_staff(session_id)) end
  );

drop policy seat_offers_select on public.seat_offers;
create policy seat_offers_select on public.seat_offers for select to authenticated
  using (
    exists (select 1 from public.groups g where g.id = seat_offers.group_id and (select private.is_session_staff(g.session_id)))
    or exists (
      select 1 from public.waitlist_entries w
      where w.id = seat_offers.waitlist_entry_id and (select private.is_own_profile(w.profile_id, w.organization_id))
    )
  );

drop policy resource_bookings_select on public.resource_bookings;
create policy resource_bookings_select on public.resource_bookings for select to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)) or (select private.is_resource_staff(resource_id)));

drop policy resource_reservations_select on public.resource_reservations;
create policy resource_reservations_select on public.resource_reservations for select to authenticated
  using ((select private.is_resource_staff(resource_id)));
