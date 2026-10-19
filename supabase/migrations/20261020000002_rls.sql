-- Row-level security.
--   Owners: full CRUD on their venue's catalogue and players; READ-ONLY on booking-flow tables.
--   Players: read their venue's catalogue; read/write their own profile, favourites, availability
--            and seat requests; read their own bookings, waitlist entries, offers and messages.
--   anon: nothing.
-- Booking-flow writes (bookings, waitlist_entries, seat_offers, messages, events) go only through
-- the RPCs in the next migration, executed as service_role, so seat invariants live in one place.

create schema if not exists private;
grant usage on schema private to authenticated;

-- Helpers are security definer so policies can look up venues/players without recursing through RLS.
-- They live in `private`, which the Data API does not expose, and only ever answer about the caller.
create function private.is_venue_owner(v uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.venues where id = v and owner_id = (select auth.uid())
  );
$$;

create function private.is_venue_member(v uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.venues where id = v and owner_id = (select auth.uid()))
      or exists (select 1 from public.players where venue_id = v and user_id = (select auth.uid()));
$$;

/** True when player `p` belongs to the caller AND lives in venue `v` (stops cross-venue rows). */
create function private.is_own_player(p uuid, v uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.players where id = p and venue_id = v and user_id = (select auth.uid())
  );
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

alter table public.venues enable row level security;
alter table public.venue_tables enable row level security;
alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.player_games enable row level security;
alter table public.availability enable row level security;
alter table public.sessions enable row level security;
alter table public.seat_requests enable row level security;
alter table public.groups enable row level security;
alter table public.bookings enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.seat_offers enable row level security;
alter table public.messages enable row level security;
alter table public.events enable row level security;

-- venues
create policy venues_member_select on public.venues
  for select to authenticated using ((select private.is_venue_member(id)));
create policy venues_owner_insert on public.venues
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy venues_owner_update on public.venues
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy venues_owner_delete on public.venues
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Venue catalogue: members read, owners write.
create policy venue_tables_member_select on public.venue_tables
  for select to authenticated using ((select private.is_venue_member(venue_id)));
create policy venue_tables_owner_all on public.venue_tables
  for all to authenticated
  using ((select private.is_venue_owner(venue_id))) with check ((select private.is_venue_owner(venue_id)));

create policy games_member_select on public.games
  for select to authenticated using ((select private.is_venue_member(venue_id)));
create policy games_owner_all on public.games
  for all to authenticated
  using ((select private.is_venue_owner(venue_id))) with check ((select private.is_venue_owner(venue_id)));

create policy sessions_member_select on public.sessions
  for select to authenticated using ((select private.is_venue_member(venue_id)));
create policy sessions_owner_all on public.sessions
  for all to authenticated
  using ((select private.is_venue_owner(venue_id))) with check ((select private.is_venue_owner(venue_id)));

create policy groups_member_select on public.groups
  for select to authenticated using ((select private.is_venue_member(venue_id)));
create policy groups_owner_all on public.groups
  for all to authenticated
  using ((select private.is_venue_owner(venue_id))) with check ((select private.is_venue_owner(venue_id)));

-- players: owners manage; a player reads and edits only their own row.
create policy players_owner_all on public.players
  for all to authenticated
  using ((select private.is_venue_owner(venue_id))) with check ((select private.is_venue_owner(venue_id)));
create policy players_self_select on public.players
  for select to authenticated using (user_id = (select auth.uid()));
create policy players_self_update on public.players
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- A player's own preference rows: owners manage, players manage their own.
create policy player_games_owner_all on public.player_games
  for all to authenticated
  using ((select private.is_venue_owner(venue_id))) with check ((select private.is_venue_owner(venue_id)));
create policy player_games_self_all on public.player_games
  for all to authenticated
  using ((select private.is_own_player(player_id, venue_id)))
  with check ((select private.is_own_player(player_id, venue_id)));

create policy availability_owner_all on public.availability
  for all to authenticated
  using ((select private.is_venue_owner(venue_id))) with check ((select private.is_venue_owner(venue_id)));
create policy availability_self_all on public.availability
  for all to authenticated
  using ((select private.is_own_player(player_id, venue_id)))
  with check ((select private.is_own_player(player_id, venue_id)));

create policy seat_requests_owner_all on public.seat_requests
  for all to authenticated
  using ((select private.is_venue_owner(venue_id))) with check ((select private.is_venue_owner(venue_id)));
create policy seat_requests_self_all on public.seat_requests
  for all to authenticated
  using ((select private.is_own_player(player_id, venue_id)))
  with check ((select private.is_own_player(player_id, venue_id)));

-- Booking flow: read-only for owners and the player concerned; writes via RPC (service_role).
create policy bookings_owner_select on public.bookings
  for select to authenticated using ((select private.is_venue_owner(venue_id)));
create policy bookings_self_select on public.bookings
  for select to authenticated using ((select private.is_own_player(player_id, venue_id)));

create policy waitlist_entries_owner_select on public.waitlist_entries
  for select to authenticated using ((select private.is_venue_owner(venue_id)));
create policy waitlist_entries_self_select on public.waitlist_entries
  for select to authenticated using ((select private.is_own_player(player_id, venue_id)));

create policy seat_offers_owner_select on public.seat_offers
  for select to authenticated using ((select private.is_venue_owner(venue_id)));
create policy seat_offers_self_select on public.seat_offers
  for select to authenticated using (
    exists (
      select 1 from public.waitlist_entries w
      where w.id = waitlist_entry_id and (select private.is_own_player(w.player_id, w.venue_id))
    )
  );

create policy messages_owner_select on public.messages
  for select to authenticated using ((select private.is_venue_owner(venue_id)));
create policy messages_self_select on public.messages
  for select to authenticated using ((select private.is_own_player(player_id, venue_id)));

create policy events_owner_select on public.events
  for select to authenticated using ((select private.is_venue_owner(venue_id)));
