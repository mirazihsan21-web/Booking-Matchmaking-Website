# One Brand R1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today's branches become sections, each with its own rules, games, staff and player ratings, across the database, the server code and the tests. A brand setting and a setup command turn a fresh database into one brand with three working sections.

**Architecture:**
- **Three migrations** change the schema and move existing rows: sections, then games and ratings, then staff per section.
- **Six SQL functions** are recreated for the new names and per-section rules.
- **`lib/`** reads each section's rules and each section's ratings.
- **Staff access:** `private.is_section_staff` scopes staff reads, and server actions check the section.
- **`pnpm brand:setup`** (a Node script around a tested core module) creates or completes the brand from the three presets.
- **Screens:** today's pages change only as much as they must to keep working. R2 and R3 build the new site.

**Tech Stack:** as B2 — Next.js 16.4, Supabase local (pg_cron/pg_net/Vault), Vitest 5, pgTAP; Node 24 type stripping for the setup script. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-25-one-brand-sections-design.md` (§2 data, §3 behaviour, §4 access, §6 setup and data, §7 R1, §8 edge cases). Notes: `memory.md`.

## Global Constraints

- **Branch** `one-brand-r1`, cut from `one-brand-design` (which holds the spec and this plan).
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Run `git branch --show-current` before every commit; another session once shared this folder (memory.md §6).
- **Local stack only:** start Docker Desktop, `pnpm db:start`, then `pnpm env:local` (switches `apps/web/.env.local` from the hosted project to local).
  - This plan does not touch the hosted project.
  - Its rollout (`supabase db push`, `pnpm env:hosted`, `pnpm brand:setup`) waits for the user after merge.
- **Migrations:** `20261025010000_sections.sql`, `20261025010100_section_games_and_ratings.sql`, `20261025010200_section_staff.sql`.
  - Apply with `pnpm exec supabase migration up --local`.
  - Prove replay with `pnpm exec supabase db diff --local --schema public,private`, expecting `No schema changes found`.
- **B1/B2 rules carry over:**
  - RLS and explicit grants on new tables.
  - No `security definer` in `public`; the `private` helpers may be, as today.
  - `search_path = ''`.
  - Booking-flow functions are `service_role` only and return status text.
  - Composite tenant FKs `(x_id, organization_id)`.
  - pgTAP fixtures use relative dates and count only their own ids.
- **Renames:**
  - Database: table `branches` → `sections`; `resources.branch_id` and `open_play_sessions.branch_id` → `section_id`. Every constraint or index name containing `branch` is respelled `section` (a DO loop over the catalog).
  - TypeScript: `branchId` → `sectionId`, `branchDay` → `sectionDay`, `branchName` → `sectionName`; query `?branch=` → `?section=`.
  - Copy: "Branch" → "Section".
- **Section defaults** (spec §2.2):

  | Kind | Name | Slug | Accent |
  |---|---|---|---|
  | `turf` | Turf | `turf` | `#15803D` |
  | `boardgame_cafe` | Board-game café | `cafe` | `#0F766E` |
  | `gaming_lounge` | Gaming lounge | `lounge` | `#7C3AED` |

  - When a slug is taken, the next free `-2`, `-3`… is used.
  - Rules default to 14 days / 120 min / 360 min / 3 bookings.
  - Slug pattern `^[a-z][a-z0-9-]{1,30}$`; reserved: `me signin offers sessions manage auth api book`.
- **Keep today's pages working** after every TypeScript task: typecheck, lint and build. New pages are R2 and R3.
- **Copy** lives in `messages/en.ts`.

## Review Focus

1. **Booking limit per section.** A player who holds the maximum upcoming bookings in the turf can still book the café. Tested in Task 1.
2. **Mixed sections in one schedule.** Spaces from two sections, or a game from another section, are refused with `invalid_reference`, and nothing is written. Tested in Tasks 1 and 2.
3. **Rated in one section, asking in another.** `request_seat` answers `needs_skill` and writes nothing; it succeeds once the player has rated that section. Tested in Task 2.
4. **Staff in two sections, then access removed.** They see both sections' bookings. Once their row for one section is deleted, that section's rows are hidden immediately. Tested in Task 5.
5. **Two sections of the same kind, and reserved words.** `add_section` gives `turf` and then `turf-2`. A reserved or malformed slug is refused by the check. Tested in Task 1.

