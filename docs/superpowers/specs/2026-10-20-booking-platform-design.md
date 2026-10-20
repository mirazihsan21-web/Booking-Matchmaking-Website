# Booking & Matchmaking Platform: Design

**Status:** Draft for review (2026-10-20). This spec supersedes the portfolio-demo spec `2026-10-20-booking-matchmaking-design.md` and the M2 demo plan. M1 (engine, sim, schema, RLS, booking RPCs) is merged and carries over.

## 1. Vision

The product is one shared, multi-tenant platform where **board-game cafés, futsal/turf/court venues and gaming lounges in Bangladesh** sign up themselves. On it they:
- configure their spaces;
- take bookings for whole resources (a pitch, a table, a station zone) and paid seats in **open play**, where the engine forms fair groups or two balanced teams;
- keep every seat filled through a waitlist.

The agency re-skins the product per business type with presets for words, colours and starter catalogue.

**Decisions (made with the user, 2026-10-20):**

| Topic | Decision |
|---|---|
| Tenancy | One shared platform. Each venue business is an **organization** (tenant) on its own subdomain `slug.<root-domain>` |
| Business types at launch | `boardgame_cafe`, `turf`, `gaming_lounge` |
| Market | Bangladesh first: currency **BDT** (stored in poisha, 1 BDT = 100 poisha), timezone **Asia/Dhaka** (UTC+6, no daylight saving) |
| Login | **Google OAuth + email magic link** (Supabase Auth). No phone OTP |
| Payments | **bKash direct** (tokenized checkout). Each organization connects **its own bKash merchant account**, so money goes straight to the venue and the platform never holds funds |
| Onboarding | **Self-serve**: owners sign up, pick a business type and set themselves up |
| Launch must-haves | Real player accounts and online payments |

**Not in the first release** (the user can change these):
- SMS, both notifications and login. Offers and confirmations go **in-app and by email**.
- Bangla UI. Launch is English-only; the code is i18n-ready (all copy in message files).
- Subscription billing for venues. Launch is a free beta.
- Custom domains for tenants.
- Native apps. Launch is a responsive web app; a PWA is later.

## 2. Users and roles

| Role | Where | Can |
|---|---|---|
| **Platform admin** (agency) | root domain `/admin` | List organizations, suspend and unsuspend them |
| **Owner** | root domain `/manage/[slug]` | Everything in their organization: branding, branches, resources, activities, schedule, prices, staff, bKash (Stage C), refunds (Stage C) |
| **Staff** | root domain `/manage/[slug]` | Run the schedule and bookings; no branding, staff, bKash or refunds |
| **Player** | tenant subdomain | Keep a profile per organization; browse; book and join open play (Stage B); pay (Stage C) |
| **Visitor** (anon) | tenant subdomain | See a **live** organization's public page: branding, branches, activities, upcoming schedule |

**Owner and staff work on the root domain; players use the tenant subdomain.** Sessions are therefore per host, so no cross-subdomain cookies are needed. One auth user can be an owner of one organization and a player at others.

## 3. Domain model

All tenant-scoped rows carry `organization_id`. RLS and Realtime filter on it directly. Money is an `int` of **poisha**.

