# Stage A — Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the M1 single-venue demo into the multi-tenant platform foundation:
- a venue owner signs up, picks café / turf / gaming lounge, gets a preset catalogue, edits branches, resources, activities and the open-play schedule, and goes live on `slug.<root>`;
- players sign up there and keep a profile;
- a platform admin can suspend tenants.

**Architecture:**
- **Schema.** A new migration replaces the M1 tables with the tenancy model (organizations → branches → resources; organization-level activities, player profiles and open-play sessions). It keeps every M1 seat invariant and booking RPC. Resource time lives in one `resource_reservations` table with a Postgres exclusion constraint.
- **Access.** RLS is tenant-scoped through `private` helpers. Single-table owner edits use the user's RLS client. Multi-table writes go through `service_role` server code or `security invoker` RPCs.
- **Routing.** `proxy.ts` refreshes the Supabase session and rewrites tenant subdomains to `/t/[slug]/…`.

**Tech Stack:**
- Existing: Next.js 16.4 (App Router, Cache Components), Tailwind 4, shadcn (base-nova), Vitest 5, fast-check 4, Supabase CLI 2.121 (Postgres 17, pgTAP).
- New: `@supabase/supabase-js` ^2.118.0, `@supabase/ssr` ^0.12.7, `server-only` ^0.0.1, `zod` ^4.6.7, `btree_gist`.

**Spec:** `docs/superpowers/specs/2026-10-20-booking-platform-design.md` (§§1–7, §9). Notes: `memory.md`.

## Global Constraints

- **Branch and commits.** Work on branch `stage-a-platform-foundation`, cut from `main`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Migrations.**
  - Create each one with `pnpm exec supabase migration new <name>`. Never edit an existing migration file.
  - Every table enables RLS **in the migration that creates it**.
  - Grants are always explicit: `revoke all … from anon, authenticated`, then the specific grants. Default privileges for `postgres` in `public` are revoked from `anon, authenticated`.
- **Functions.**
  - **No `security definer` function in `public`.** Security-definer helpers live in `private` and only answer questions about the caller.
  - Every function sets `search_path = ''`.
  - Booking and schedule RPCs are `security invoker` and executable by `service_role` only.
- **Policies.** One permissive policy per table, per role, per action. `pnpm db:lint` (`supabase db advisors --local --type all --fail-on warn`) must pass.
- **Money and time.**
  - Money is an `int` in **poisha** (BDT × 100). Columns end in `_poisha`. Display with `formatBdt()`, e.g. `৳2,500`.
  - Organization defaults: `currency 'BDT'`, `timezone 'Asia/Dhaka'`.
- **Auth.**
  - Use the official `@supabase/ssr` Next.js pattern. Env names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
  - Server checks use `getClaims()`, never `getSession()`.
  - The secret key only appears in `server-only` modules.
- **Next.js 16.**
  - Read the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing Next code.
  - A page part that reads cookies or the session renders inside `<Suspense>`.
  - Server actions call `refresh()` (`next/cache`) after mutating.
- **Hosts.** `NEXT_PUBLIC_ROOT_DOMAIN` is the root host (`localhost:3000` locally). Tenant URLs are `http://<slug>.localhost:3000`.
- **Copy.** All user-facing UI copy lives in `apps/web/messages/en.ts`; components import `m` from `@/messages`. Business-type words come from the presets. Bangla is added later as `bn.ts` with the same shape.
- **Tests.**
  - `pnpm test` stays database-free.
  - Database tests: `pnpm db:test` (pgTAP), `pnpm test:race`, `pnpm test:integration` (apps/web, local Supabase).
- **`packages/engine` stays pure.** Its "game" vocabulary means *activity*; don't rename it.
- **`packages/sim` keeps its M1 row shapes in Stage A.** Add a header comment to `packages/sim/src/rows.ts` saying so. It's migrated when a later stage first inserts sim data.

## Schema Reference (target after Task 1)

Every tenant table has `organization_id uuid not null → organizations on delete cascade` and a full index on every FK column (enforced by pgTAP). Every `id` is `uuid primary key default gen_random_uuid()`, and `created_at timestamptz not null default now()` where listed.

**Enums:**
- `business_type`: `boardgame_cafe`, `turf`, `gaming_lounge`
- `org_status`: `onboarding`, `live`, `suspended`
- `member_role`: `owner`, `staff`
- `team_mode`: `none`, `two_teams`
- `resource_kind`: `table`, `pitch`, `court`, `zone`, `pod`
- `reservation_source`: `session`, `booking`
- `session_status`: `open`, `matched`, `closed`, `cancelled`
- Kept from M1: `booking_status`, `booking_source`, `waitlist_status`, `offer_status`, `message_direction`