---

### Task 1: Sections in the database

**Files:**
- Create: `supabase/migrations/20261025010000_sections.sql`, `supabase/tests/database/14_sections.test.sql`
- Modify: every fixture that creates branches or sets the old venue rules (`supabase/tests/database/{01,02,03,05,06,07,11,12,13}_*.test.sql`, `supabase/tests/race/*.test.ts`), plus `01_schema` and `04_grants` assertions

**Interfaces:**
- **Schema** (spec §2.1–2.2):
  - **Rename** as in Global Constraints.
  - **`sections` gains:**
    - `kind public.business_type not null`
    - `slug text not null`
    - `booking_horizon_days smallint not null default 14`
    - `cancel_cutoff_minutes int not null default 120`
    - `match_cutoff_minutes int not null default 360`
    - `max_upcoming_bookings smallint not null default 3`
    - `accent text not null default '#15803D'` (hex check)
    - `position smallint not null default 0`
  - **Constraints on `sections`:** today's checks on the four rules, including match cut-off > cancel cut-off; `unique (organization_id, slug)`; and the slug check (pattern and reserved words).
  - **Data move**, done before setting `not null`:
    - `kind` = the organization's `business_type`;
    - `slug` from `private.section_slug`, in creation order;
    - the four rules copied from the organization;
    - `accent` by kind;
    - `position` = row number by `created_at`.
  - **`organizations`:**
    - add `address text not null default ''`, taken from the first section, then drop `sections.address`;
    - drop the four rule columns and `organizations_cutoffs_check`;
    - `business_type` becomes nullable.
  - **Grants:** anon select gains `address`; authenticated update becomes `(name, branding, address)`.
- **`private.section_slug(p_organization_id uuid, p_kind public.business_type) returns text`:** the first free of the base slug, then `base-2`, `base-3`…
- **`public.add_section(p_organization_id uuid, p_kind public.business_type, p_name text) returns uuid`** (service_role only): slug from `section_slug`, accent by kind, position = max + 1, rules from the column defaults.
- **Recreated functions** (same signatures unless noted):
  - `private.seat_payload`: the payload carries `section_name` (no `branch_name` or `multi_branch`).
  - `public.book_resource`:
    - the limit is the space's section `max_upcoming_bookings`;
    - it counts that profile's upcoming confirmed bookings **in the same section**;
    - the payload carries `section_name`.
  - `public.cancel_resource_booking`: the payload carries `section_name`.
  - `public.create_offer`: the offer time comes from the session's section.
  - `public.schedule_open_play`: **dropped and recreated** with `p_section_id` replacing `p_branch_id`. It raises `invalid_reference` unless the section belongs to the organization and every resource belongs to that section.
  - `public.sessions_due_for_matching`: uses each session's section cut-off.

- [ ] **Step 1: Write the failing tests** (`14_sections.test.sql`, relative dates; one org created with `add_section`).
  - **`add_section`:** turf, café and turf again → slugs `turf`, `cafe`, `turf-2`; accents by kind; positions 1, 2, 3 (RF5).
  - **Checks:** setting a slug to `manage` or `Turf`, setting `match_cutoff_minutes` ≤ `cancel_cutoff_minutes`, and setting `accent` to `'green'` each fail with `23514`.
  - **Booking limit per section (RF1):** with turf `max_upcoming_bookings = 1` and one upcoming turf booking, a second turf booking → `limit_reached`; a café booking for the same player → `booked`.
  - **Payload:** the `booking_confirmed` payload has `section_name = 'Turf'` and no `branch_name` key.
  - **Offer time:** with the section's `offer_ttl_seconds = 600`, `create_offer` sets `expires_at = now() + 600 s`.
  - **Mixed schedule (RF2):** `schedule_open_play` with one turf space and one café space throws `invalid_reference`, and no session is created.
  - **`01_schema`:** has `sections` and not `branches`; has `organizations.address`; no `organizations.max_upcoming_bookings`; has every new `sections` column.
  - **`04_grants`:** anon can select `organizations.address`; authenticated can update `address`; the old `max_upcoming_bookings` assertion is removed.
  - **Every other fixture:** `public.branches (…)` becomes `public.sections (…, kind, slug)`; old venue rules move to the section insert; schedule calls use `p_section_id`.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: 14 fails because `sections` doesn't exist.
