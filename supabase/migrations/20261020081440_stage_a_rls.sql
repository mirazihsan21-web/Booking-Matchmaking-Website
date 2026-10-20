-- Stage A: tenant-scoped row-level security, explicit grants and logo storage.
--
-- Who sees what:
--   visitors (anon)   public catalogue of LIVE organizations only (org public columns, branches,
--                     resources, activities, open-play sessions)
--   members           everything in their organization; owners write the catalogue, staff read it
--   players           their own profile, favourites, availability, requests, bookings and offers
--   platform admins   every organization (read)
-- Writes that span tables (onboarding, scheduling, booking flow) run server-side as service_role.
-- One permissive policy per table, role and action (keeps `supabase db advisors` clean).

-- ── Helpers: security definer so policies never recurse through RLS; private schema (not exposed) ──
create function private.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create function private.is_org_owner(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create function private.org_is_live(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations o where o.id = org and o.status = 'live');
$$;

create function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

/** True when `profile` belongs to the caller AND lives in organization `org`. */
create function private.is_own_profile(profile uuid, org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.player_profiles p
    where p.id = profile and p.organization_id = org and p.user_id = (select auth.uid())
  );
$$;

/** Storage folders are named by organization id; compare as text so a malformed folder is just "no". */
create function private.is_org_owner_folder(folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id::text = folder and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

grant usage on schema private to anon, authenticated;
revoke execute on all functions in schema private from public;
grant execute on function
  private.is_org_member(uuid), private.is_org_owner(uuid), private.org_is_live(uuid),
  private.is_platform_admin(), private.is_own_profile(uuid, uuid), private.is_org_owner_folder(text)
to anon, authenticated;

-- ── Grants (explicit; tables start with none — see the schema migration) ───
grant select (id, slug, name, business_type, branding, currency, timezone, status) on public.organizations to anon;
grant select on public.branches, public.resources, public.activities,
                public.open_play_sessions, public.open_play_session_resources to anon;

grant select on public.organizations to authenticated;
grant update (name, branding) on public.organizations to authenticated;
grant select on public.organization_members, public.organization_invites to authenticated;
grant select, insert, update, delete on public.branches, public.resources, public.activities to authenticated;
grant select on public.open_play_sessions, public.open_play_session_resources, public.resource_reservations to authenticated;
grant select, delete on public.player_profiles to authenticated;
grant insert (organization_id, user_id, display_name, phone, skill, email_opt_in) on public.player_profiles to authenticated;
grant update (display_name, phone, skill, email_opt_in) on public.player_profiles to authenticated;
grant select, insert, update, delete on public.profile_activities, public.availability to authenticated;
grant select, delete on public.seat_requests to authenticated;
grant insert (organization_id, session_id, profile_id) on public.seat_requests to authenticated;
grant select on public.groups, public.bookings, public.waitlist_entries,
                public.seat_offers, public.messages, public.events to authenticated;

-- ── Organizations and membership ────────────────────────────────────────────
create policy organizations_select on public.organizations for select to anon, authenticated
  using (status = 'live' or (select private.is_org_member(id)) or (select private.is_platform_admin()));
create policy organizations_update on public.organizations for update to authenticated
  using ((select private.is_org_owner(id))) with check ((select private.is_org_owner(id)));

create policy organization_members_select on public.organization_members for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy organization_invites_select on public.organization_invites for select to authenticated
  using ((select private.is_org_owner(organization_id)));
-- platform_admins: RLS on, no policies, no grants — read via service_role / private.is_platform_admin().

-- ── Catalogue: visitors read live venues, members read theirs, owners write ─
do $$
declare
  t text;
begin
  foreach t in array array['branches', 'resources', 'activities'] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to anon, authenticated
         using ((select private.org_is_live(organization_id)) or (select private.is_org_member(organization_id)))', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated
         with check ((select private.is_org_owner(organization_id)))', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated
         using ((select private.is_org_owner(organization_id))) with check ((select private.is_org_owner(organization_id)))', t);
    execute format(
      'create policy %1$s_delete on public.%1$I for delete to authenticated
         using ((select private.is_org_owner(organization_id)))', t);
  end loop;

  -- Schedule rows are written only by the schedule RPCs (service_role).
  foreach t in array array['open_play_sessions', 'open_play_session_resources', 'groups'] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to anon, authenticated
         using ((select private.org_is_live(organization_id)) or (select private.is_org_member(organization_id)))', t);
  end loop;
end $$;

create policy resource_reservations_select on public.resource_reservations for select to authenticated
  using ((select private.is_org_member(organization_id)));

-- ── Players ──────────────────────────────────────────────────────────────────
create policy player_profiles_select on public.player_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_org_member(organization_id)));
create policy player_profiles_insert on public.player_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.org_is_live(organization_id)));
create policy player_profiles_update on public.player_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy player_profiles_delete on public.player_profiles for delete to authenticated
  using (user_id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array['profile_activities', 'availability'] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using ((select private.is_own_profile(profile_id, organization_id)) or (select private.is_org_member(organization_id)))', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated
         with check ((select private.is_own_profile(profile_id, organization_id)))', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated
         using ((select private.is_own_profile(profile_id, organization_id)))
         with check ((select private.is_own_profile(profile_id, organization_id)))', t);
    execute format(
      'create policy %1$s_delete on public.%1$I for delete to authenticated
         using ((select private.is_own_profile(profile_id, organization_id)))', t);
  end loop;
end $$;

-- ── Booking flow: players read their own rows, members read their venue's ─
create policy seat_requests_select on public.seat_requests for select to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)) or (select private.is_org_member(organization_id)));
create policy seat_requests_insert on public.seat_requests for insert to authenticated
  with check ((select private.is_own_profile(profile_id, organization_id)));
create policy seat_requests_delete on public.seat_requests for delete to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)));

do $$
declare
  t text;
begin
  foreach t in array array['bookings', 'waitlist_entries', 'messages'] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using ((select private.is_own_profile(profile_id, organization_id)) or (select private.is_org_member(organization_id)))', t);
  end loop;
end $$;

create policy seat_offers_select on public.seat_offers for select to authenticated
  using (
    (select private.is_org_member(organization_id))
    or exists (
      select 1 from public.waitlist_entries w
      where w.id = waitlist_entry_id and (select private.is_own_profile(w.profile_id, w.organization_id))
    )
  );

create policy events_select on public.events for select to authenticated
  using ((select private.is_org_member(organization_id)));

-- ── Logo storage: public bucket (logos are public anyway); only owners write their org's folder ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-assets', 'org-assets', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Upsert (re-uploading a logo) needs select + insert + update, so owners get all four on their folder.
create policy org_assets_select on storage.objects for select to authenticated
  using (bucket_id = 'org-assets' and (select private.is_org_owner_folder((storage.foldername(name))[1])));
create policy org_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'org-assets' and (select private.is_org_owner_folder((storage.foldername(name))[1])));
create policy org_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'org-assets' and (select private.is_org_owner_folder((storage.foldername(name))[1])))
  with check (bucket_id = 'org-assets' and (select private.is_org_owner_folder((storage.foldername(name))[1])));
create policy org_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-assets' and (select private.is_org_owner_folder((storage.foldername(name))[1])));