| Table | Columns & constraints |
|---|---|
| `organizations` | `slug text not null unique`, with check `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$` and `not in ('www','app','admin','api','manage','auth','static','t','help','support','status','docs','blog','mail')`; `name text not null` (2–80 chars after trim); `business_type`; `branding jsonb not null default '{}'` (`{logo_path?, primary?, accent?}`); `currency text not null default 'BDT' check (= 'BDT')`; `timezone text not null default 'Asia/Dhaka'`; `status org_status not null default 'onboarding'`; `created_by uuid → auth.users on delete set null`; `created_at` |
| `organization_members` | `organization_id`; `user_id → auth.users cascade`; `role member_role not null`; `created_at`; **PK (organization_id, user_id)** |
| `organization_invites` | `organization_id`; `email text not null check (email = lower(email))`; `role member_role not null default 'staff'`; `invited_by uuid → auth.users set null`; `expires_at timestamptz not null default now() + interval '14 days'`; `accepted_at timestamptz`; partial unique `(organization_id, email) where accepted_at is null` |
| `platform_admins` | `user_id uuid primary key → auth.users cascade`; `created_at` |
| `branches` | `organization_id`; `name text not null`; `address text not null default ''`; `opening_hours jsonb not null` (keys `"0"`–`"6"`, 0 = Sunday; value `["HH:MM","HH:MM"]` or `null` for closed; a close ≤ open means closing the next day; default `["10:00","23:00"]` every day); `offer_ttl_seconds int not null default 900 check (> 0)`; `created_at` |
| `resources` | `organization_id`; `branch_id → branches cascade`; `name text not null`; `kind resource_kind not null`; `capacity smallint not null check (1..30)`; `price_per_hour_poisha int check (>= 0)` (nullable); `active boolean not null default true`; `x real not null default 0`; `y real not null default 0` |
| `activities` | `organization_id`; `name text not null`; `min_players smallint check (>= 1)`; `max_players smallint`; `duration_min smallint check (> 0)`; `popularity real not null default 1 check (> 0)`; `team_mode team_mode not null default 'none'`; `team_size smallint`; `active boolean not null default true`; `check (min_players <= max_players)`; `check ((team_mode = 'none' and team_size is null) or (team_mode = 'two_teams' and team_size >= 1 and min_players = 2 * team_size and max_players = 2 * team_size))` |
| `open_play_sessions` | `organization_id`; `branch_id → branches cascade`; `activity_id → activities on delete restrict` (nullable); `starts_at`, `ends_at timestamptz not null`, `check (starts_at < ends_at)`; `seat_price_poisha int not null check (>= 0)`; `status session_status not null default 'open'`; `created_at` |
| `open_play_session_resources` | `organization_id`; `session_id → open_play_sessions cascade`; `resource_id → resources on delete restrict`; **PK (session_id, resource_id)** |
| `resource_reservations` | `organization_id`; `resource_id → resources cascade`; `period tstzrange not null check (not isempty(period) and lower_inc(period) and not upper_inc(period))`; `source reservation_source not null`; `source_id uuid not null`; `created_at`; **`exclude using gist (resource_id with =, period with &&)`**; index `(source, source_id)` |
| `player_profiles` | `organization_id`; `user_id → auth.users cascade` (not null); `display_name text not null` (1–60 chars); `phone text check (phone ~ '^\+[1-9][0-9]{6,14}$')` (nullable); `skill smallint not null check (1..5)`; `email_opt_in boolean not null default true`; `created_at`; unique `(organization_id, user_id)`; unique `(organization_id, phone)` |
| `profile_activities` | `organization_id`; `profile_id → player_profiles cascade`; `activity_id → activities cascade`; `rank smallint check (>= 1)`; **PK (profile_id, activity_id)**; unique `(profile_id, rank)` |
| `availability` | `organization_id`; `profile_id → player_profiles cascade`; `weekday smallint check (0..6)`; `start_time time`; `end_time time`; `check (start_time < end_time)` |
| `seat_requests` | `organization_id`; `session_id → open_play_sessions cascade`; `profile_id → player_profiles cascade`; `priority smallint not null default 0`; `created_at`; unique `(session_id, profile_id)` |
| `groups` | `organization_id`; `session_id`; `resource_id → resources cascade`; `activity_id → activities cascade`; `capacity smallint check (> 0)`; unique `(session_id, resource_id)` |
| `bookings` | `organization_id`; `session_id`; `group_id`; `profile_id`; `seat_no`; `status`; `source`; `price_poisha int check (>= 0)`; `created_at`; `cancelled_at`; **partial unique** `(session_id, profile_id) where status <> 'cancelled'`; **partial unique** `(group_id, seat_no) where status <> 'cancelled'` |
| `waitlist_entries` | As M1, with `organization_id` and `profile_id` |
| `seat_offers` | As M1, with `organization_id`; partial unique `(group_id, seat_no) where status = 'pending'` |
| `messages` | As M1, with `organization_id` and `profile_id → player_profiles set null`. Reshaped into notifications in Stage B |
| `events` | As M1, with `organization_id` and `session_id → open_play_sessions cascade` |

## Review Focus

1. **Messy slugs.** `"  Dhanmondi Turf "`, `"-turf"`, `"turf-"`, `"WWW"`, `"admin"`, Bangla text (`"ধানমন্ডি"`), and a slug already taken in a different case are normalised or rejected with a clear reason. They never cause a 500 (Tasks 7 and 9).
2. **Odd hosts.** `www.<root>`, `Dhanmondi-Turf.localhost:3000`, `a.b.<root>`, an unrelated preview host, and `/t/<slug>` typed on the root host each reach the right site or a 404. They never reach another tenant (Task 7).
3. **Tenants that aren't live** (`onboarding`, `suspended`). Visitors and would-be players see "not available" and can't create a profile. The owner still manages it (Tasks 2 and 13).
4. **Clashing schedule entries.** The same resource with overlapping times, or a weekly repeat where one week collides, creates **nothing**, and the owner sees which time clashed. Back-to-back sessions are allowed (Tasks 3 and 12).
5. **An organization left without an owner.** Removing or demoting the last owner is refused (Task 10).

---

### Task 1: Stage A schema (replaces the M1 tables)

**Files:**
- Create (CLI): `supabase/migrations/<ts>_stage_a_schema.sql`
- Modify: `supabase/tests/database/01_schema.test.sql`, `03_booking_rpcs.test.sql`, `supabase/tests/race/accept-offer-race.test.ts` (fixtures use the new tables and columns)
- Modify: `packages/sim/src/rows.ts` (header comment only)

**Interfaces:**
- **Produces:** every table, enum and constraint in the Schema Reference.
- **The migration:**
  1. Drops the M1 policies, the `private.is_venue_*` / `is_own_player` helpers, the five RPCs and all M1 tables and enums, with `cascade`. M1 holds no production data.
  2. `create extension if not exists btree_gist with schema extensions`.
  3. Creates the Stage A schema.
  4. `alter table … enable row level security` on every table.
  5. `revoke all on all tables in schema public from anon, authenticated`, `grant all … to service_role`, and the default-privileges revoke. Policies and grants for users come in Task 2.
- **Re-creates the M1 RPCs with the same contracts and return codes** (see `memory.md` §5):
  - `cancel_booking(uuid)`
  - `create_offer(uuid, smallint, uuid)`: TTL from `branches.offer_ttl_seconds` via `open_play_sessions.branch_id`
  - `accept_offer(uuid)`: price from `open_play_sessions.seat_price_poisha`; inserts `profile_id`
  - `decline_offer(uuid)`
  - `expire_offers()`
  - Lock order stays offer → group → entry. Event payloads use `profile_id` instead of `player_id`.

- [ ] **Step 1: Update the tests to the new model:**
  - `01_schema`:
    - `has_table` for the 20 tables and `has_enum` for the 12 enums.
    - The FK-index check (kept).
    - `throws_ok`, each with its SQLSTATE:
      - skill 6 → `23514`
      - bad phone → `23514`
      - activity min > max → `23514`
      - `two_teams` with `team_size` null → `23514`
      - `two_teams` with team_size 5 and max_players 8 → `23514`
      - slug `'Bad Slug'` → `23514`
      - slug `'admin'` → `23514`
      - duplicate live booking per profile → `23505`
      - duplicate live seat → `23505`
      - second pending offer for a seat → `23505`
      - **overlapping reservations on one resource → `23P01`**
    - `lives_ok`:
      - a cancelled plus a live booking in the same seat;
      - **back-to-back reservations** (`[18:00,19:00)` then `[19:00,20:00)`);
      - overlapping reservations on **different** resources.
  - `03_booking_rpcs`: the same 37 assertions with renamed fixtures (organization + branch + resource + activity + session + profiles). The price column is `seat_price_poisha 80000`.
  - Race test: the same scenario with the new fixture inserts.