- [ ] **Step 3: Before migrating, record the existing data:** save `select o.slug, b.name, b.address, b.opening_hours, b.offer_ttl_seconds, o.booking_horizon_days, o.cancel_cutoff_minutes, o.match_cutoff_minutes, o.max_upcoming_bookings from branches b join organizations o on o.id = b.organization_id order by 1, 2` to the workspace.
- [ ] **Step 4: Implement the migration** and apply it.
- [ ] **Step 5: Check the data move:** the same query against `sections` (with the rules now read from the section, and the address from the organization) gives identical rows.
- [ ] **Step 6: Run** `pnpm db:test && pnpm db:lint && pnpm test:race`. Expected: PASS. The web integration suite stays red until Tasks 3–4; note that in the ledger.
- [ ] **Step 7: Commit** `feat(db): sections with their own rules (renamed from branches)`.

### Task 2: Games and ratings per section in the database

**Files:**
- Create: `supabase/migrations/20261025010100_section_games_and_ratings.sql`, `supabase/tests/database/15_section_ratings.test.sql`
- Modify: every fixture that inserts `player_profiles` with `skill` or inserts `activities` (pgTAP and race); `01_schema`

**Interfaces:**
- **`activities.section_id uuid not null`:** backfilled with the organization's earliest section; composite FK `(section_id, organization_id)` → `sections`, `on delete no action`; indexed.
- **`profile_section_skills (organization_id, profile_id, section_id, skill smallint check (skill between 1 and 5))`:**
  - primary key `(profile_id, section_id)`;
  - composite FKs to the profile and the section, both `on delete cascade`;
  - indexed on `(section_id)` and `(organization_id)`.
  - **RLS:** select own rows, or any member of the org; insert, update and delete own rows (`private.is_own_profile`).
  - **Grants:** select, insert, update (`skill`) and delete to authenticated; all to service_role.
- **Backfill** `player_profiles.skill` into a rating for every section of the profile's organization, then drop `player_profiles.skill`.
- **Recreated functions:**
  - `public.request_seat`: after the `already` checks, returns **`needs_skill`** (writing nothing) when the profile has no rating for the session's section.
  - `public.schedule_open_play`: a fixed activity must belong to `p_section_id`, else `invalid_reference`.
  - `public.apply_match`: each group's activity must belong to the session's section, else `invalid_match`.
  - `public.sessions_due_for_matching`: the minimum group size comes from the **section's** active activities.

- [ ] **Step 1: Write the failing tests** (`15_section_ratings.test.sql`).
  - **Ratings and RLS:**
    - a player inserts and updates their own rating;
    - writing another player's rating fails (`42501`, or the policy hides it);
    - a skill of 0 or 6 fails with `23514`;
    - a second rating for the same section fails with `23505`.
  - **Tenancy:** an activity pointing at another organization's section fails with `23503`.
  - **`needs_skill` (RF3):** a player rated only for turf → `request_seat` on a café session answers `needs_skill` and no `seat_requests` row exists. After a café rating is inserted → `requested`.
  - **Games across sections (RF2):**
    - `schedule_open_play` with a café game on the turf section throws `invalid_reference`;
    - `apply_match` on a turf session with a café game throws `invalid_match`.
  - **Cut-off per section:** turf cut-off 60 min, café 600 min, both sessions 2 h ahead with enough requests → `sessions_due_for_matching` returns the café session and not the turf one.
  - **Smallest group per section:** a players-choose café session with 2 requests is due (Azul needs 2), not held back by turf's 10.
  - **`01_schema`:** has `profile_section_skills` and `activities.section_id`; no `player_profiles.skill`.
  - **Fixtures:** profile inserts lose `skill`, and tests that depend on skills insert ratings instead; activity inserts gain `section_id`.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: 15 fails because the table doesn't exist.
