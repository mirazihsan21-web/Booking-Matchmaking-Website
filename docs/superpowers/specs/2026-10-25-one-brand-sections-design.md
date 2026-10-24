# One Brand, Three Sections — Design

**Status:** design approved section by section in conversation on 2026-10-25; this document awaits the user's review.
**Builds on:** `main` at `e6894ff` — Stage A (platform foundation), B1 (bookings, notifications, jobs) and B2 (open play, matching, seat offers) merged; Google sign-in live on the hosted project `rhycdpswtiitjhzoczfq`.
**Supersedes:** the multi-business direction of `2026-10-20-booking-platform-design.md` (self-serve venues, per-venue subdomains, platform admin). Everything about bookings and matchmaking in that spec and in `2026-10-20-stage-b-booking-matchmaking-design.md` still holds, with "branch" read as "section" (§2).

## 1. Goal and decisions

The product becomes **one client's own website**: one brand running a **turf**, a **board-game café** and a **gaming lounge** in one place, with one sign-in and one player profile across all three.

| Topic | Decision (user, 2026-10-25) |
|---|---|
| Whose business | One client's business. Not offered to other businesses afterwards. |
| Locations | All three sections in one place. |
| Approach | **A** — evolve what is built: today's branches become sections, the organization row becomes the brand. (Rejected: three venues behind one front page; a from-scratch single-business rebuild.) |
| Staff | Assigned per section; the owner sees and manages everything. |
| Player skill | Rated per section (turf, board games, gaming). |
| Hours and rules | Each section sets its own opening hours and booking rules. |
| Look | The client's brand everywhere, plus an accent colour and its own wording per section. |
| Sign-in | Google (live) and email link. |

**Design rulings (mine, approved with the sections):**
1. The database **renames** `branches` to `sections` (and `branch_id` to `section_id`) rather than renaming only on screen.
2. The hidden `organization_id` columns **stay**; the brand is one organizations row. The website always serves the brand named by the server-only setting `BRAND_SLUG` (in `.env.local`, written by `pnpm env:local` / `pnpm env:hosted`), so test suites keep creating their own isolated organizations without a rewrite.
3. Existing local demo data is replaced by a fresh demo brand; hosted data is migrated (§6).

## 2. Data model (new migrations only)