| Entity | Purpose | Key fields |
|---|---|---|
| `organizations` | The tenant | `slug` (unique; `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`; reserved: `www`, `app`, `admin`, `api`, `manage`, `auth`, `static`), `name`, `business_type`, `branding` jsonb `{logo_path, primary, accent}`, `currency` (`'BDT'`), `timezone` (`'Asia/Dhaka'`), `status` (`onboarding`, `live`, `suspended`), `created_by` |
| `organization_members` | Staff access | `(organization_id, user_id)` primary key, `role` (`owner`, `staff`) |
| `organization_invites` | Staff invites | `email`, `role`, `expires_at`, `accepted_at`. When a user whose verified email matches signs in, the invite becomes a membership |
| `platform_admins` | Agency operators | `user_id` |
| `branches` | A location (was `venues`) | `name`, `address`, `opening_hours` jsonb (weekday → `[open, close]` local), `offer_ttl_seconds` |
| `resources` | A bookable space (was `venue_tables`) | `branch_id`, `name`, `kind` (`table`, `pitch`, `court`, `zone`, `pod`), `capacity`, `price_per_hour_poisha` (nullable), `active`, floor-plan `x`/`y` |
| `activities` | What people play (was `games`) | `name`, `min_players`, `max_players`, `duration_min`, `popularity`, `team_mode` (`none`, `two_teams`), `team_size` (required when `two_teams`; then `min_players = max_players = 2 × team_size`), `active` |
| `open_play_sessions` | A scheduled open-play slot (was `sessions`) | `branch_id`, `activity_id` (nullable: null means each player's favourites decide, as in the café), `starts_at`, `ends_at`, `seat_price_poisha`, `status` (`open`, `matched`, `closed`, `cancelled`) |
| `open_play_session_resources` | Which resources a session uses | `(session_id, resource_id)` |
| `resource_reservations` | **Single source of truth for resource time** | `resource_id`, `period tstzrange`, `source` (`session` or `booking`), `source_id`. **`EXCLUDE USING gist (resource_id WITH =, period WITH &&)`** makes double-booking impossible. Sessions write it in Stage A; whole-resource bookings join in Stage B |
| `player_profiles` | A player at one organization (was `players`) | `user_id` (**required**), `display_name`, `phone` (optional, E.164), `skill` 1–5 (self-rated), `email_opt_in`; unique `(organization_id, user_id)` |
| `profile_activities` | Ranked favourites (was `player_games`) | `(profile_id, activity_id)`, `rank` |
| `availability` | Weekly availability | `profile_id`, `weekday`, `start_time`, `end_time` |
| `seat_requests`, `groups`, `bookings`, `waitlist_entries`, `seat_offers`, `events` | The M1 booking flow | Keep their invariants: partial unique indexes and the locked RPCs. Re-keyed to `organization_id` + `profile_id`; used from Stage B |
| `notifications` | In-app inbox (was `messages`); Stage B | `profile_id`, `kind`, `body`, `link`, `read_at`, plus an email delivery status |

Stages B and C add `resource_bookings` (whole-resource bookings: `resource_id`, `profile_id`, `period`, status, price), `payments` and `refunds`.

## 4. Business-type presets (skins)

A preset gives an organization its words, default palette, starter activities and the first branch's starter resources. Owners can edit everything after onboarding.

| | `boardgame_cafe` | `turf` | `gaming_lounge` |
|---|---|---|---|
| Words: resource / activity / session / participant | table / game / game night / player | pitch / format / open match / player | zone / game / squad session / gamer |
| Starter resources | Tables 1–5 (cap 4), Tables 6–7 (cap 6) | Pitch 1, Pitch 2 (cap 14, **BDT 2,500/h**); Badminton Court 1 (cap 4, BDT 600/h) | PC Zone A, PC Zone B (cap 10, BDT 1,500/h); Console Pods 1–2 (cap 4, BDT 400/h) |
| Starter activities | The 8 M1 games (`team_mode none`) | 5-a-side futsal (`two_teams`, 5); 7-a-side (`two_teams`, 7); Badminton doubles (`two_teams`, 2) | Valorant 5v5 (`two_teams`, 5); CS2 5v5 (`two_teams`, 5); EA FC 1v1 (`two_teams`, 1); PUBG squad (`none`, 2–4) |
| Default open-play seat price | BDT 200 | BDT 300 | BDT 150 |

## 5. Matchmaking engine (additions)

- `formGroups` and `rankWaitlist` are unchanged (M1).
- **New: `splitTeams(players: {id, skill}[], teamSize): { teams: [Id[], Id[]]; skillGap: number }`.** Requires `players.length === 2 × teamSize`. It minimises the difference in total skill between the two teams:
  - exhaustive for 12 or fewer players (at most 924 splits);
  - otherwise greedy (strongest player first, into the weaker team), followed by pairwise-swap improvement;
  - deterministic, with ties broken by id.
- **Stage B usage:** for `two_teams` activities, `formGroups` forms groups of exactly `2 × team_size`, then `splitTeams` divides each group.

## 6. Architecture

```
pnpm monorepo (existing)
├─ packages/engine     formGroups, rankWaitlist, explainScore, + splitTeams
├─ packages/sim        seeded test data, adapted to the new model
├─ apps/web            Next.js 16 (App Router, Cache Components) + Tailwind 4 + shadcn
│  ├─ proxy.ts         session refresh (getClaims) + host routing
│  ├─ app/(root)/      marketing, /signin, /onboarding, /manage/[slug]/…, /admin
│  ├─ app/t/[slug]/    tenant site: public page, /signin, /me (profile) — reached via rewrite
│  ├─ lib/supabase/    server, browser and proxy clients (official @supabase/ssr pattern)
│  ├─ lib/tenancy/     host → slug resolution, org loading, role checks (server-only DAL)
│  └─ presets/         boardgame, turf, lounge (replaces skins/)
└─ supabase/           migrations, pgTAP, race test, seed.sql (local only)
```

**Host routing:**
- `NEXT_PUBLIC_ROOT_DOMAIN` is the root, e.g. `localhost:3000` locally.
- Requests for `slug.<root>` are **rewritten** to `/t/slug/...`. The rewrite keeps the cookies `updateSession` set.
- The bare root domain serves `(root)` routes.
- Unknown or suspended slugs get a 404 page.
- Locally, `slug.localhost:3000` works in modern browsers.

**Auth:**
- Supabase Auth with Google OAuth and email OTP / magic link.
- The callback is `/auth/callback` on whichever host started the sign-in.
- Supabase's allowed redirect URLs include `http://*.localhost:3000/**` locally and `https://*.<root>/**` in production.
- Locally, email goes to Mailpit.
- **Google sign-in needs OAuth credentials from the agency's Google Cloud project, a user action.** Until those exist, email links cover development.

**Data access:**
- Reads use the user's RLS client.
- Writes that span tables, or bootstrap a tenant (create organization + owner membership + preset rows), run in **server actions using the service-role client after an explicit role check**. That's the same pattern as the M1/M2 booking code.
- No `security definer` function is exposed in `public`.

**Access rules:**
- Helpers live in `private`:
  - `is_org_member(org)`
  - `is_org_owner(org)`
  - `is_platform_admin()`
  - `is_own_profile(profile, org)`
- One permissive policy per table, per action. Every table gets explicit grants, and default privileges are revoked.
- `anon` may only **select** the public catalogue of **`live`** organizations: public columns of `organizations`, and `branches`, `resources`, `activities` and upcoming `open_play_sessions`.
- Players see only their own profile rows and their own booking-flow rows.
- Cross-tenant isolation is tested with two organizations in pgTAP.

**Rendering:** pages that read the session put that part in `<Suspense>`, as Cache Components requires. Server actions call `refresh()` after mutations.

## 7. Stage A — Platform foundation (first build)

**Goal:** a venue can sign up, set up its business in minutes and go live on its subdomain, and players can sign up there and keep a profile.

1. **Schema migration (new migrations only).**
   - Rename and generalise the M1 tables and columns per §3 (`venues → branches`, `venue_tables → resources`, `games → activities`, `sessions → open_play_sessions`, `players → player_profiles`, `player_games → profile_activities`, `venue_id → organization_id`/`branch_id`).
   - Add the new tables.
   - Add `resource_reservations` with the exclusion constraint (needs `btree_gist`).
   - **Re-create the five M1 RPC bodies** against the new names. plpgsql bodies don't follow renames.
   - Explicit grants, merged policies, a clean `db advisors`.
2. **Engine:** `splitTeams` with property tests.
3. **Presets:** `presets/{boardgame,turf,lounge}.ts` per §4, validated by tests. The skin tests move here.
4. **Auth and routing:** SSR clients, `proxy.ts` with host rewrite, `/signin` (Google button + email link form) on both root and tenant hosts, and `/auth/callback`.
5. **Onboarding wizard** (root, signed in):
   1. Business type.
   2. Name and slug, with a live availability check.
   3. Branding: logo to the Storage bucket `org-assets/{org_id}/logo.*` (private bucket, public-read policy for live orgs), plus primary and accent colours.
   4. First branch: name, address, opening hours (default 10:00–23:00 daily).
   5. Review the preset resources and activities.
   6. **Publish** (`status → live`).

   Org, owner membership and preset rows are created together in one server action. If any step fails, the organization is deleted.
6. **Owner admin** `/manage/[slug]`:
   - Overview.
   - CRUD for branches (with hours), resources (with hourly prices), activities and the open-play schedule. A schedule entry is a single session or "repeat weekly for N weeks". Overlaps are refused by `resource_reservations`, and the error is shown to the owner.
   - Staff: invite by email, list, remove.
   - Settings: branding. The slug is locked once live.
7. **Tenant site** `slug.<root>`:
   - The public page: branding, branches with hours, activities, the upcoming open-play schedule.
   - `/signin`.
   - `/me`: create or edit the player profile for this organization (display name, skill 1–5 with plain-language descriptions, ranked favourites, weekly availability).
8. **Platform admin** `/admin`: list organizations (status, created, owner email) and suspend/unsuspend. A suspended tenant's site shows "temporarily unavailable".

**Done when:**
- An owner can go from sign-up to a live `turf` venue with preset pitches and a weekly 5-a-side open match.
- A different user can sign up on that subdomain and save a profile.
- Neither can see another organization's data.
- Every test suite is green, and `db advisors` has no warnings.

## 8. Later stages (each gets its own spec section and plan when reached)

### Stage B — Booking & matchmaking
- **Whole-resource booking:** a player picks a resource and time within opening hours. The booking writes to `resource_reservations`, so there's no double-booking. Its status is `confirmed` (pay at venue) until Stage C.
- **Open play:** requests → matching runs at a cut-off or by the owner (`formGroups`, plus `splitTeams` for `two_teams`). Then waitlist, cancellations, and offers to the next best player.
- **Offers** reach players as an in-app notification (Realtime) and an email with a **signed, single-use "Take the seat" link**, reusing `accept_offer`. Unanswered offers expire through the `pg_cron` → `pg_net` job.

### Stage C — bKash payments
- **Credentials:** each organization stores its own bKash credentials (`app_key`, `app_secret`, `username`, `password`, sandbox or live) in **Vault**. Only server code with `service_role` can read them.
- **Checkout flow:**
  1. Grant a token.
  2. Create the payment.
  3. Redirect the player to bKash.
  4. bKash calls back.
  5. Execute the payment.
  6. Query to verify.

  It's idempotent per payment. A booking holds its resource for **10 minutes** while payment is pending.
- **Open play:** the player pays when they get a seat, or when they accept an offer.
- **Refunds** go through the bKash refund API, following an organization policy: a full refund up to N hours before; otherwise a refund only if the seat is refilled from the waitlist.
- Owners get a payments ledger.
- Money always moves between the player and the venue's merchant account, never through the platform.

### Stage D — Owner analytics & operations
- Revenue by day, activity and resource.
- Fill rate, no-shows and cancellations.
- Waitlist conversion and median time-to-refill.
- Check-in at the venue.
- CSV export.

### Stage E — Launch hardening
- Hosted Supabase + Vercel with a wildcard domain.
- Custom SMTP (e.g. Resend) for auth and notification email.
- Cloudflare Turnstile on sign-up.
- Error monitoring.
- Playwright E2E for onboarding → booking → payment (bKash sandbox).
- Backups and restore drill.
- Terms and privacy pages.
- Rate limits.

### Later
SMS through a Bangladeshi gateway, Bangla UI, PWA, subscription billing for venues, custom domains, per-activity skill ratings, Elo-style rating from results.

## 9. Testing standard (all stages)

- TDD for all logic.
- Engine property tests.
- pgTAP for every table's grants, policies and constraints. That includes a **two-organization isolation suite** and an **exclusion-constraint test** (overlapping reservations rejected, back-to-back allowed).
- Integration tests against local Supabase for server actions and booking code.
- `supabase db advisors --fail-on warn` must be clean.
- Browser smoke runs (Playwright MCP) for each stage's user journey.
- A fresh whole-branch review before merging each stage.