- [ ] **Step 3: Implement the migration** and apply it.
- [ ] **Step 4: Check the move:** every pre-existing profile has one rating per section of its organization, equal to its old skill (record the old skills before migrating).
- [ ] **Step 5: Run** `pnpm db:test && pnpm db:lint && pnpm test:race`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(db): games and player ratings per section`.

### Task 3: The web app on sections (bookings, schedule, manage, onboarding, notifications)

**Files:**
- Create: `apps/web/lib/sections/sections.ts`, `apps/web/lib/forms/section.ts` (replaces `lib/forms/branch.ts`, reusing the booking-rules parsing of `lib/forms/booking-settings.ts`), `apps/web/test/integration/sections.test.ts`
- Modify:
  - `lib/`: `bookings/bookings.ts`, `schedule/schedule.ts`, `notifications/render.ts`, `notifications/deliver.ts`, `orgs/create-organization.ts`, `orgs/publish.ts`, `admin/platform.ts`, `tenancy/{dal,org}.ts`;
  - manage pages: `app/(root)/manage/[slug]/{actions.ts, page.tsx, layout.tsx, settings/page.tsx, resources/page.tsx, activities/page.tsx, bookings/page.tsx, schedule/{page.tsx,actions.ts}}`, with `branches/` → **`sections/page.tsx`**;
  - other pages: `app/(root)/onboarding/page.tsx`, `app/t/[slug]/{page.tsx, book/{page.tsx,actions.ts}, me/bookings/page.tsx}`, `messages/en.ts`;
  - tests: `test/notifications-render.test.ts`, `test/booking-settings-form.test.ts` and the integration tests `bookings`, `deliver`, `schedule`, `notifications`, `organizations`, `members`, `invites`, `platform-admin`

**Interfaces:**
- **`lib/sections/sections.ts`:**
  - `interface SectionRules { bookingHorizonDays: number; cancelCutoffMinutes: number; matchCutoffMinutes: number; maxUpcomingBookings: number; offerTtlSeconds: number }`
  - `interface Section { id: string; organizationId: string; slug: string; name: string; kind: BusinessType; accent: string; position: number; openingHours: OpeningHours; rules: SectionRules }`
  - `loadSections(db, organizationId): Promise<Section[]>`, ordered by position, then name.
  - `loadSection(db, { organizationId, sectionId }): Promise<Section | null>`. A malformed or foreign id → `null`.
  - `sectionOfResource(db, resourceId): Promise<Section | null>` and `sectionOfSession(db, sessionId): Promise<Section | null>`.
- **`bookings.ts`:**
  - The booking window and cancel cut-off come from the space's section.
  - `branchDay` → `sectionDay`, with the same parameters except `branchId` → `sectionId`.
  - `MyBooking.branchName` → `sectionName`.
- **`schedule.ts`:** `ScheduleInput.branchId` → `sectionId` (RPC `p_section_id`); opening hours come from that section.
- **`render.ts`:** the space line is always "Pitch 1 (Turf)", from `section_name`.
- **`createOrganization`** (onboarding stays until R2): creates the organization, calls `add_section(org, businessType, name)`, and seeds the preset spaces and games with `section_id`. Profiles get no skill.
- **Manage screens:**
  - The Settings page loses its Bookings card.
  - **`/manage/[slug]/sections`** replaces Branches. Each section has name, hours and booking rules (`saveSectionAction(slug, sectionId, _state, form)`: name, opening hours, `horizonDays`, `cancelCutoffHours`, `matchCutoffHours`, `maxUpcoming`).
  - **Add section:** kind and name, via `add_section`; owner only. Delete keeps today's "in use" refusal.
  - The Spaces and Formats forms choose a **section** (new games need `section_id`).

- [ ] **Step 1: Write the failing tests.**
  - **`sections.test.ts`:** `loadSections` returns Turf then Café, with their rules; `loadSection` with another org's section id → `null`.
  - **`bookings`:**
    - café `bookingHorizonDays = 3` refuses a booking 5 days ahead (`beyond_horizon`), while the turf (14) accepts it;
    - the cancel cut-off comes from the space's section;
    - My bookings rows carry `sectionName`.
  - **`notifications-render`:** `booking_confirmed` with `section_name: 'Turf'` → "Pitch 1 (Turf), Fri 23 Oct, 8pm–9pm. Pay ৳2,500 at the venue."
  - **`organizations`:** `createOrganization` for a turf venue → one section of kind `turf` with slug `turf`; all preset spaces and games carry that `section_id`.
  - **`schedule`:** a schedule naming another section's space → `invalid`.
  - **Every other listed integration fixture:** sections with kind and slug, ratings instead of skill, rules on the section.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm test:integration -- sections bookings schedule organizations`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**
  ```
  pnpm typecheck && pnpm --filter web lint && pnpm --filter web test
  pnpm test:integration -- sections bookings deliver schedule notifications organizations members invites platform
  ```
  Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): bookings, schedule and manage pages on sections`.

### Task 4: Open play and profiles on section ratings

**Files:**
- Modify:
  - `lib/`: `open-play/open-play.ts`, `forms/profile.ts`, `profiles/save-profile.ts`;
  - pages: `app/t/[slug]/me/{page.tsx,actions.ts}`, `app/t/[slug]/sessions/[id]/actions.ts`, `app/(root)/manage/[slug]/sessions/[id]/page.tsx`, `messages/en.ts`;
  - tests: `test/profile-form.test.ts` and the integration tests `open-play`, `tick`, `profiles`

**Interfaces:**
- **`RequestOutcome`** gains `'needs_skill'`.
- **`matchSession`:**
  - Skills come from `profile_section_skills` for the session's section. A missing rating is treated as 3; comment that requests require a rating, so this only covers rows from before the migration.
  - Activities are the fixed one, or the section's active ones.
- **`offerNext` and `staffSessionView`:** skills come from the section's ratings; `needed` comes from the section's active activities.
- **Cancel cut-offs** (`cancelSeat`, `playerSessionView.cancellable`, `listMySeats.cancellable`) come from the session's section.
- **`ProfileInput`:** drops `skill` and adds `ratings: Record<string, number>` (section id → 1–5).
- **`parseProfileForm(formData, sectionIds: string[])`:** reads `rating.<sectionId>`. `''` means not rated; otherwise the value must be 1–5 (`m.profile.pickSkill`). Unknown keys are ignored.
- **`saveProfile`:** replaces the profile's ratings with `input.ratings`, limited to the organization's sections.
- **`/me` page:** one select per section, "How good are you at <section name>?", with a "Not rated" option.
- **Session page:** on `needs_skill` the message is `m.openPlay.outcome.needs_skill` ("Rate your level for this section on your profile first."), with a link to `/me`.

- [ ] **Step 1: Write the failing tests.**
  - **`profile-form`:** two ratings parsed; `''` skipped; `7` rejected; an unknown section key ignored.
  - **`profiles`:**
    - saving two ratings, then only one, leaves one;
    - another organization's section id is ignored;
    - no `skill` column is written.
  - **`open-play`:**
    - **RF3, end to end:** `requestSeat` → `needs_skill` without a rating, then `requested` after `saveProfile` adds one.
    - **Ratings by section:** after `matchSession` on a turf session where players are rated turf 5 and café 1, `staffSessionView` team skill totals equal the sum of the **turf** ratings.
    - **Cut-off by section:** the cancel cut-off follows the session's section (café 30 min: a player can cancel 1 h before; turf 120 min: they can't).
  - **`tick`:** fixtures use ratings.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm test:integration -- open-play profiles tick`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm typecheck && pnpm --filter web lint && pnpm --filter web test && pnpm test:integration`. Expected: PASS (the whole integration suite).
- [ ] **Step 5: Commit** `feat(web): open play and profiles use per-section ratings`.

### Task 5: Staff per section

**Files:**
- Create: `supabase/migrations/20261025010200_section_staff.sql`, `supabase/tests/database/16_section_staff.test.sql`, `apps/web/lib/tenancy/sections-access.ts`
- Modify:
  - `lib/`: `tenancy/dal.ts`, `orgs/invites.ts`, `orgs/members.ts`;
  - manage pages: `app/(root)/manage/[slug]/{actions.ts, staff/page.tsx, bookings/page.tsx, bookings/actions.ts, schedule/{page.tsx,actions.ts}, sessions/[id]/{page.tsx,actions.ts}}`, `messages/en.ts`;
  - tests: `test/integration/{members,invites}.test.ts`

**Interfaces:**
- **`section_staff (organization_id, section_id, user_id)`:**
  - primary key `(section_id, user_id)`;
  - composite FK to the section (`on delete cascade`); `user_id` → `auth.users` (`on delete cascade`);
  - indexed on `(user_id)` and `(organization_id)`.
  - **RLS:** select own rows, or as the org's owner. There are no direct writes (service_role only).
  - **Backfill:** every `staff` member gets a row for every section of their organization.
- **`organization_invites.section_ids uuid[] not null default '{}'`:** check `(role = 'owner' and cardinality(section_ids) = 0) or (role = 'staff' and cardinality(section_ids) > 0)`. Pending staff invites are backfilled with all sections first.
- **Helpers** (`private`, `security definer`, `stable`, `search_path = ''`):
  - `is_section_staff(section uuid) returns boolean`: the section's org owner, or a `section_staff` row for `auth.uid()`;
  - `is_session_staff(session uuid)` and `is_resource_staff(resource uuid)`: the same, through the row's section.
- **Policies:** member reads become section-staff reads.
  - Through the session: `seat_requests_select`, `bookings_select`, `waitlist_entries_select`, `events_select` (an event with no session is visible to the owner only).
  - Through the group's session: `seat_offers_select`.
  - Through the resource: `resource_bookings_select`, `resource_reservations_select`.
  - Players' own-row access is unchanged.
- **Server code:**
  - `canManageSection(db, { organizationId, userId, sectionId }): Promise<boolean>` and `allowedSectionIds(db, { organizationId, userId }): Promise<string[]>` (the owner gets all) in `lib/tenancy/sections-access.ts`, with no `server-only` so they can be tested.
  - `requireSectionStaff = cache(async (slug, sectionId) => …)` in `dal.ts` uses `canManageSection` and fails like `requireOrgRole` (not found).
  - **`inviteMember`** gains `sectionIds: string[]`: required and the org's own for staff, ignored for an owner. `acceptPendingInvites` creates the `section_staff` rows.
  - **`changeRole`:** owner → staff gives every section; staff → owner deletes their section rows.
  - **Actions:** bookings (walk-in, cancel, attendance), schedule (schedule, cancel session) and sessions (Match now, staff cancel seat) call `requireSectionStaff` for the section they affect.
  - **Pages:** the bookings day view and the schedule list show only allowed sections. A staff member with none sees `m.manage.noSections` ("You haven't been assigned to a section yet. Ask the owner."). The staff invite form gets section checkboxes, all ticked by default.

- [ ] **Step 1: Write the failing tests.**
  - **`16_section_staff.test.sql`:**
    - turf staff count turf rows in `bookings`, `resource_bookings`, `seat_requests`, `waitlist_entries` and `seat_offers`, and 0 café rows;
    - the owner sees both;
    - staff with no rows see none;
    - **RF4:** staff in both sections see both; after their café row is deleted, café rows are hidden;
    - staff read their own `section_staff` rows only, and an insert fails with `42501`;
    - a staff invite with empty `section_ids`, or an owner invite with some, fails with `23514`.
  - **`members` and `invites`:**
    - an invite with sections, once accepted, creates `section_staff` rows;
    - `changeRole` both ways behaves as specified;
    - `canManageSection` is false for another section and true for the owner;
    - `allowedSectionIds` for the owner is all sections.
- [ ] **Step 2: Run** `pnpm db:test && pnpm test:integration -- members invites`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration and the code.
- [ ] **Step 4: Run** `pnpm db:test && pnpm db:lint && pnpm typecheck && pnpm --filter web lint && pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: staff assigned per section`.

### Task 6: The brand setting and `pnpm brand:setup`

**Files:**
- Create: `apps/web/lib/tenancy/brand.ts`, `apps/web/scripts/brand-setup-core.mjs`, `apps/web/scripts/brand-setup.mjs`, `apps/web/test/integration/brand.test.ts`
- Modify:
  - `apps/web/scripts/write-env-local.mjs`: writes `BRAND_SLUG=demo-brand`.
  - `apps/web/scripts/write-env-hosted.mjs`: keeps `BRAND_SLUG` (default `chattoturf`) and sets `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` from the hosted `/auth/v1/settings` (`external.google`).
  - `apps/web/.env.example`, and `brand:setup` in both `package.json` files.

**Interfaces:**
- **`brand.ts`:**
  - `interface Brand { id; slug; name; address; timezone; branding; sections: Section[] }`
  - `loadBrand(db, slug): Promise<Brand | null>`: `null` unless the brand exists and is `live`.
  - `getBrand = cache(() => loadBrand(createServiceClient(), process.env.BRAND_SLUG))`: server-only, used from R2 on.
- **`setupBrand(db, { slug, name?, presets, ownerEmail?, demo? })`** returns `{ brand: 'created' | 'existing'; sectionsAdded: string[]; owner: 'member' | 'invited' | 'already' | null; demo: { players: number; sessions: number } | null }`. `presets` is the turf, café and lounge presets; the core module receives them, it doesn't import TypeScript.
  1. **Brand:** created `live` when missing (`name` required then).
  2. **Sections:** for each kind in the order turf, `boardgame_cafe`, `gaming_lounge` with no section yet: `add_section`, plus that preset's spaces and games in it. Existing sections are never touched.
  3. **Owner:** if an auth user has that email → upsert an `owner` membership; otherwise create a pending `owner` invite.
  4. **Demo** (`demo: true`):
     - 12 players `demo-<slug>-<n>@example.test` (`auth.admin.createUser`, confirmed), each rated in all three sections, cycling skills 1–5;
     - **for each section without sessions:**
       - turf: 5-a-side, 2 days ahead at 20:00 Dhaka on its first pitch, with 11 requests;
       - café: players choose, 2 days ahead at 19:00 on Tables 1–2, with 6 requests;
       - lounge: Valorant 5v5, 3 days ahead at 21:00 on PC Zone A, with 6 requests.
     - Sessions are made with `schedule_open_play` and requests with `request_seat`.
- **CLI:** `pnpm brand:setup [--name <name>] [--owner <email>] [--demo]`.
  - Reads `apps/web/.env.local` (URL, secret key, `BRAND_SLUG`).
  - Imports `presets/{turf,boardgame,lounge}.ts` directly.
  - Prints the report.
  - `--demo` refuses unless the Supabase URL is local (`127.0.0.1` or `localhost`).

- [ ] **Step 1: Write the failing tests** (`brand.test.ts`, a unique slug per run, with cleanup).
  - **First run:** `setupBrand` with name `'Test Arena'` → `brand: 'created'`, `sectionsAdded` `['turf','cafe','lounge']`; spaces 3 / 7 / 4 and games 3 / 8 / 4 per section; accents by kind; positions 1–3.
  - **Second run:** `'existing'`, `sectionsAdded: []`, no new spaces or games.
  - **Owner:** an email with no account → `'invited'` (an owner invite with empty `section_ids`); an existing user → `'member'`.
  - **Demo:**
    - 12 players, each with 3 ratings;
    - one session per section;
    - `matchSession` on the turf demo game → `'matched'`, proving the sections work through `lib/`.
  - **`loadBrand`:** the brand with 3 ordered sections; a brand that isn't live → `null`.
- [ ] **Step 2: Run** `pnpm test:integration -- brand`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm typecheck && pnpm --filter web test && pnpm test:integration`. Then `pnpm brand:setup --name "Demo Arena" --demo` twice against local: the second run reports nothing new.
- [ ] **Step 5: Commit** `feat: brand setting and pnpm brand:setup`.

### Task 7: R1 wrap-up

- [ ] **Step 1: Run the full suite:**
  ```
  pnpm typecheck && pnpm test && pnpm --filter web lint && pnpm --filter web build && \
    pnpm db:test && pnpm db:lint && pnpm test:race && pnpm test:integration
  ```
  Then the replay diff. Expected: everything passes, and `No schema changes found`.
- [ ] **Step 2: Fresh local brand** (spec §6; replaces the old demo venue, as the user approved):
  1. `pnpm db:reset`
  2. `pnpm env:local`
  3. `pnpm brand:setup --name "Demo Arena" --demo`
  4. Start the dev server and check today's pages: the owner sees three sections under Sections; a demo game in each section shows on the venue page.
- [ ] **Step 3: Docs.**
  - README: sections, `BRAND_SLUG`, `pnpm brand:setup`, and the hosted rollout steps for after merge.
  - memory.md: R1 rulings, gotchas and the change log.
- [ ] **Step 4: Commit** `docs: one-brand R1 notes`.