### 2.1 The brand — `organizations` (one row in use)
- Keeps: `slug` (internal key matched by `BRAND_SLUG`), `name`, `branding` (`logo_path`, `primary`, `accent`), `currency` `BDT`, `timezone` `Asia/Dhaka`, `created_by`.
- **Adds** `address text not null default ''` (all sections are at one place; copied from the brand's first branch by the migration).
- **Moves to sections, then drops:** `booking_horizon_days`, `cancel_cutoff_minutes`, `match_cutoff_minutes`, `max_upcoming_bookings`.
- `business_type` and `status` stay in the table but the website no longer reads them (each section has its own kind; the brand is served while `status = 'live'`, which the setup command sets).

### 2.2 `sections` (renamed from `branches`)
| Column | Notes |
|---|---|
| `id`, `organization_id`, `created_at` | unchanged |
| `name` | e.g. "Turf", "Board-game café", "Gaming lounge" — editable |
| `slug` | URL segment, `^[a-z][a-z0-9-]{1,30}$`, unique per organization, not one of the reserved words `me signin offers sessions manage auth api book` |
| `kind` | `public.business_type` (`turf` / `boardgame_cafe` / `gaming_lounge`) — chooses starter catalogue and wording |
| `opening_hours` | unchanged (overnight hours work as today) |
| `offer_ttl_seconds` | unchanged |
| `booking_horizon_days`, `cancel_cutoff_minutes`, `match_cutoff_minutes`, `max_upcoming_bookings` | moved from the brand with the same checks, including match cut-off > cancel cut-off |
| `accent` | hex colour `^#[0-9A-Fa-f]{6}$`; default from the kind (turf `#15803D`, café `#0F766E`, lounge `#7C3AED`) |
| `position` | display order (smallint) |
| `address` | **dropped** (moved to the brand) |

- `resources.branch_id` → `resources.section_id`; `open_play_sessions.branch_id` → `open_play_sessions.section_id` (composite tenant FKs renamed accordingly).
- **`activities` gain `section_id uuid not null`** (composite FK `(section_id, organization_id)`, `on delete no action` like other history-bearing references): each game or format belongs to one section.
- Every SQL function, policy or view whose body names `branches`/`branch_id` is recreated in the same migration (renames don't rewrite function source). The R1 plan lists them from a grep of the migrations.

### 2.3 Staff
- `organization_members.role` stays `owner | staff`.
- **New `section_staff (organization_id, section_id, user_id)`**, primary key `(section_id, user_id)`, composite FKs. A staff member with no rows can do nothing.
- **`organization_invites` gains `section_ids uuid[] not null default '{}'`**: required non-empty for `staff`, empty for `owner`. Accepting creates the membership and the `section_staff` rows.

### 2.4 Players
- **New `profile_section_skills (organization_id, profile_id, section_id, skill)`**, `skill smallint` 1–5, primary key `(profile_id, section_id)`.
- `player_profiles.skill` is copied into it (§6) and then **dropped**.
- `profile_activities` (favourites) and `availability` are unchanged; favourites fall per section because games do.

### 2.5 Unchanged in shape
`resource_reservations`, `resource_bookings`, `seat_requests`, `groups`, `bookings`, `waitlist_entries`, `seat_offers`, `notifications`, `events`. Notification payloads replace `branch_name`/`multi_branch` with **`section_name`**, always shown: "Pitch 1 (Turf), Fri 23 Oct, 8pm–9pm".

## 3. Behaviour that moves to sections

- **Space bookings** use the space's section for opening hours, booking window, cancel cut-off and booking limit; **the limit counts upcoming bookings in that section**.
- **Open play** uses the session's section for the match cut-off (`sessions_due_for_matching`), the cancel cut-off and the offer time.
- **Matching** (`planMatch`) and **refills** (`offerNext`, `rankWaitlist`) read each player's skill for the session's section from `profile_section_skills`.
- **A player with no rating for that section** gets `needs_skill` from `requestSeat` (no request is written); the session page then asks for a level 1–5, saves it, and retries. Space bookings don't need a rating.
- Schedules (`schedule_open_play`) take a section; spaces and games in a schedule must belong to that section.

## 4. Access

| Who | Can do |
|---|---|
| **Owner** | Everything in every section; brand settings; staff and invitations. |
| **Staff** | In their assigned sections only: day view, walk-ins, attendance, cancelling bookings and seats, scheduling, Match now, cancelling games. |
| **Player** | Own profile, ratings, bookings, seats, notifications. |
| **Visitor** | Brand home, section pages, games coming up (counts only), offer links. |

- **Setup** (spaces, games, section hours/rules/accent, brand settings, staff) is owner-only; **day-to-day work** is open to a section's staff. Same split as today.
- **The database enforces it:** a new helper `private.is_section_staff(section uuid)` (owner of the section's brand, or a `section_staff` row) guards every staff read and write of section-owned rows; owner-only writes keep `private.is_org_owner`. Server actions check first (`requireOwner()`, `requireSectionStaff(sectionId)`) and then use the service client, as today.
- **Privacy is unchanged:** no player sees another's phone; other players' names only within one's own game; staff see a player's name and a walk-in's name and phone.
- **The first owner** is made by the setup command (§6) from the client's owner email; more owners and staff are invited from **Staff**. One account can be staff and a player.

## 5. The website

One site on the client's domain (locally `http://localhost:3000`). **No subdomains**: `proxy.ts` stops routing `<slug>.<root>` and serves the brand at the root.

**Public:**
| Address | Content |
|---|---|
| `/` | Brand home: logo, name, address; three section cards (accent colour, today's hours, next game, **See games**, **Book**). |
| `/<section>` | Section page: games coming up with seats left, what you can play, hours, **Book a space**. |
| `/<section>/book` | Book a space in that section (today's `/book`, section instead of branch). |
| `/sessions/<id>` | A game: request a seat (rating prompt if needed), team, cancel. |
| `/offers/<token>`, `/me/offers/<id>` | Seat offers (unchanged). |
| `/signin` | Google + email link. |
| `/me` | Profile with **one rating per section**, favourites grouped by section, availability. |
| `/me/bookings`, `/me/notifications` | Across all sections; each row names its section. |

Header: brand logo and name · **Turf · Café · Lounge** (section names) · My bookings · Profile · bell. Section pages use the section's accent and its kind's wording ("open matches", "game nights", "squad sessions").

**Owner and staff — `/manage`:**
- A **section switcher** (owner: all; staff: theirs). `/manage` opens the first allowed section.
- Per section: `/manage/<section>` overview, `…/schedule`, `…/bookings`, `…/spaces`, `…/games`, `…/settings` (owner).
- `/manage/sessions/<id>`; owner-only `/manage/brand` and `/manage/staff`.

**Removed:** the platform landing page, `/onboarding`, the "Your venues" list, `/admin` and the `platform_admins` checks in the UI, the `/t/[slug]` and unavailable-host routes. An unknown section address is a 404.

## 6. Setup and existing data

**`pnpm brand:setup`** (service key; local or hosted via `.env.local`), idempotent:
1. Ensures the brand named by `BRAND_SLUG` exists and is `live`.
2. Ensures one section of each kind exists — default names/slugs Turf `/turf`, Board-game café `/cafe`, Gaming lounge `/lounge` — and seeds a **new** section with its kind's starter spaces and games (`presets/`). Existing sections are never touched.
3. With `--owner <email>`: makes that user an owner, or creates an owner invitation if they haven't signed in yet.
4. With `--demo` (local only): adds sample players with ratings and a few scheduled games.

**Migration of existing rows** (generic, in the R1 migration):
- Each branch becomes a section: `kind` = its organization's `business_type`, `slug` from the kind (suffix `-2`… if taken), rules copied from the organization, `accent` from the kind.
- Each organization's `address` = its first branch's address. Activities get `section_id` = the organization's earliest section.
- Every staff member gets `section_staff` rows for all sections of their organization (no one loses access).
- Every profile's `skill` is copied to `profile_section_skills` for each section of its organization.

**Hosted:** after the migration, `BRAND_SLUG=chattoturf`; Chattoturf's branch is the **Turf** section; `pnpm brand:setup` adds the café and lounge sections with starter catalogues. The owner renames the brand when the client's name is known.
**Local:** `pnpm db:reset` + `pnpm brand:setup --demo` replaces the old demo venue and test leftovers with a demo brand.

## 7. Build stages

Each stage gets its own plan, TDD build, fresh whole-branch review and merge — like Stages A and B.

1. **R1 — Foundation:** §2 migrations and the data move; §4 database rules and helpers; §3 behaviour in SQL and `lib/` (section rules, section skills, `needs_skill`); `pnpm brand:setup`; `BRAND_SLUG`; all existing tests updated. *Done when* the suites pass, turf staff are refused café rows at the database, and a fresh `db:reset` + `brand:setup --demo` yields three working sections through the existing `lib/` functions.
2. **R2 — Public website:** §5 public routes and header, single-host proxy, profile ratings, My bookings across sections; removal of onboarding, venue list, admin and `/t/[slug]`. *Done when* a player signs in once and books a space and joins a game in each section in a real browser.
3. **R3 — Manage area:** section switcher, per-section pages, section settings, brand settings, staff invited to sections. *Done when* a turf staff member sees and changes only the turf, and the owner manages all three.

Then Stage C (bKash) and Stage E (going live) continue on this structure.

## 8. Edge cases the tests must cover

- **Staff isolation:** turf staff are refused café sessions, bookings, walk-ins, schedules and Match now (database and actions); an owner is allowed everywhere; staff with no sections see "no sections assigned".
- **Rules per section:** the same player hits the café's booking window but not the turf's; the booking limit counts per section; each section's match cut-off triggers its own matching.
- **Ratings:** matching a section uses that section's ratings; `needs_skill` writes nothing and succeeds after rating; a rating for one section doesn't affect another.
- **Migration:** a branch with hours, rules, staff and profiles becomes one section with copied rules, `section_staff` rows and ratings; replaying all migrations from scratch matches the local DB.
- **Setup command:** running it twice creates nothing new; an owner email without an account becomes an invitation.
- **Addresses:** a section slug can't be a reserved word; an unknown section is a 404.

## 9. Not in this redesign

bKash payments (Stage C), deployment and the client's domain (Stage E), more locations, per-section payment accounts, custom domains, other clients, Bangla UI, SMS.