- [ ] **Step 2: Run** `pnpm db:test && pnpm test:race`. Expected: FAIL (the new tables don't exist).
- [ ] **Step 3: Write the migration** and add the `rows.ts` comment.
- [ ] **Step 4: Run** `pnpm db:reset && pnpm db:test && pnpm test:race`. Expected: PASS. The `02_rls` file fails at this point until Task 2 rewrites it, so delete it in this task and recreate it in Task 2. Record that as a ruling.
- [ ] **Step 5: Commit** `feat(db): Stage A tenancy schema with resource reservations`.

### Task 2: Tenancy RLS, grants and the logo bucket

**Files:**
- Create (CLI): `supabase/migrations/<ts>_stage_a_rls.sql`
- Create: `supabase/tests/database/02_tenancy_rls.test.sql`, `supabase/tests/database/04_grants.test.sql`
- Modify: root `package.json`, adding `"db:lint": "supabase db advisors --local --type all --fail-on warn"`

**Interfaces:**
- **`private` helpers** (`language sql stable security definer set search_path = ''`; execute granted to `authenticated` and `anon`, revoked from `public`). Also `grant usage on schema private to anon, authenticated`, because anon policies evaluate `org_is_live`:
  - `is_org_member(org uuid)`: any role, for `auth.uid()`
  - `is_org_owner(org uuid)`
  - `org_is_live(org uuid)`
  - `is_platform_admin()`
  - `is_own_profile(profile uuid, org uuid)`: the profile belongs to `auth.uid()` and is in that organization

  The helpers are referenced in policies as `(select private.fn(...))`.
- **Policy and grant matrix.** "Member" means `is_org_member`, "owner" means `is_org_owner`, "own" means `is_own_profile`.

  | Table | `anon` | `authenticated` |
  |---|---|---|
  | `organizations` | select `(id, slug, name, business_type, branding, currency, timezone, status)` where `status='live'` | select where live, member or platform admin; update `(name, branding)` where owner. Inserts and status changes go through `service_role` |
  | `organization_members` | — | select where member |
  | `organization_invites` | — | select where owner |
  | `platform_admins` | — | — (read via `service_role`) |
  | `branches`, `resources`, `activities` | select where `org_is_live` | select where live or member; insert, update and delete where owner |
  | `open_play_sessions`, `open_play_session_resources` | select where live | select where live or member. Writes only through Task 3 RPCs |
  | `resource_reservations` | — | select where member |
  | `player_profiles` | — | select where own or member; insert `(organization_id, user_id, display_name, phone, skill, email_opt_in)` with check `user_id = auth.uid()` and `org_is_live`; update `(display_name, phone, skill, email_opt_in)` where own; delete where own |
  | `profile_activities`, `availability` | — | select where own or member; insert, update and delete where own |
  | `seat_requests` | — | select where own or member; insert `(organization_id, session_id, profile_id)` and delete where own |
  | `groups`, `bookings`, `waitlist_entries`, `seat_offers`, `messages` | — | select where own (via `profile_id`, or the waitlist entry's profile for offers) or member |
  | `events` | — | select where member |
- **Storage:** bucket `org-assets` (`public = true`, `file_size_limit = 1048576`, `allowed_mime_types = {image/png,image/jpeg,image/webp}`; no SVG). **Ruling to log:** the spec says "private bucket + public-read policy for live orgs"; a public bucket gives the same reads with less policy, since logos are public by nature. One policy each for insert, update and delete on `storage.objects`: `bucket_id = 'org-assets' and (select private.is_org_owner(((storage.foldername(name))[1])::uuid))`.

- [ ] **Step 1: Write the failing tests.**

  `02_tenancy_rls`. Fixtures:
  - org A (`live`) with owner OA, staff SA and player PA;
  - org B (`live`) with owner OB;
  - org C (`onboarding`) with owner OC.

  Assertions:
  - **anon:**
    - sees A and B, not C;
    - sees A's resources but not C's;
    - can't read `player_profiles` (`42501`).
  - **OA:**
    - sees A's members, profiles and bookings, none of B's;
    - can update A's branding;
    - can't update B's resources (0 rows).
  - **SA:**
    - sees A's profiles;
    - can't update A's branding (0 rows);
    - can't insert A's resources (`42501` via RLS).
  - **PA:**
    - sees only their own profile;
    - can't see A's events;
    - can't move their profile to B (column update `42501`);
    - can't set `seat_requests.priority` (`42501`).
  - **Another user U:**
    - can create a profile in A;
    - **can't create one in C (not live)** (Review Focus 3);
    - can't create one with someone else's `user_id`.
  - **OA uploads** under `A/…` succeed, and under `B/…` are refused.

  `04_grants`:
  - anon has no table privileges except the select grants listed;
  - `authenticated` has only `SELECT` on `groups`, `bookings`, `waitlist_entries`, `seat_offers`, `messages`, `events`;
  - `has_table_privilege('service_role', 'public.bookings', 'INSERT,UPDATE,DELETE')`.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm test:race`. Expected: PASS, and advisors report no WARN.
- [ ] **Step 5: Commit** `feat(db): tenant-scoped RLS, explicit grants and logo storage`.

### Task 3: Schedule RPCs

**Files:**
- Create (CLI): `supabase/migrations/<ts>_schedule_rpcs.sql`
- Create: `supabase/tests/database/05_schedule.test.sql`

**Interfaces:**
- **`public.schedule_open_play(p_organization_id uuid, p_branch_id uuid, p_activity_id uuid, p_resource_ids uuid[], p_starts_at timestamptz[], p_duration_min int, p_seat_price_poisha int) returns uuid[]`**
  - For each start it inserts the session (`open`, `ends_at = start + duration`), its session-resources, and one `resource_reservations` row per resource (`source 'session'`, period `[start, end)`).
  - It's all-or-nothing in one transaction: an exclusion violation (`23P01`) aborts every start.
  - **Raises:**
    - `invalid_reference`: the branch, any resource or the activity isn't in the organization, a resource isn't in the branch, or a resource is inactive.
    - `no_resources`: an empty array.
    - `no_starts`: an empty array.
  - `p_activity_id` may be null.
- **`public.cancel_open_play_session(p_session_id uuid) returns text`**
  - `'cancelled'`: an `open` session gets status `cancelled`, and its reservations are deleted.
  - `'not_open'`: any other status.
  - `'not_found'`.
- Both RPCs are `security invoker` and executable by `service_role` only.

- [ ] **Step 1: Write the failing test**, `05_schedule`:
  - `schedules three weekly sessions on two resources` returns 3 ids, 3 sessions, 6 session-resources and 6 reservations.
  - **`a repeat that clashes in week 2 creates nothing`**: pre-book week 2, expect `throws_ok … '23P01'`, and the session count is unchanged (Review Focus 4).
  - `back-to-back sessions are allowed`.
  - `another org's resource is rejected`: `P0001`, `invalid_reference`.
  - `an inactive resource is rejected`.
  - `cancel frees the time`: cancel, then rescheduling the same slot succeeds.
  - `cancelling twice reports not_open`.
  - `authenticated can't call it`: `42501`.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `pnpm db:reset && pnpm db:test && pnpm db:lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): atomic open-play scheduling on reserved resource time`.

### Task 4: Engine `splitTeams`

**Files:**
- Create: `packages/engine/src/split-teams.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/split-teams.test.ts`, `packages/engine/test/split-teams.property.test.ts`

**Interfaces:**
- Produces `splitTeams(players: Array<{ id: Id; skill: number }>, teamSize: number): { teams: [Id[], Id[]]; skillGap: number }`.
  - Throws `RangeError('splitTeams needs exactly 2 × teamSize players')` otherwise.
  - Exhaustive search when `players.length <= 12`. Fix the first player (sorted by id) in team 0 so mirror splits are skipped.
  - Otherwise greedy: sort by skill desc, then id, and add each player to the team with the lower total that still has room. Then run pairwise swaps while the gap strictly drops.
  - Ties in the gap are broken by the lexicographically smallest sorted team-0 id list.
  - Each team's ids are returned sorted.

- [ ] **Step 1: Write the failing tests:**
  - **Examples:**
    - skills `[5,4,3,3,2,1]` with team size 3 → gap `0`;
    - `[5,1]` with team size 1 → gap `4`;
    - 10 equal skills → gap `0`;
    - the wrong player count → `RangeError`;
    - the same input twice gives identical output.
  - **Properties** (fast-check, 300 runs, team size 1–7, skill 1–5):
    - every player is placed exactly once;
    - both teams have exactly `teamSize`;
    - `skillGap === |sum(team0) − sum(team1)|`;
    - for 12 or fewer players the gap equals the brute-force optimum computed in the test;
    - for 14 players the gap is ≤ the plain greedy gap.
- [ ] **Step 2: Run** `pnpm --filter @bm/engine test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @bm/engine test && pnpm --filter @bm/engine typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): splitTeams for balanced two-team activities`.

### Task 5: Business-type presets, money helpers and platform theme

**Files:**
- Create: `apps/web/presets/types.ts`, `boardgame.ts`, `turf.ts`, `lounge.ts`, `index.ts`
- Create: `apps/web/lib/money.ts`
- Modify: `apps/web/lib/theme.ts`, `apps/web/app/layout.tsx`
- Delete: `apps/web/skins/`, `apps/web/test/skins.test.ts`
- Test: `apps/web/test/presets.test.ts`, `apps/web/test/money.test.ts`, `apps/web/test/theme.test.ts`

**Interfaces:**
- **`Preset` type:**
  ```ts
  {
    businessType: 'boardgame_cafe' | 'turf' | 'gaming_lounge';
    labels: { resource, resourcePlural, activity, activityPlural, session, sessionPlural, participant, participantPlural };
    palette: { primary, accent };
    resources: Array<{ name; kind: 'table'|'pitch'|'court'|'zone'|'pod'; capacity; pricePerHourPoisha: number | null }>;
    activities: Array<{ name; minPlayers; maxPlayers; durationMin; popularity; teamMode: 'none'|'two_teams'; teamSize: number | null }>;
    seatPricePoisha: number;
  }
  ```
- `getPreset(type)` throws `Unknown business type <type>`. `PRESETS` maps every type to its preset.
- **Preset values come exactly from spec §4:**
  - `turf`: Pitch 1 and Pitch 2 (cap 14, `250000`/h); Badminton Court 1 (cap 4, `60000`/h). 5-a-side (10/10, two teams of 5, 60 min), 7-a-side (14/14, 7, 60 min), Badminton doubles (4/4, 2, 60 min). Seat price `30000`.
  - `gaming_lounge`: PC Zone A/B (zone, cap 10, `150000`/h); Console Pod 1/2 (pod, cap 4, `40000`/h). Valorant 5v5 and CS2 5v5 (two teams of 5, 60 min), EA FC 1v1 (2/2, two teams of 1, 20 min), PUBG squad (`none`, 2–4, 30 min). Seat price `15000`.
  - `boardgame_cafe`: the 8 M1 games and 7 M1 tables, with no table price. Seat price `20000`.
  - Palettes: café `#0F766E` / `#F59E0B`, turf `#15803D` / `#FACC15`, lounge `#7C3AED` / `#22D3EE`.
- **Money helpers:**
  - `bdtToPoisha(input: string): number | null` accepts `'2500'`, `'2,500'`, `'2500.50'` and `'৳2,500'`. It returns `null` for negatives, more than 2 decimals or non-numeric input.
  - `formatBdt(poisha: number): string` → `'৳2,500'`, or `'৳2,500.50'` when there are poisha.
- **Theme:** `brandingToCssVars(branding: { primary?: string; accent?: string }, fallback: { primary: string; accent: string }): Record<string, string>`. It accepts only `#RRGGBB` and uses the fallback otherwise. The root layout uses the platform palette `#0F172A` / `#38BDF8`.

- [ ] **Step 1: Write the failing tests:**
  - **Presets:**
    - every activity satisfies the DB team rule (min = max = 2 × size for `two_teams`; size null for `none`);
    - every activity fits at least one preset resource (`canHost` from `@bm/engine`);
    - names are unique within a preset;
    - `getPreset('nope')` throws.
  - **Money:** the cases listed above, round-tripped.
  - **Theme:** a valid colour is used; `'red'` or a missing colour falls back.
- [ ] **Step 2: Run** `pnpm --filter web test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the skins and their test.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm --filter web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): café, turf and lounge presets with BDT money helpers`.

### Task 6: Supabase clients, env and the integration-test harness

**Files:**
- Modify: `apps/web/package.json`
  - deps `@supabase/supabase-js@^2.118.0`, `@supabase/ssr@^0.12.7`, `server-only@^0.0.1`, `zod@^4.6.7`
  - scripts `"test:integration": "vitest run --config vitest.integration.config.ts"`, `"env:local": "node scripts/write-env-local.mjs"`
- Modify: root `package.json`, adding `test:integration` and `env:local` pass-throughs
- Create:
  - `apps/web/lib/supabase/server.ts`, `client.ts`, `proxy.ts`: the official pattern verbatim (`createClient()` / `updateSession(request)`), **minus** its login redirect
  - `apps/web/lib/service-client.ts` (`server-only`)
  - `apps/web/scripts/write-env-local.mjs`
  - `apps/web/.env.example`
  - `apps/web/vitest.integration.config.ts`
  - `apps/web/test/integration/global-setup.ts`
  - `apps/web/test/integration/helpers.ts`
- Test: `apps/web/test/integration/harness.test.ts`

**Interfaces:**
- `createServiceClient(): SupabaseClient`, with `{ auth: { persistSession: false, autoRefreshToken: false } }`.
- `global-setup.ts` runs `pnpm exec supabase status -o json` from the repo root and fills `NEXT_PUBLIC_SUPABASE_URL` (from `API_URL`), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` unless they're already set.
- `helpers.ts` provides:
  - `serviceDb()`
  - `createTestUser(db, opts?: { email?: string; password?: string }): Promise<{ id; email; password }>`, via `admin.createUser` with `email_confirm: true` and a random password
  - `signedInClient(email, password): Promise<SupabaseClient>`, using the publishable key and `signInWithPassword`, for tests only
  - `deleteTestUser(db, id)`
- `write-env-local.mjs` writes `apps/web/.env.local` with the three Supabase vars and `NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000`.
- The integration config sets `include: ['test/integration/**/*.test.ts']`, `globalSetup` and `fileParallelism: false`.

- [ ] **Step 1: Write the failing test:**
  - `service client reaches the local database`
  - `a test user can sign in and read their own (empty) profiles`: `select` on `player_profiles` returns `[]` with no error
- [ ] **Step 2: Run** `pnpm test:integration`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:integration && pnpm --filter web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Supabase SSR clients and integration-test harness`.

### Task 7: Host routing and slug rules

**Files:**
- Create: `apps/web/lib/tenancy/host.ts`, `apps/web/lib/tenancy/slug.ts`, `apps/web/proxy.ts`, `apps/web/app/t/[slug]/layout.tsx`, `apps/web/app/t/[slug]/not-found.tsx`, `apps/web/messages/en.ts`, `apps/web/messages/index.ts`
- Test: `apps/web/test/host.test.ts`, `apps/web/test/slug.test.ts`

**Interfaces:**
- **`resolveHost(host: string | null, rootDomain: string): { kind: 'root' } | { kind: 'tenant'; slug: string } | { kind: 'unknown' }`**
  - Compare case-insensitively.
  - `root` when the host is `rootDomain` or `www.<root>`, or when the host doesn't end with `.<root>` at all (so preview deploys serve the root site).
  - `tenant` for exactly one extra label that passes `validateSlug`.
  - `unknown` for nested labels or an invalid label.
- **`normalizeSlug(input: string): string`** trims, lower-cases and turns runs of whitespace or `_` into `-`.
- **`validateSlug(slug: string): { ok: true } | { ok: false; reason: 'format' | 'reserved' }`** uses the DB regex and the reserved list from the Schema Reference. Export both as constants.
- **`proxy.ts`:**
  1. Run `updateSession(request)`.
  2. Then, by `resolveHost(request.headers.get('host'), process.env.NEXT_PUBLIC_ROOT_DOMAIN)`:
     - **tenant:** paths starting with `/auth/` or `/_next/` pass through; anything else is rewritten to `/t/<slug><pathname>`. Use `NextResponse.rewrite(url, { request })` and copy every cookie from the `updateSession` response onto it.
     - **unknown:** rewrite to `/not-found`.
     - **root:** a path starting with `/t/` gets a 404.
  3. The matcher is the official one.
- `messages/en.ts` exports `en` (a nested object of strings). `messages/index.ts` exports `m = en`.
- `app/t/[slug]/layout.tsx` loads the organization through the RLS client inside `<Suspense>`. A missing or non-live org calls `notFound()`. A live org gets its branding vars applied to a wrapper `div`.
- `not-found.tsx` shows `m.tenant.unavailable` ("This venue isn't available right now.").

- [ ] **Step 1: Write the failing tests:**
  - **`host.test.ts`** (Review Focus 2), with root `localhost:3000`:

    | Host | Result |
    |---|---|
    | `localhost:3000` | root |
    | `www.localhost:3000` | root |
    | `Dhanmondi-Turf.localhost:3000` | tenant `dhanmondi-turf` |
    | `a.b.localhost:3000` | unknown |
    | `my-app.vercel.app` | root |
    | `admin.localhost:3000` | unknown (reserved) |
    | `null` | root |

    With root `play.example.com`: `turf.play.example.com` → tenant.
  - **`slug.test.ts`** (Review Focus 1):

    | Input | Result |
    |---|---|
    | `normalizeSlug('  Dhanmondi Turf ')` | `'dhanmondi-turf'` |
    | `validateSlug('-turf')` / `('turf-')` | format |
    | `validateSlug('ab')` | format (too short) |
    | `validateSlug('admin')` / `('www')` | reserved |
    | `validateSlug('ধানমন্ডি')` | format |
    | `validateSlug('gulshan-pc-zone')` | ok |
- [ ] **Step 2: Run** `pnpm --filter web test`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules, proxy, tenant layout and not-found.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm --filter web build`. Expected: PASS, and the build succeeds with the proxy.
- [ ] **Step 5: Commit** `feat(web): subdomain routing to tenant sites with strict slug rules`.

### Task 8: Sign-in, callback and staff invites

**Files:**
- Modify: `supabase/config.toml`:
  - `site_url = "http://localhost:3000"`
  - `additional_redirect_urls = ["http://localhost:3000/**", "http://*.localhost:3000/**"]`
  - `[auth.external.google] enabled = false`, with `client_id = "env(GOOGLE_CLIENT_ID)"` and `secret = "env(GOOGLE_CLIENT_SECRET)"`, and a comment on how to enable it
- Create:
  - `apps/web/lib/auth/dal.ts`
  - `apps/web/lib/orgs/invites.ts`
  - `apps/web/components/auth/sign-in-form.tsx`
  - `apps/web/app/(root)/signin/page.tsx`
  - `apps/web/app/t/[slug]/signin/page.tsx`
  - `apps/web/app/auth/callback/route.ts`
  - `apps/web/app/auth/signout/route.ts`
- Test: `apps/web/test/integration/invites.test.ts`

**Interfaces:**
- `dal.ts` (`server-only`):
  - `getUser(): Promise<{ id: string; email: string | null } | null>`, from `getClaims()`
  - `requireUser(next: string): Promise<{ id; email }>`, which calls `redirect('/signin?next=' + encodeURIComponent(next))`
- **Sign-in form** (client component):
  - an email field that calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: \`${location.origin}/auth/callback?next=${next}\` } })` and then shows `m.auth.checkEmail`;
  - a **Continue with Google** button that calls `signInWithOAuth({ provider: 'google', options: { redirectTo: same } })`, rendered only when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true'`.
- **`GET /auth/callback`:**
  1. `exchangeCodeForSession(code)`.
  2. On the root host, `acceptPendingInvites(serviceDb, user.id, user.email)`.
  3. Redirect to `next`. Only same-origin relative paths are allowed; otherwise use `/`.
- `POST /auth/signout` signs out and redirects to `/`.
- **`invites.ts`:**
  - `inviteMember(db, { organizationId, email, role, invitedBy }): Promise<{ status: 'invited' | 'already_member' }>` lower-cases the email and upserts the open invite. It then calls `db.auth.admin.inviteUserByEmail(email, { redirectTo: \`http://${ROOT}/auth/callback?next=/manage\` })`, and ignores the "already registered" error.
  - `acceptPendingInvites(db, userId, email): Promise<number>` turns open, unexpired invites for that email into memberships and sets `accepted_at`.

- [ ] **Step 1: Write the failing test** (integration):
  - `an invite becomes a membership when that email signs in`
  - `expired invites are ignored`
  - `inviting an existing member reports already_member`
  - `acceptance is idempotent`
- [ ] **Step 2: Run** `pnpm test:integration -- invites`. Expected: FAIL.
- [ ] **Step 3: Implement** everything above. Restart Supabase (`pnpm exec supabase stop && pnpm db:start`) for the config changes.
- [ ] **Step 4: Run** `pnpm test:integration && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 5: Smoke test in the browser:** on `localhost:3000/signin`, request an email link, open it from Mailpit (`http://127.0.0.1:54324`), and land signed in. Repeat on `dhanmondi-turf.localhost:3000/signin` once Task 9 has created that org; for now, check that the route renders.
- [ ] **Step 6: Commit** `feat(web): email-link and Google sign-in with invite acceptance`.

### Task 9: Creating and publishing organizations

**Files:**
- Create: `apps/web/lib/orgs/create-organization.ts`, `apps/web/lib/orgs/publish.ts`
- Test: `apps/web/test/integration/organizations.test.ts`

**Interfaces:**
- **`createOrganization(db, { userId, businessType, name, slug }): Promise<{ status: 'created'; organizationId: string; slug: string } | { status: 'invalid_slug'; reason: 'format' | 'reserved' } | { status: 'slug_taken' }>`**
  1. Normalise and validate the slug, and check availability.
  2. Insert, in this order: the organization (`onboarding`; `branding = { primary, accent }` from the preset; `created_by`), the owner membership, a branch named `name` with the default hours, the preset resources on that branch, and the preset activities.
  3. If any later insert fails, delete the organization (cascade) and rethrow.
  4. Map a unique violation on the slug to `slug_taken`.
- **`checkSlug(db, input): Promise<{ status: 'available'; slug } | { status: 'invalid_slug'; reason } | { status: 'slug_taken' }>`**, used by the wizard's live check.
- **`publishOrganization(db, organizationId): Promise<{ status: 'live' } | { status: 'not_ready'; missing: Array<'branch' | 'resource' | 'activity'> }>`**. It needs at least one branch, one active resource and one active activity.
- **`setOrganizationStatus(db, organizationId, status: 'live' | 'suspended')`**, for the platform admin.

- [ ] **Step 1: Write the failing tests:**
  - `creates a turf org with the preset pitches, court and three formats` (2 + 1 resources, 3 activities, owner membership, status `onboarding`)
  - `normalises the slug` (`'  Dhanmondi Turf '` → `dhanmondi-turf`)
  - `reports slug_taken case-insensitively` (Review Focus 1: `'DHANMONDI-TURF'` after the first)
  - `rejects reserved and malformed slugs`
  - `publishing a complete org makes it live`
  - `publishing with every resource deactivated reports missing resource`
- [ ] **Step 2: Run** `pnpm test:integration -- organizations`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): create organizations from presets and publish them`.

### Task 10: Owner admin: branches, resources, activities, staff, settings

**Files:**
- Create:
  - `apps/web/lib/tenancy/dal.ts`
  - `apps/web/lib/opening-hours.ts`
  - `apps/web/components/manage/opening-hours-editor.tsx` (also reused by onboarding in Task 11)
  - `apps/web/lib/forms/{branch,resource,activity}.ts`
  - `apps/web/lib/orgs/members.ts`
  - `apps/web/app/(root)/manage/page.tsx`
  - `apps/web/app/(root)/manage/[slug]/{page,branches/page,resources/page,activities/page,staff/page,settings/page}.tsx`
  - `apps/web/app/(root)/manage/[slug]/actions.ts`
  - components under `apps/web/components/manage/`
- Test: `apps/web/test/forms.test.ts`, `apps/web/test/integration/members.test.ts`

**Interfaces:**
- **`lib/tenancy/dal.ts`** (`server-only`): `requireOrgRole(slug, minRole: 'staff' | 'owner'): Promise<{ user; org: { id; slug; name; status; businessType; branding }; role: 'owner' | 'staff' }>`. It calls `requireUser`, loads the org through the RLS client, and calls `notFound()` when the user isn't a member or is below `minRole`.
- **Form parsers** (zod, pure), each returning `{ ok: true; value } | { ok: false; errors: Record<string, string> }`:
  - `parseBranchForm(formData)` — name, address, and opening hours via `parseOpeningHours`.
- **`lib/opening-hours.ts`:**
  - `type OpeningHours = Record<'0'|'1'|'2'|'3'|'4'|'5'|'6', [string, string] | null>` (0 = Sunday; close ≤ open means closing the next day)
  - `DEFAULT_OPENING_HOURS`: `['10:00', '23:00']` every day, matching the DB default
  - `parseOpeningHours(formData): { ok: true; value: OpeningHours } | { ok: false; errors }`: each weekday is closed or `HH:MM`–`HH:MM`; open must not equal close
  - `parseResourceForm(formData)` — name, kind, capacity 1–30, price via `bdtToPoisha`, which may be empty (→ null).
  - `parseActivityForm(formData)` — for `two_teams`, team size is required and min and max are derived as 2 × size; for `none`, it's min ≤ max.
- **`members.ts`:**
  - `listMembers(db, orgId)`
  - `changeRole(db, orgId, userId, role)`
  - `removeMember(db, orgId, userId)`

  The last two return `{ status: 'ok' } | { status: 'last_owner' }` and never leave an organization with zero owners.
- **Pages:**
  - `/manage` lists the user's organizations.
  - `/manage/[slug]` shows an overview: counts, status, the public link, and a **Publish** button while onboarding.
  - Branches, resources and activities pages have list, add, edit and deactivate, using the RLS client and **owner** only. Deleting an activity that has sessions shows `m.manage.activityInUse` on the FK `23503`.
  - Staff (owner only) has invite, change role and remove.
  - Settings (owner only) has the name, branding and logo, with the slug read-only once live.

- [ ] **Step 1: Write the failing tests:**
  - **`forms.test.ts`:**
    - turf "5-a-side" with team size 5 → min and max 10;
    - `two_teams` without a size → error on `teamSize`;
    - capacity 31 → error;
    - price `'2,500'` → 250000; empty price → null;
    - hours `'23:00'`–`'02:00'` is accepted (overnight).
  - **`members.test.ts`** (Review Focus 5):
    - `removing the only owner reports last_owner`
    - `demoting the only owner reports last_owner`
    - `with two owners one can be removed`
    - `staff can be removed`
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm test:integration -- members`. Expected: FAIL.
- [ ] **Step 3: Implement** the parsers, members lib, DAL, pages and actions.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm test:integration && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owner admin for branches, resources, activities, staff and branding`.

### Task 11: Onboarding wizard

**Files:**
- Create:
  - `apps/web/app/(root)/page.tsx` (moved from `app/page.tsx`: the platform pitch, **Create your venue** and **Sign in**)
  - `apps/web/app/(root)/onboarding/page.tsx`
  - `apps/web/app/(root)/onboarding/actions.ts`
  - components under `apps/web/components/onboarding/`
- shadcn: `pnpm dlx shadcn@latest add card input label select badge`

**Interfaces:**
- **Actions** (each calls `requireUser`, then the Task 9 lib with `createServiceClient()`, then `refresh()`):
  - `checkSlugAction(input)`
  - `createOrganizationAction(formData)`: on `created`, redirect to `/onboarding?org=<slug>&step=branding`
- **Steps** (driven by `?step=`; only the org's owner can view an existing org's steps):
  1. **type** — three cards from `PRESETS` (label, a short description, a starter summary).
  2. **name** — name plus slug, with a debounced `checkSlugAction`. It shows `<slug>.<root>` and the reason on error.
  3. **branding** — logo upload. Use the browser client into `org-assets/<orgId>/logo.<ext>`, then update `branding.logo_path` with the RLS client. Also primary and accent colour inputs.
  4. **branch** — name, address, and the opening-hours editor and `parseOpeningHours` from Task 10.
  5. **review** — the preset resources and activities, linking to `/manage/<slug>/resources` and `/activities`.
  6. **publish** — calls `publishOrganization`. On `not_ready` it lists what's missing; on `live` it links to `http://<slug>.<root>`.

- [ ] **Step 1: Read** `01-app/02-guides/authentication-with-cache-components.md`, `01-app/01-getting-started/07-mutating-data.md` and `01-app/02-guides/forms.md` in the bundled Next docs.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`. Expected: pass, with no uncached-access-outside-Suspense errors.
- [ ] **Step 4: Smoke test with the Playwright MCP.** Sign in, create a "turf" org named "Dhanmondi Turf", see the slug check reject `admin` and accept `dhanmondi-turf`, upload a PNG logo, publish, then open `http://dhanmondi-turf.localhost:3000` and see the branding. Screenshot each step.
- [ ] **Step 5: Commit** `feat(web): self-serve onboarding wizard`.

### Task 12: Open-play schedule

**Files:**
- Create: `apps/web/lib/format.ts`, `apps/web/lib/schedule/time.ts`, `apps/web/lib/schedule/schedule.ts`, `apps/web/app/(root)/manage/[slug]/schedule/page.tsx`, plus a schedule action in `manage/[slug]/actions.ts`
- Test: `apps/web/test/format.test.ts`, `apps/web/test/schedule-time.test.ts`, `apps/web/test/integration/schedule.test.ts`

**Interfaces:**
- **`time.ts`** (pure; uses `zonedTimeToUtc` from `@bm/sim`):
  - `weeklyStarts(first: { date: string; time: string }, weeks: number, timeZone: string): Date[]` — `weeks` must be 1–12, otherwise `RangeError`.
  - `OpeningHours` comes from `lib/opening-hours.ts` (Task 10).
  - `withinOpeningHours(hours: OpeningHours, start: Date, durationMin: number, timeZone: string): boolean` — the slot must fit inside the window that contains its start: that day's window, or the previous day's overnight window.
- **`format.ts`** (pure; also used by Task 13): `formatShortTime(iso, timeZone)` → `'8pm'` / `'8:30pm'`, and `formatNight(iso, timeZone)` → `'Sat 24 Oct, 8pm'`. Both use `Intl.DateTimeFormat('en-GB', …)`, lower-case am/pm and drop `:00`.
- **`schedule.ts`** (`server-only`):
  - `scheduleOpenPlay(db, input: { organizationId; branchId; activityId: string | null; resourceIds: string[]; first: { date; time }; weeks: number; durationMin: number; seatPricePoisha: number; timeZone: string; openingHours: OpeningHours })`
  - Returns `{ status: 'scheduled'; sessionIds } | { status: 'outside_hours'; at: string } | { status: 'clash'; at: string } | { status: 'invalid' }`.
  - It validates every start with `withinOpeningHours` (the first failure → `outside_hours`, with `at` formatted as `'Fri 24 Oct, 8pm'`), then calls the `schedule_open_play` RPC.
  - On `23P01` it finds the first start whose period overlaps an existing reservation on the chosen resources, and returns `clash` with that time.
  - `invalid_reference` → `invalid`.
- `cancelOpenPlay(db, sessionId)` wraps the cancel RPC.
- **Page** (staff or above): upcoming sessions (time, activity, resources, seat price, status, **Cancel**) and a form (branch, activity or "players choose", resource checkboxes, date, time, duration, repeat for N weeks, seat price defaulting to the preset). It shows `clash` / `outside_hours` messages from `m.schedule.*`.

- [ ] **Step 1: Write the failing tests:**
  - **`format.test.ts`:** `formatNight('2026-10-24T14:00:00Z', 'Asia/Dhaka')` → `'Sat 24 Oct, 8pm'`; `formatShortTime('2026-10-24T14:30:00Z', 'Asia/Dhaka')` → `'8:30pm'`.
  - **`schedule-time.test.ts`:**
    - `weeklyStarts({date:'2026-10-23', time:'20:00'}, 3, 'Asia/Dhaka')` → `2026-10-23T14:00:00Z`, `…10-30T14:00Z`, `…11-06T14:00Z`;
    - 0 or 13 weeks → `RangeError`;
    - `withinOpeningHours` with hours `10:00–23:00`: 22:00 + 60 min → true; 22:30 + 60 min → false; a closed day → false;
    - with hours `18:00–02:00`, a 01:00 + 60 min start on the next morning → true.
  - **`schedule.test.ts`** (integration, Review Focus 4):
    - `schedules 4 weekly 5-a-side matches on Pitch 1`
    - `a clash in week 3 schedules nothing and names week 3's time`
    - `outside opening hours is refused before touching the database`
    - `back-to-back matches are allowed`
    - `cancelling frees the slot`
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm test:integration -- schedule`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm test:integration && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): open-play schedule with clash and opening-hours checks`.

### Task 13: Tenant public site and player profiles

**Files:**
- Create: `apps/web/app/t/[slug]/page.tsx`, `apps/web/app/t/[slug]/me/page.tsx`, `apps/web/app/t/[slug]/me/actions.ts`, `apps/web/lib/forms/profile.ts`, `apps/web/lib/profiles/save-profile.ts`
- Test: `apps/web/test/profile-form.test.ts`, `apps/web/test/integration/profiles.test.ts`

**Interfaces:**
- **`parseProfileForm(formData)`** (zod): `displayName` 1–60 characters; `phone` optional, in E.164 form or a BD local number `01XXXXXXXXX`, normalised to `+8801XXXXXXXXX`; `skill` 1–5; `favourites` 0–3 distinct activity ids in rank order; `availability` per weekday, off or `HH:MM`–`HH:MM`; `emailOptIn`.
- **`saveProfile(db /* user-scoped */, { userId, organizationId, input }): Promise<{ status: 'saved'; profileId } | { status: 'unavailable' }>`**:
  1. Upsert the profile on `(organization_id, user_id)` with only the granted columns.
  2. Replace `profile_activities` (ranks 1..n) and `availability`.
  3. An RLS violation (org not live) → `unavailable`.
- **Public page `/`:** branding header (logo, name), branches with today's hours, activities (with team format, e.g. "5 v 5"), and the next 14 days of open play (`formatNight`, activity, seat price `formatBdt`). Plus **Sign in** / **My profile**.
- **`/me`:** `requireUser('/me')`, then the profile form. Skill uses `m.profile.skill[1..5]`, plain-language descriptions from "Just learning" to "Competitive".

- [ ] **Step 1: Write the failing tests:**
  - **`profile-form.test.ts`:** `'01712345678'` → `'+8801712345678'`; `'12345'` → phone error; 4 favourites → error; duplicate favourites → error.
  - **`profiles.test.ts`** (signed-in clients):
    - `a player creates and updates their profile in a live venue`
    - **`a player cannot create a profile in a venue that is still onboarding`** → `unavailable` (Review Focus 3)
    - `a suspended venue refuses new profiles`
    - `a player cannot read another player's profile`
    - `favourites are stored in rank order`
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm test:integration -- profiles`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm test:integration && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 5: Smoke test with the Playwright MCP:** a second user signs in on `dhanmondi-turf.localhost:3000` through an email link from Mailpit, saves a profile with phone `01712345678`, and sees it again after a reload.
- [ ] **Step 6: Commit** `feat(web): tenant public page and player profiles`.

### Task 14: Platform admin

**Files:**
- Create: `apps/web/lib/admin/platform.ts`, `apps/web/app/(root)/admin/page.tsx`, `apps/web/app/(root)/admin/actions.ts`, `apps/web/scripts/grant-platform-admin.mjs`
- Modify: root `package.json` (`"admin:grant": "node apps/web/scripts/grant-platform-admin.mjs"`)
- Test: `apps/web/test/integration/platform-admin.test.ts`

**Interfaces:**
- `isPlatformAdmin(db /* service */, userId): Promise<boolean>`
- `listOrganizations(db): Promise<Array<{ id; slug; name; businessType; status; createdAt; ownerEmail: string | null }>>`
- The `/admin` page calls `requireUser`, then `isPlatformAdmin` (`notFound()` if false). It lists organizations, newest first, with **Suspend** / **Unsuspend**, which call `setOrganizationStatus` from Task 9.
- `pnpm admin:grant <email>` looks up the user by email (admin API) and inserts into `platform_admins`. It prints `granted` or `no such user`.

- [ ] **Step 1: Write the failing tests:**
  - `a normal user is not a platform admin`
  - `a granted user is`
  - `listOrganizations includes the owner's email`
  - `suspending hides the venue from anon reads`: using an anon client, select by slug and get 0 rows
- [ ] **Step 2: Run** `pnpm test:integration -- platform-admin`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:integration && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): platform admin to list and suspend venues`.

### Task 15: Stage A wrap-up

- [ ] **Step 1: Run** `pnpm typecheck && pnpm test && pnpm --filter web build && pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm test:race && pnpm test:integration`. Expected: every command exits 0.
- [ ] **Step 2: Run the full browser journey** (Playwright MCP, screenshots into the workspace). This is the spec's "Done when":
  1. Owner email sign-in → a turf venue is created and published.
  2. Schedule a weekly 5-a-side match.
  3. A second user signs up on the subdomain and saves a profile.
  4. `pnpm admin:grant` the owner, suspend the venue, and see the subdomain show "not available".
  5. Unsuspend it.
- [ ] **Step 3: Update the docs:**
  - `README.md`: setup (`pnpm env:local`, `*.localhost` URLs, `pnpm admin:grant`, enabling Google), the new scripts, and a Numbers row for pgTAP and integration counts.
  - `memory.md`: Stage A decisions, gotchas and the change log.
- [ ] **Step 4: Commit** `docs: Stage A setup and notes`.
