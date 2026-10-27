# Project Memory: Booking & Matchmaking

Living notes for anyone (human or AI) who needs to **understand, fix or upgrade** this project later.
Add to this file whenever a decision is made, a gotcha is found, or something changes.
Newest entries go at the top of each log section.

---

## 1. What this is

**Since 2026-10-25 it is being reshaped for ONE client's business** (spec `docs/superpowers/specs/2026-10-25-one-brand-sections-design.md`): one brand running a turf, a board-game café and a gaming lounge in one place, one website and one sign-in. The organization row is the brand; its **sections** (the old branches) each have their own kind, hours, booking rules, spaces, games, player ratings and staff. `BRAND_SLUG` names the brand; `pnpm brand:setup` creates or tops it up. R1 (foundation) is merged to `main`, pushed, and rolled out to hosted (2026-10-27). R2 (the public site on one host, look "A1 · Matte") is built on `r2-public-site` (2026-10-28; not merged, hosted untouched). R3 (manage area) follows. The multi-venue text below describes what came before.

**Since 2026-10-20 this is a REAL product, not a demo.** It's a shared, multi-tenant booking & matchmaking platform for **board-game cafés, futsal/turf/court venues and gaming lounges in Bangladesh**.

Venues sign up themselves, each on its own subdomain. Each venue can:
- configure branches, resources, activities and a schedule;
- take whole-resource bookings and paid open-play seats, where the engine forms fair groups or two balanced teams;
- keep seats full through the waitlist.

The agency re-skins it per business type through presets.

**User decisions (2026-10-20):**

| Topic | Decision |
|---|---|
| Tenancy | One shared multi-tenant platform |
| Onboarding | Self-serve |
| Market | Bangladesh: BDT stored as **poisha**, `Asia/Dhaka` |
| Login | Google + email magic link (no phone OTP) |
| Payments | **bKash direct**, paid into **each venue's own merchant account** (the platform never holds money) |
| Launch must-haves | Real player accounts and online payments |

**Not in the first release:** SMS, Bangla UI, subscription billing for venues, custom domains.

**History:** it started as portfolio project #5 from `Agency_Portfolio_Projects.pdf`, a board-game café demo ("Meeple House"). M1 (engine, sim, schema, RLS, booking RPCs) was built for that demo and carries over into the platform.

## 2. Key documents

| Doc | Path |
|---|---|
| **Platform spec (the authority)** | `docs/superpowers/specs/2026-10-20-booking-platform-design.md` |
| Demo spec (superseded, history) | `docs/superpowers/specs/2026-10-20-booking-matchmaking-design.md` |
| Stage B1 plan (bookings, notifications, jobs) | `docs/superpowers/plans/2026-10-20-stage-b1-bookings.md` |
| **Stage B spec** (booking & matchmaking) | `docs/superpowers/specs/2026-10-20-stage-b-booking-matchmaking-design.md` |
| Stage A plan (done) | `docs/superpowers/plans/2026-10-20-stage-a-platform-foundation.md` |
| M1 plan (done, merged) | `docs/superpowers/plans/2026-10-20-m1-foundation-and-engine.md` |
| M2 demo plan (superseded, never built) | `docs/superpowers/plans/2026-10-20-m2-booking-flows.md`. Its research is still useful: SSR auth code, Data API grants, Cache Components rules, pg_cron + pg_net + Vault |
| Execution ledger (scratch, git-ignored) | `.superpowers/sdd/<plan-name>/progress.md` |
| Original brief | `Agency_Portfolio_Projects.pdf` (deliberately **not** committed) |

**Stages:**
- **A** — platform foundation: tenancy, generic model, auth, onboarding, admin, player profiles, `splitTeams`
- **B** — booking & matchmaking
- **C** — bKash payments
- **D** — analytics & operations
- **E** — launch hardening
- **Later** — SMS, Bangla UI, PWA, billing, custom domains

## 3. Environment & setup gotchas (Windows dev box)

- OS: Windows 11. The shells are PowerShell 5.1 and Git Bash. Node **v24.20.0**.
- **pnpm 12.14.0** is installed via Corepack into the *user* npm dir:
  `corepack enable pnpm --install-directory "C:\Users\USER\AppData\Roaming\npm"`.
  Plain `corepack enable` fails with EPERM because it tries to write to `C:\Program Files\nodejs` (needs admin).
- **Docker Desktop is required** for local Supabase (`supabase start`, pgTAP tests). It was installed 2026-10-20 (Docker 29.9.1, WSL2 backend, WSL 3.0.3).
  - **`wsl --install` fails with "Forbidden (403)" on this network.** WSL asks `api.github.com` for its latest version, and GitHub's API refuses anonymous requests from this connection with 403 (probably its per-IP rate limit). Workaround:
    1. Enable the features: `dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart` and the same for `VirtualMachinePlatform`.
    2. Download the MSI from `https://github.com/microsoft/WSL/releases/download/<ver>/wsl.<ver>.0.x64.msi` and install it with msiexec.
    3. Reboot.
  - **Docker Desktop:** download `https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe` and run it with `install --quiet --accept-license --backend=wsl-2`. No Ubuntu distro is needed.
  - **PATH:** a shell opened before the install won't have `docker` on PATH. Add `/c/Program Files/Docker/Docker/resources/bin` (Git Bash) for the CLI. The Supabase CLI talks to the Docker engine directly, so it works anyway.
  - **First `supabase start`** pulls about 13 images (several GB). One pull hit `tls: bad record MAC` and retried on its own.
- **Local Supabase keys** are the standard public demo keys printed by `supabase start` (`pnpm exec supabase status`). They're safe to use locally and must never be used in production.
- `supabase/seed.sql` doesn't exist yet, so `db reset` prints "no files matched pattern". That's harmless. Seeding a demo tenant from `@bm/sim` comes in Stage B or later.
- **The 10-second job tick needs three things locally:** the dev server on :3000, `pnpm env:local` run since the last `db:reset` (it writes `JOB_SECRET` to `.env.local` and `app_url` + `job_secret` to Vault), and a dev-server restart after that. The database reaches the host as `http://host.docker.internal:3000`; that name exists on Docker Desktop (Windows/macOS). **On Linux add `extra_hosts: host.docker.internal:host-gateway`** or point `app_url` at the host's IP.
- **Integration tests pause the tick** (`cron.alter_job(…, active := false)` in `test/integration/global-setup.ts`) and resume it in teardown, so the live tick doesn't deliver the tests' emails. If a run is killed mid-way the tick stays paused: `select cron.alter_job(jobid, active := true) from cron.job where jobname = 'tick';`
- **Mailpit SMTP** is on 54325 (`[local_smtp] smtp_port` in `config.toml`). Changes to `config.toml` (SMTP port, email templates) only apply after `pnpm db:stop && pnpm db:start` — data survives that.
- **New migrations are named by hand, after `20261020200500`.** `supabase migration new` stamps the machine clock (it ran ~14:54Z on 2026-10-20), which sorts *before* the hand-named Stage A fix-pass migrations (`…191000`, `…191100`); a migration that sorts earlier than ones it depends on runs in the wrong order. Check `ls supabase/migrations | tail` and rename if needed.
- **`pnpm db:reset` wipes every user, venue and platform-admin grant.** Sign in again and re-run `pnpm admin:grant <email>` afterwards.
- **`apps/web/.env.local`** is generated by `pnpm env:local` from the running stack (`scripts/write-env-local.mjs`). `.env.example` documents every variable.
- **Local email goes to Mailpit** at http://127.0.0.1:54324 (UI and API). To grab a sign-in link from a script: `GET /api/v1/messages`, find the message for the address, then `GET /api/v1/message/<ID>` and take the first `href` from `HTML` (decode `&amp;`).
- Local Supabase DB URL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- Git identity is repo-local: `Console Log Studio <pandasweet067@gmail.com>`.
- Git warns "LF will be replaced by CRLF". This is harmless (Windows autocrlf).
- **TypeScript is pinned to ^5.9.3 across the workspace.** `create-next-app` 16.4.2 scaffolds `typescript ^5`, so the whole repo follows it. TS 7.x (the native Go compiler) is newer and works for the engine/sim, but Next's type-check isn't verified against it. Try upgrading once Next templates move to TS 7.
- `create-next-app` refuses to run ("application path is not writable") if the **parent folder doesn't exist**. Run `mkdir -p apps` first.

## 4. Architecture quick map

```
apps/web            Next.js App Router + Tailwind 4 + shadcn/ui
  proxy.ts          session refresh + host routing: <slug>.<root> → /t/<slug>/…, root → (root) group
  app/(root)/       landing, /signin, /onboarding wizard, /manage/[slug]/… owner admin, /admin platform admin
  app/t/[slug]/     a venue's public page, /signin, /me (player profile); layout applies venue colours
  app/auth/         /auth/callback (PKCE exchange, accepts staff invites on root), /auth/signout
  lib/tenancy/      host → slug, slug rules, getLiveOrganization, requireOrgRole, URLs
  lib/orgs|schedule|profiles|admin/   server-side domain logic, each takes a SupabaseClient (tested in test/integration)
  lib/forms/        FormData → validated input (zod), unit-tested
  presets/          per business type: words, palette, starter resources/activities (boardgame, turf, lounge)
  messages/en.ts    every user-facing string (`m`), ready for a Bangla file later
packages/engine     pure TS engine (no I/O, seeded RNG): formGroups, rankWaitlist, splitTeams, explainScore
packages/sim        seeded fake data → DB-shaped rows (still M1 shapes)
supabase/           migrations (M1 → stage_a_schema → stage_a_rls → schedule_rpcs) + pgTAP + race test
```

- **Tenancy:** every tenant row carries `organization_id`. Access rules call security-definer helpers in the `private` schema: `is_org_member`, `is_org_owner`, `org_is_live`, `is_platform_admin`, `is_own_profile`, `is_org_owner_folder`. Visitors (anon) can read only live venues' public columns.
- **Who writes what:** owners/staff write venue setup through RLS as themselves; players write their own profile through RLS; onboarding, invites, publish/suspend and admin listing use the server-only service client (`lib/service-client.ts`) after an explicit role check.
- **Bookings (B1):** `lib/bookings/slots.ts` (pure slot grid: opening hours, overnight, horizon) → `lib/bookings/bookings.ts` (`bookSpace`, `cancelSpaceBooking`, `spaceDay`, `branchDay`, `listMyBookings`) → SQL `book_resource` / `cancel_resource_booking` / `set_resource_booking_status` (overlaps via `resource_reservations`, the booking limit under a profile lock, notifications in the same transaction).
- **Notifications:** `notifications` is the outbox. SQL functions write rows; the bell (`components/notifications/bell.tsx`) listens through Realtime; `/api/jobs/tick` → `runTick` → `deliverPendingEmails` (`claim_pending_emails` / `finish_email`, 3 attempts) → `EmailSender` (`lib/email/sender.ts`: SMTP or Resend). Words come from `renderNotification` + `messages/en.ts`; payloads hold ids, times and names only.
- **Open play (B2):** `lib/open-play/match.ts` (pure: requests → `formGroups` → `splitTeams` → a seat plan) → `lib/open-play/open-play.ts` (`requestSeat`, `withdrawRequest`, `matchSession`, `offerNext` via `rankWaitlist`, `cancelSeat`, `respondToOffer`, `issueOfferToken`, `findOffer`, `seatsLeft`, `playerSessionView`, `staffSessionView`, `listMySeats`) → SQL `request_seat` / `withdraw_request` / `apply_match` / `create_offer` / `issue_offer_token` / `accept_offer` / `decline_offer` / `expire_offers` / `cancel_booking(id, by_venue)` / `close_started_sessions` / `cancel_open_play_session`. Shared payload helpers: `private.seat_payload`, `session_payload`, `seat_team`, `take_seat`, `join_waitlist` (service_role only). Pages: `/sessions/[id]`, `/offers/[token]` (no sign-in), `/me/offers/[id]`, `/manage/[slug]/sessions/[id]` (Match now). The tick runs: expire + pass on offers → match due sessions → close started sessions → emails.
- **Scheduling** goes through the `schedule_open_play` RPC (all-or-nothing; a `btree_gist` exclusion constraint on `resource_reservations` makes double-booking a resource impossible).

- **Seat invariants live in Postgres.** Partial unique indexes plus `accept_offer` row locks mean duplicate SMS "YES" replies can't double-book.
- **Booking-flow tables** (bookings, waitlist_entries, seat_offers, messages, events) are written only by RPCs running as `service_role`. Owners can only read them.
- **Notifications (Stage B)** reach players in-app and by email, with a signed "Take the seat" link instead of an SMS "YES". The M1-era Notifier/Twilio idea is shelved; SMS via a BD gateway is a later stage.

## 5. Decisions & rulings log

- **2026-10-28 · R2 public site build rulings** (spec `docs/superpowers/specs/2026-10-28-r2-public-site-design.md`, plan `docs/superpowers/plans/2026-10-28-r2-public-site.md`, 11 tasks; every ruling is in the plan's ledger):
  - **The user's choices:** public site first; look **A1 · Matte** (dark, flat, no glow; "A. but the colours are too shiny. make it simple"); free-licence photos (Pexels / Unsplash, credited in `public/sections/CREDITS.md`) since the brand has none yet.
  - **One host.** Every page is on the root host; `app/t/[slug]`, onboarding, `/admin` and their code are gone. Old venue subdomain links get a 308 to the same path on the root host through `/api/moved` (Next turns a proxy redirect to another host into a relative one, so the proxy rewrites to a route handler that redirects). `requestOrigin` trusts only the root host or `www.<root>`.
  - **Section colours** come from the kind (`private.kind_accent`: turf `#43a66b`, café `#2e9e93`, lounge `#8a78e6`); the migration repaints only sections still on their kind's old default. A section's colour reaches components as `--section` (`sectionStyle`), with `bg-section`/`text-section`/`text-on-section`.
  - **Words per kind** (`kindWords`): Join match / Grab a seat / Squad up; Book pitch / Book table / Book a PC (also the booking page's heading); open matches / game nights / squad sessions.
  - **Booking page:** the day strip's week follows the chosen `?date=` (arrows move to the neighbouring week's first day; no `?start=`). Only a still-free slot stays picked, so a slot you just booked turns disabled (pinned by the e2e journey).
  - **`brand:setup --demo`** adds a demo game to any section with no *upcoming* game (games from earlier runs pass), skipping a time that clashes with a real booking.
  - **Me pages** share a tab row (Profile · My bookings · Notifications) with **Sign out**; on phones it is the only way between them. `MyBooking`/`MySeat` carry `sectionId`; notification rows find their section by `payload.section_name`.
  - **`/manage`** sends a member of `BRAND_SLUG`'s organization to `/manage/<slug>` (by slug, not `getBrand()`, so a not-yet-live brand can still be published); anyone else sees a short message.
  - **`/signin` lives in its own route group `app/(auth)`**, outside the public pages' "Not open yet" gate: inside the brand's navigation when the brand is live, plain otherwise, so staff can always sign in (final-review fix; pinned by `e2e/r2-not-live.spec.ts`). Shared chrome: `components/site/site-chrome.tsx`.
  - **Old booking links** (`<slug>.<root>/book?section=…&resource=…&date=…`) go to `/<section>/book?resource=…&date=…` (`movedBookPath` + `oldBookSection`, brand-scoped), or home when the section is unknown (final-review fix, RF1).
  - **Checks:** `pnpm smoke` (`apps/web/scripts/smoke-site.mjs`, `path|text;text`, `--as <email>` signs a local user in) and `pnpm test:e2e` (Playwright journey). Contrast on every manage and site page was measured in a real browser (nothing under 4.5:1).
- **2026-10-25 · One Brand R1 build rulings** (plan `docs/superpowers/plans/2026-10-25-one-brand-r1-foundation.md`, 7 tasks):
  - **Migrations are generated, not hand-edited copies.** A rename (`branches` → `sections`) doesn't rewrite function bodies, so each migration that changes a function copies its latest definition and applies asserted substitutions (`scratchpad` Python scripts, kept out of the repo). Policy, constraint and index names containing "branch" were renamed in a DO loop.
  - **Sections:** `kind`, `slug` (turf / cafe / lounge, then `-2`…; not a reserved word), `accent` by kind (`private.kind_accent`), `position`, and the booking rules moved off `organizations` (horizon 14 days, cancel 120 min, match 360 min, 3 upcoming bookings by default; match must be later than cancel). The brand's `address` moved to `organizations`; `business_type` is nullable now (readers fall back to the turf preset until R2). `public.add_section(org, kind, name)` (service role) locks the org and picks slug, accent and position.
  - **Everything follows the row's section:** a space's section sets its booking window, cancel cut-off and the booking limit (counted per section); a session's section sets its offer time, match and cancel cut-offs; games belong to one section (`activities.section_id`), and a session's game must be in its section.
  - **Ratings per section** (`profile_section_skills`, 1–5) replace `player_profiles.skill` (backfilled one per section). `request_seat` answers `needs_skill` without one; the session page asks the player to rate that section first. Matching, offers and the staff view read the session's section's ratings (a missing one counts as 3 — only rows from before ratings). **Favourites count per section** (`private.wants_game` and `favouritesOf`): a player whose favourites are all turf games plays anything at the café — otherwise `rankWaitlist`, which drops anyone whose favourites lack the game, would never offer them a café seat.
  - **Staff per section** (`section_staff`, written only by the server): staff read seats, requests, waitlists, offers, space bookings, reservations and session events of their sections (`private.is_section_staff` / `is_session_staff` / `is_resource_staff`); venue-wide events are the owner's; owners read everything. `section_staff` also references the membership, so leaving the team removes a person's sections. Invites carry `section_ids` (staff ≥ 1, owners none); role changes add every section (owner → staff) or remove the rows (staff → owner). Staff actions find the touched row's section and call `requireSectionStaff` (a 404 for another section). Existing staff and pending staff invites got every section that existed at migration time.
  - **Manage:** Sections page (name, hours, rules; add a section by kind) replaces Branches and the venue-wide Bookings card; the address moved to Settings and onboarding's Branding step (`saveSettingsAction` writes it only when the form has the field). New games and spaces pick a section.
  - **`pnpm brand:setup`** (`scripts/brand-setup-core.mjs`, tested by `brand.test.ts`) only adds what is missing: the brand (live), sections in the order turf, café, lounge with their preset spaces and games, the owner (membership, or a pending owner invite — no email), and with `--demo` (local only) 12 rated players and one open game per section. Its report counts what that run added, so a second run says nothing new. `getBrand()` imports the service client inside the call so `brand.ts` stays importable by tests.
  - `pnpm env:hosted` keeps `BRAND_SLUG` only when the file already pointed at hosted (else `chattoturf`) and reads the Google flag from the hosted `/auth/v1/settings`.

- **2026-10-21 · Stage B2 build rulings** (open play, matching, offers):
  - **Offer tokens are never stored.** The email step mints the token (`issueOfferToken` in `deliverPendingEmails`) and swaps its SHA-256 into `seat_offers.token_hash` (`issue_offer_token`); a new offer starts with the hash of random bytes nobody keeps (column default). A retried email gets a fresh link, so only the newest link works; an offer that is no longer pending sends no email (`skipped`). The notification row links to `/me/offers/<id>`. (Spec §3 had `create_offer` take the hash; that would have meant storing the token until the tick sent the email.)
  - **Seats and teams:** a team group's capacity is 2 × team_size; team 1 sits in seats 1…n, team 2 in n+1…2n, so a refilled seat keeps its team (`private.seat_team`). `apply_match` checks the planner's team for each seat against that rule.
  - **A live session** is `open` or `matched` and not started. Requests, offers, accepts and cancels act only on live sessions and answer `closed` otherwise; `accept_offer`/`decline_offer` check that before `declined`/`expired`/`not_pending`.
  - **Lock order:** session → offer → group → waitlist entry. `create_offer` takes the session `for share` first so it can't slip into a session being cancelled; `accept_offer` takes no session lock.
  - `apply_match` appends any request the plan didn't mention (a request that raced the match) to the waitlist; re-requesting after withdrawing reuses the entry and goes to the back of the queue.
  - **Late requests** take a free seat directly (`source 'direct'`) only when nobody is waiting and the game fits (fixed activity, a favourite, or anything for a player with no favourites).
  - `expire_offers` leaves offers of sessions that have started to `close_started_sessions`, so the player hears "no seat" rather than "we offered the seat to the next player".
  - **Tick:** each step runs on its own (`try` per step); the email sender is built inside the email step (missing `EMAIL_*` no longer stops matching). Every seat `expire_offers` returns is handed on (it returns a seat once, so a cap would lose seats); matching takes up to 10 due sessions per tick, soonest first, skipping sessions with no requests.
  - The public venue page lists `open` and `matched` sessions with "N seats left" (counts only, service client); before matching that is what the spaces could seat minus requests.
  - Offer answers don't refresh the page: the reply shows beside the buttons and a second press says "no longer available"; reloading a used link shows "no longer available".
  - `staffSessionView` also returns `needed` (players a group needs) for "Not enough players yet (7 of 10)".
  - **Final review fixes (fresh Opus reviewer: 0 Critical / 4 Important / 10 Minor)**, migration `20261021030000_open_play_review_fixes.sql`:
    - **A late request takes a free seat when nobody waiting wants that seat's game** (`private.wants_game`), not only when nobody waits at all. In a players-choose session someone waiting for Azul no longer strands a free Catan seat. Fixed sessions behave as before. (This settles spec §3 "only if nobody is waiting" against the plan's Review Focus 5.)
    - **Lost hand-offs are swept:** the tick's `refill` step offers every free, un-offered seat of a live matched session that someone waiting wants (`unoffered_free_seats`, 50 per tick); each seat is handed on in its own try; `cancelSeat`/`respondToOffer` log a failed hand-on instead of failing the player's action (`handOn`).
    - **Matching takes only sessions that could fill** (`sessions_due_for_matching`: past the cut-off and at least as many requests as the smallest group: both teams for a team game, the smallest `min_players` when players choose), so unfillable sessions no longer use up the 10-per-tick cap. `runTick` lost its `now` parameter (the cut-off check is SQL `now()`).
    - **Accept vs cancel session (reviewer I3) needed no change:** the booking insert's composite FK takes `KEY SHARE` on the session row, so the two serialise (or, in a narrow window, deadlock and Postgres aborts one). Race test `accept-vs-cancel-session` guards it.

- **2026-10-20 · Stage B1 build rulings** (bookings, notifications, jobs):
  - Booking history is protected: booking-flow references are `on delete no action` (deleting a profile/activity/session with history is refused; deleting a whole venue still works). A branch with history answers "has bookings or sessions" instead of a raw error.
  - `resource_bookings` is either a player (no guest fields) or a walk-in (name + phone), enforced by a CHECK stricter than the plan's XOR.
  - A double click on Book answers "already yours" (except at the booking limit, where it still says "limit reached" — deferred minor), a second Cancel "already cancelled". Staff skip the booking window, the limit and the cancel cut-off, never opening hours or overlaps.
  - **Final review fixes (fresh Opus reviewer, 0 Critical / 4 Important):**
    - The **staff day view never hides a booking**: it lists every booking of the business day (`businessDayWindow`: from the end of last night's overnight hours to the end of tonight's), several per slot if needed, plus an "Outside the current hours" section for bookings the current grid no longer covers; inactive spaces with bookings stay visible.
    - **Attendance only after the start**, cancelling only before the end (`set_resource_booking_status` → `not_started`; `cancelSpaceBooking` → `too_late` once ended). Before, a mis-click on "No-show" for next week made the booking uncancellable.
    - **Staff can book the slot in progress** (`checkBookingStart({ allowInProgress })`): a walk-in at 8:05pm for the 8–9pm slot.
    - **/book has a branch step** when a venue has more than one branch; notifications carry `branch_name` + `multi_branch` and name the branch ("Pitch 1 (Gulshan), …"); My bookings shows the branch.
    - **"Today" is the current business day** (`currentBusinessDate`): after midnight a 14:00–02:00 lounge still shows tonight.
    - Booking pgTAP/race fixtures use a day 30 days ahead (they would have started failing in 2027).
  - The tick route is `POST /api/jobs/tick` with `Authorization: Bearer <JOB_SECRET>` (constant-time compare); `proxy.ts` lets `/api/jobs/*` through for any host because the DB calls in as `host.docker.internal`.
  - `deliverPendingEmails` logs each failed send; failures retry until the 3rd attempt.
  - The bell re-reads the unread count on each Realtime event (adding 1 double-counted right after a booking, because the server refresh already included the new row).
  - `getPlayer(slug)` (`lib/tenancy/player.ts`) is the one cached "signed-in player at this live venue" lookup for the venue site.
  - nodemailer is pinned to 10.0.15 (10.1.x was under two weeks old on 2026-10-20).
- **2026-10-20 · Stage B design (user decisions).** Spec: `2026-10-20-stage-b-booking-matchmaking-design.md`.
  - **Walk-ins:** staff book a space for anyone with a name and phone; `resource_bookings` has either a profile or a guest, never both.
  - **Slots:** venue-set length per space (`resources.slot_minutes`), on a grid from opening time; 1–4 back-to-back slots per booking.
  - **Matching** runs automatically at a cut-off, plus a "Match now" button. Too few players → the session stays open and matching retries every tick until start.
  - **Cancelling:** players cancel online until a venue cut-off; staff can always cancel.
  - **Defaults:** match cut-off 6h, cancel cut-off 2h (the DB requires match > cancel). With equal cut-offs nobody could cancel after matching, so the waitlist would never be used.
  - **Timed work:** `pg_cron` → `pg_net` → `POST /api/jobs/tick` every 10s (secret in Vault). Notifications are an outbox written inside the same SQL function as the state change; the tick sends their emails (SMTP→Mailpit locally, Resend in Stage E).
  - **Offer emails** link to `/offers/<token>`. Only the token's hash is stored, and the seat is taken by a POST button, never by opening the link (email scanners open links).
  - **Build order:** **B1** (history protection, notifications/email/jobs, whole-space bookings + walk-ins), then **B2** (open play, matching, offers), each reviewed and merged separately.

- **2026-10-20 · Stage A final review (fresh Opus reviewer): 0 Critical, 3 Important, 15 Minor; no cross-tenant data leak.** Fixed, each with a test that failed first:
  - **Cross-venue references are now impossible in the database.** Every reference between tenant tables is a composite foreign key `(x_id, organization_id) → parent (id, organization_id)` (migration `20261020191000_tenant_scoped_fks.sql`, 23 keys, original ON DELETE kept; `messages.profile_id` uses `on delete set null (profile_id)` so the venue column stays). Before, an owner could hang a resource under another venue's branch, or a player could request a seat in another venue's session, straight through PostgREST: RLS checks who writes a row, not where its keys point. `06_tenant_refs.test.sql` has a catalog check that fails if a new table forgets this. **When you add a tenant table, reference parents by `(x_id, organization_id)`** and index `(x_id, organization_id)`.
  - **Open redirect closed.** `safeNext` now rejects control characters/whitespace (URL parsers strip tab/CR/LF, so `/\t/evil.com` became `//evil.com`) and resolves the path to prove it stays on the same origin.
  - **Staff invite emails work.** `inviteUserByEmail` can't use PKCE, so its default link handed the session over in a URL fragment our callback ignored ("link expired"). The invite template (`supabase/templates/invite.html`, wired in `config.toml`) now links to `/auth/callback?token_hash=…&type=invite&next=/manage`, and `completeSignIn()` (`lib/auth/complete-sign-in.ts`) handles both `code` and `token_hash`. **Mirror the template on the hosted project** (Auth → Email Templates → Invite user).
  - **Owners can cancel a pending invite** (`cancelInvite`), so a mistyped address can't turn a stranger into staff.
  - **More reserved slugs:** phishing-prone names on the platform domain (login, signin, pay, checkout, bkash, nagad, billing, wallet…) and any `xn--` (punycode look-alike) label. The DB CHECK (`20261020191100_reserved_slugs.sql`) and `RESERVED_SLUGS` must stay in sync; a unit test compares them.
  - **`apps/web/.env.example` is committed now** (`.gitignore` had `.env*`; `!.env.example` added).
  - Reviewer-confirmed: every service-client path checks the caller's role first, and all five Review Focus areas behave.
- **2026-10-20 · Stage A (platform foundation).** Rulings made while building it, newest first:
  - **Platform admin listing** (`lib/admin/platform.ts`) shows the 200 newest venues and looks up each first owner's email through the Auth admin API, one call per venue. Fine for an operator page; paginate once there are hundreds of venues.
  - **`pnpm admin:grant`** uses `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY` from the shell when set, else the local stack, so the same script works in production.
  - **Auth redirects use the validated Host header** (`requestOrigin()` in `lib/auth/redirect.ts`). Only the root domain or a valid venue subdomain is trusted; anything else falls back to `request.url`. See §6 for why.
  - **Player profiles:** `saveProfile` returns `phone_taken` (phone is unique per venue) and silently drops favourites that aren't this venue's active activities, because RLS doesn't check which venue an activity belongs to. Phones are stored as `+880…`; `01XXXXXXXXX` is normalised.
  - **Scheduling uses the venue's timezone** (`organizations.timezone`), never a hard-coded Asia/Dhaka.
  - **`ActionForm`** (one client form component for every admin form) submits with `onSubmit` + `startTransition`, not a bare form action, so React 19 doesn't wipe inputs after an error. See §6.
  - **Onboarding reuses the manage actions** (settings, branch, publish), so each thing has one write path.
  - **Branches:** a venue keeps at least one. Resource inserts check the branch belongs to the venue, and a saved `logo_path` must start with `<orgId>/`. RLS doesn't check foreign keys point inside the same venue (the old M1 minor), so the server does.
  - **Publishing** only moves `onboarding → live`. A suspended venue can be restored only by a platform admin.
  - **`createOrganization`** returns `invalid_name` for names outside 2–80 characters instead of letting the DB CHECK become a 500.
  - **Local auth email rate limit** is 100/hour in `config.toml` so sign-in links can be tested repeatedly. Set real limits on the hosted project.
  - **Staff invites** never fail on Auth email errors: the `organization_invites` row is the source of truth and becomes a membership when that email signs in on the root site. "Already a member" is detected by reading members' emails via the Auth admin API (there is no lookup by email, and a security-definer lookup in `public` is not allowed).
  - **`safeNext()`** only allows same-site relative paths after sign-in. (Its first version missed control characters; fixed after the final review, see above.)
  - **Logos:** the `org-assets` bucket is public (1 MB, png/jpeg/webp). Only a venue's owners can write to their `<orgId>/` folder; they also get SELECT because re-uploading (upsert) needs it. The folder check compares text, so a non-uuid folder is denied rather than erroring.
  - **Groups** are readable like sessions (live venue or member). They hold no personal data and players need to see their table.
  - **A non-live venue's site shows "not available" to everyone, owners included.** Owners manage it from `/manage` on the root site. A "preview before publish" can come later.
  - **Working product name** "Booking & Matchmaking" lives in `messages/en.ts` until the user names it.

- **2026-10-20 · M1 final review: column-level privileges.** RLS policies say *which rows* a user can touch, not *which columns*. Two holes the reviewer found:
  - A player could rewrite `players.venue_id` and join another venue.
  - A player could set their own `seat_requests.priority` or `created_at` and jump the queue.

  Fixed with column grants at the end of `20261020000002_rls.sql`:
  - **players:** authenticated users can update only `name, phone, skill, sms_opt_in`.
  - **seat_requests:** authenticated users can insert only `venue_id, session_id, player_id`.

  **When you add a column to these tables, decide whether to grant it.** New columns are NOT writable by default.
- **2026-10-20 · M1 final review: expiry has one owner.** `accept_offer` on a past-due offer returns `'expired'` **without changing anything**. Only `expire_offers()` expires offers, and it returns the freed seat so it can be offered to the next person. (The first version expired the offer inside `accept_offer`, so the seat was never re-offered.) The migration header lists who hands a freed seat onward for each outcome.
- **2026-10-20 · M1 T11: booking RPC contract** (`supabase/migrations/20261020000003_booking_rpcs.sql`). All are `service_role` only; server code calls them.
  - **`cancel_booking(id)`** returns the freed `(group_id, seat_no, session_id)` and is idempotent. It raises `booking_not_cancellable` for attended/no-show bookings.
  - **`create_offer(group, seat, entry)`** raises `seat_not_free`, `offer_pending`, `entry_not_waiting` (also covers an entry from another session), `seat_out_of_range` or `group_not_found`.
  - **`accept_offer(id)`** returns `accepted`, `already_accepted`, `declined`, `expired`, `seat_taken`, `already_booked` or `not_found`.
    - `seat_taken`: the entry goes **back to `waiting`**, so that player stays in line.
    - `already_booked`: the entry becomes `withdrawn`.
  - **`decline_offer(id)`** returns `declined`, `not_pending` or `not_found`.
  - **`expire_offers()`** returns the freed seats, so the M2 job can offer each one to the next person in line.
- **2026-10-20 · M1 T11: lock order** is offer → group → waitlist entry. Keep that order in any new RPC to avoid deadlocks. Two simultaneous "YES" replies are serialised by the offer row lock (`for update`). The race test proves it: without the lock, the second reply returns `seat_taken` instead of `already_accepted`.
- **2026-10-20 · M1 T10:** the security-definer helpers for access rules live in a `private` schema (`private.is_venue_owner`, `is_venue_member`, `is_own_player(player, venue)`), not `public`, so the Data API never exposes them. Policies call them as `(select private.fn(...))` so they run once per query.
- **2026-10-20 · M1 T10:** players can see **only their own** `players` row, not their tablemates. To show "who's at my table" later, add a server-side query or a security-definer RPC rather than loosening the access rules.
- **2026-10-20 · M1 T7:** in the sim history, waitlisted players accept offers **1 to (TTL − 1) minutes** after they're sent (14 min with the default 900s TTL), not the plan's "1–30 min". Otherwise the history would show offers accepted after they expired, which the real `accept_offer` RPC refuses.
- **2026-10-20 · M1 T7:** every cancellation in the history writes a `booking_cancelled` event, refilled or not, matching what the real `cancel_booking` RPC will do. About 70% of cancelled seats get refilled.
- **2026-10-20 · M1 T3:** `formGroups` swap search scores only the two swapped groups (`scorer([A, B])`). This is exact because every score term is a per-group sum. **If you ever add a cross-group score term** (e.g. "balance average skill across tables"), switch back to a full `scorer(groups)` re-score.
- **2026-10-20 · M1 T3:** the engine's flow is greedy seating (service order: priority ↓, requestedAt ↑, id ↑) → repair under-minimum groups (ban that table+game pair, retry) → sort each game's players into tables by skill → seeded swap search. Tables are tried smallest first, so big tables stay free for big games.
- **2026-10-20 · M1 T1:** `.gitattributes` forces LF line endings (`* text=auto eol=lf`) to stop Windows CRLF warnings and keep diffs clean.
- **2026-10-20 · Plan:** owners get **read-only** access to booking-flow tables, not the spec's "full access". This keeps seat invariants in one place (RPCs).
- **2026-10-20 · Plan:** the spec's `tables` table is named **`venue_tables`** to avoid clashing with SQL keywords.
- **2026-10-20 · Plan:** the engine's local search uses **swaps only** (no single-player moves). Swaps keep group sizes fixed, which keeps the "no free seat left unused" and "search never lowers score" guarantees true.
- **2026-10-20 · Plan:** an SMS "NO" to an offer **withdraws** the player from that night's waitlist. That stops the same seat bouncing back to them.
- **2026-10-20 · Design:** the matching engine is TypeScript, not Rust; Rust is already shown in portfolio project #8. There is no Stripe checkout; revenue = attended seats × seat price.
- **2026-10-20 · Design:** fake phone numbers come only from the Ofcom drama range `+447700900000–999`, so they can never reach a real person.

## 6. Known issues / gotchas

- **Never write the dev server's log (or any file) inside the repo while `next dev` runs.** With the log at `.superpowers/…/dev.log`, every request wrote a line, Turbopack recompiled, the page reloaded and requested again: 50–80 reloads in 6 s, blank screenshots, odd "React Client Manifest" errors. Log to the OS temp folder; Playwright's results/report go there too (`playwright.config.ts`). Same family as the Playwright MCP loop below.
- **The not-found page's text is in every page's HTML.** Next serialises `app/not-found.tsx` into each page's payload, so "Not on the board" matches real pages too. A real not-found render is the one with `<meta name="robots" content="noindex">`; check for that (or for the page's own content being absent).
- **A `redirect()` inside Suspense is not an HTTP redirect.** Once streaming has started, Next sends it in the page (`<meta http-equiv="refresh" content="1;url=…">` plus `NEXT_REDIRECT` in the payload). A browser follows it; `fetch`/curl do not — assert on `url=/target` in a smoke check.
- **Tailwind 4 colours with an opacity (`text-foreground/60`) compute to `oklab(… / α)`,** not `rgb()`. A contrast script must convert colours through a canvas (or skip nothing); a parser that only reads `rgb()` silently passes faint text.
- **The dev server sometimes keeps serving an old module** after a lib file changes ("X is not a function", or a new field missing from rows). Restart it (stop the task, kill whatever listens on :3000, `pnpm --filter web dev`); after a dependency change also delete `apps/web/.next`.
- **The Playwright MCP browser makes `next dev` reload forever.** It writes its console log into `.playwright-mcp/` in the repo; Turbopack sees the change, the page reloads, the reload logs more, and so on. Afterwards the dev server can even serve stale modules (old code after edits). For smoke tests, drive pages from a script instead (admin `generateLink` → `verifyOtp` → the `sb-127-auth-token` cookie, `base64-` + base64url of the session, then `http.request` with a `Host` header; `fetch` drops custom `Host` headers), or point the MCP's output elsewhere. Restart the dev server if pages stop reflecting edits.
- **Mutation tests leave the local database drifting from the migrations.** Restoring a function from `pg_get_functiondef` after a mutant isn't byte-identical to the migration, so `supabase db diff --local` lists those functions. `pnpm db:reset` cures it; the replay check should show "No schema changes found" after a reset.
- **`pnpm test:integration -- <files>` runs every file** (the filter is lost across the two pnpm layers). Use `pnpm --filter web exec vitest run --config vitest.integration.config.ts <files>`.
- **`server-only` throws under Vitest.** A module the integration tests import must not import `server-only` code at the top (e.g. `lib/service-client.ts`); `getBrand` imports it inside the call.
- **Git Bash rewrites arguments starting with `/`** into Windows paths (`/manage/x` → `C:/Program Files/Git/manage/x`). Prefix the command with `MSYS_NO_PATHCONV=1`.

- **Two Claude sessions in one folder share one checkout.** On 2026-10-21 another session switched this folder to a new branch (`gmail-smtp`) and committed there, and my next commit landed on that branch by accident. Before committing, check `git branch --show-current` and `git status`. When another session's uncommitted edits are present, move a commit with a temporary `git worktree` + `cherry-pick` rather than switching branches or stashing their work.

- **Seeding users straight into `auth.users` breaks Supabase Auth unless the token columns are `''`.** Rows with NULL `confirmation_token`, `recovery_token`, `email_change*`, `phone_change*` or `reauthentication_token` make GoTrue's user listing fail ("Database error finding users" — `invites.test.ts` went red) and `getUserById` return nothing (their emails get `skipped`). Create test users with `auth.admin.createUser`, or set those columns to `''` when inserting by SQL.
- **After a reboot, start Docker Desktop, then `pnpm exec supabase start`.** The local data survives; Docker doesn't start on its own here.

- **Realtime: wait for the database listener, and expect replays.** `SUBSCRIBED` can arrive a moment before Realtime registers the `postgres_changes` listener; changes in that gap are missed. Wait for the system message `{ extension: 'postgres_changes', status: 'ok' }` when it matters (tests do). A new subscription can also receive rows committed just before it subscribed, so match events by id, never by count, and re-read counts instead of incrementing.
- **Dev server: endless page reloads → delete `apps/web/.next`.** Twice, after the dev server had been killed abruptly (force-stopped, or by Claude Code's low-memory reaper), every page reloaded 3–6 times a second ("[HMR] connected → [Fast Refresh] rebuilding" in the browser, "✓ Compiled in 1ms" after each page load on the server). Ruled out: browser cache (dev chunks are `no-cache`), file writes in the repo, plain HTTP requests, `next build` while dev runs, and starting dev after a build. Stopping the server, deleting `apps/web/.next` (build output only) and starting again cured it — most likely a damaged Turbopack dev cache in `.next/dev`. Also: when Claude Code stops a background dev server, part of it can survive on :3000 with dead render workers ("Jest worker encountered 2 child process exceptions" → 500s); kill whatever listens on 3000 before restarting.
- **Start the dev server with `pnpm --filter web dev`** from the repo root. A backgrounded `cd apps/web && pnpm dev` once ran at the root ("Command dev not found").
- **pgTAP + `set local role authenticated`:** a temp table created by the test is invisible to that role unless you `grant select on <temp table> to authenticated`.

- **Server-sent auth emails can't use PKCE.** `auth.admin.inviteUserByEmail` (and other admin-sent links) put the session in a URL fragment, which a server route never sees. Give them a template that links to our callback with `{{ .TokenHash }}` and verify with `verifyOtp`. Email templates only load on `supabase stop && supabase start`.
- **Keep "Confirm email" on in the hosted project.** Invite acceptance trusts the signed-in email; every sign-in path we use proves it (magic link, invite token, Google).
- **pgTAP tests must not assume an empty database.** Scope counts to the test's own fixture ids and use fixture slugs no real venue would take, so `pnpm db:test` works beside local data. To prove migrations apply from scratch without `db:reset`, run `pnpm exec supabase db diff --local --schema public` (replays every migration in a shadow DB; expect "No schema changes found").
- **In a Next route handler, `request.url` carries Next's own hostname, not the one the browser used.** On `dhanmondi-turf.localhost:3000` it says `localhost:3000`, so redirecting with `new URL(next, request.url)` sent venue sign-ins to the root site's `/me` (a 404). Build redirect origins with `requestOrigin(host, request.url, root)`, which validates the Host header first.
- **Sessions are per host.** Supabase's auth cookie is host-only, so signing in on `localhost:3000` doesn't sign you in on `<slug>.localhost:3000` and vice versa. Players sign in on the venue's subdomain; owners on the root. Sharing a session across subdomains (cookie `Domain=.<root>`) is a later decision.

- **React 19 clears form inputs after every form-action submission, errors included.** Our `ActionForm` (`components/forms/action-form.tsx`) submits through `onSubmit` + `startTransition` instead, so inputs survive validation errors and schedule clashes. Pass `resetOnSuccess` on "add" forms that should clear after a save. Keep this if you refactor the form.

- **supabase-js + Cache Components: `await connection()` before creating the server client.** supabase-js reads `Date.now()` while loading the session. Next 16 rejects that during prerendering ("encountered the unstable value Date.now()"), and the page renders empty. `lib/supabase/server.ts` calls `await connection()` first. Keep that line.
- **The dev server can keep serving an old `messages/en.ts`** after you add keys (new labels render empty, e.g. a blank "Cancel invite" button), even without an orphan process. Restart it. Also: **stopping a background `next dev` task leaves the node process running.** It keeps port 3000 and serves stale modules (e.g. "m.onboarding is undefined" or "reading 'availability' of undefined" right after editing `messages/en.ts`). To fix it, kill whatever listens on 3000: PowerShell `Get-NetTCPConnection -LocalPort 3000 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`, then restart.
- **Playwright MCP can only upload files from inside the repo** (or `.playwright-mcp/`, which is gitignored), not from the system temp folder.

- **An unknown venue subdomain returns HTTP 200 with `noindex`, not 404.** The tenant layout calls `notFound()` inside `<Suspense>` (Cache Components needs the params read there), and once streaming has started Next can no longer change the status code. The "not available" page still renders and search engines skip it. Unknown or nested hosts, and `/t/...` typed on the root host, are rewritten in `proxy.ts` and do get a real 404.
- **Grepping server HTML for copy is unreliable.** Next embeds the not-found UI and metadata in every page's data payload, so check rendered output in a browser instead.

- **SQL `CHECK` constraints pass on NULL.** `team_size >= 1` with a null `team_size` evaluates to NULL, and a CHECK only fails on false. Write `team_size is not null and …` explicitly. The Stage A schema test caught this on `activities`.

- **Next.js 16.4 is newer than most AI training data.** `apps/web/AGENTS.md` says to read the bundled docs at `apps/web/node_modules/next/dist/docs/` before writing Next code. Do that. Notable differences:
  - `LayoutProps<"/">` / `PageProps` are **global generated types**, created by `next dev`, `next build` or `next typegen`. That's why `apps/web`'s `typecheck` script is `next typegen && tsc --noEmit`; plain `tsc` fails on a clean checkout.
  - The template enables `cacheComponents` and `partialPrefetching` in `next.config.ts`.
  - Turbopack compiles workspace packages (`@bm/engine`, `@bm/sim`) automatically, so **no `transpilePackages`** is needed.
- **Don't keep a nested `pnpm-workspace.yaml`** in `apps/web` (`create-next-app` writes one). pnpm treats the nearest one as the workspace root. Its `allowBuilds` (sharp, unrs-resolver: false) now lives in the root file.
- **shadcn 4 (`base-nova` preset)** uses `@base-ui/react` (not Radix) and the `cn` package (by shadcn; replaces clsx + tailwind-merge). `lib/utils.ts` re-exports `cn` from it.
- shadcn's `globals.css` references `var(--font-sans)`, so the Geist font in `layout.tsx` registers its variable as `--font-sans`. Without that, the font silently falls back.
- **Venue colours** are inline CSS variables set by `brandingToCssVars` (`lib/theme.ts`): the root layout uses the platform palette, the tenant layout uses the venue's branding with its preset as fallback. Only `--primary` and `--accent` are overridden; other shadcn tokens keep their defaults. Dark mode isn't branded yet.
- **fast-check `shuffledSubarray`:** `maxLength` must not exceed the source array's length, or every property errors out immediately (looks like 6 failures in ~1ms). See `packages/engine/test/arbitraries.ts`.
- **Vitest 5 hides `console.log` output by default.** To see benchmark output, run `npx vitest run test/bench.test.ts --silent=false --reporter=verbose` (from `packages/engine`).
- **How to check property tests still have teeth:** break one rule in `form-groups.ts` (e.g. `<` → `<=` on capacity), run the property tests, and confirm one goes red. Then `git checkout` the file.

## Numbers (for the case study)

- `formGroups` with 500 players, 10 games, 60 tables, 2000 swap iterations: **median 2.04ms** (2026-10-20, dev laptop).

## 7. Upgrade ideas / future work

- **R2 review minors (deferred, 2026-10-28)** — from the final fresh review of `r2-public-site`; none blocks merge:
  - `app/layout.tsx` `generateMetadata` uses `'use cache'` + `loadBrand`, so `next build` prerenders the title from the database (the build needs DB access and `SUPABASE_SECRET_KEY`), and a rename or go-live shows only after the cache revalidates. Decide before Stage E: uncached metadata, or `revalidateTag` on brand changes.
  - Every page has the same `<title>` (the brand name). Add per-page titles (`title.template`) for tab and screen-reader users (WCAG 2.4.2).
  - pgTAP `18_matte_colours` "no section keeps an old default" is vacuous on a reset database (seed rows are made after the migration). The repaint UPDATEs rest on the manual Task 2 check; to pin them, replay the UPDATEs over fixture rows inside the test.
  - An over-subscribed but still *open* game says "Full · join the waitlist", and asking then reads "You've asked for a seat…" (correct: seats are picked fairly at the cut-off). Better copy for open games, e.g. "More asked than seats — we pick fairly at the cut-off".
  - Offer pages (`/offers/<token>`, `/me/offers/<id>`) are always in the turf colour: `OfferView` has no section id yet.
  - Settings still offers an accent colour and a logo upload that the R2 site never shows (`brandingToCssVars` is unused there; primary is used in emails only). Drop or rewire in R3. If R3 adds a section colour picker, it must check contrast (the spec leaves hand-picked colours alone).
  - Home status pill: the plan narrowed the spec's "earliest open to latest close across sections" to "latest close among sections open now", so at 11:00 it says "Open till 11 PM" while the lounge opens later and runs till 2 AM (the section cards are right).
  - `/<unknown>/book` signed out asks for sign-in before showing the 404 (`requireUser` runs before `findSection`).
  - The `section` button variant's press scale (`components/ui/button.tsx`) is outside the reduced-motion query.
  - Nits: a section card's join button with no game links to a page saying "No open matches yet"; "Hours this week" highlights Saturday at 01:00 while the lounge is still on Friday's hours; unused strings `m.openPlay.full`, `seatsLeft`, `perSeat`.
  - Set aside by the reviewer and kept as is: `www.<root>` and the apex keep separate sign-ins until hosting redirects one to the other (Stage E); a suspended brand can only be restored in the database now that `/admin` is gone (`brand:setup` leaves it suspended); non-GET requests to old hosts get 405.
- **Product name still to be decided.** The UI uses the working name "Booking & Matchmaking" from `apps/web/messages/en.ts` (`m.platform.name`). Change it there once the user picks a name, and set the root domain in `NEXT_PUBLIC_ROOT_DOMAIN`.

**One Brand R1 review minors** — fixed on 2026-10-27 (migration `20261027010000_r1_review_minors.sql`, pgTAP `17_r1_review_minors`, `brand.test`): repeat-request priority per section; explicit execute grants on the section helpers; `brand:setup` takes back a section whose spaces or games failed to insert; `--owner` replaces a pending staff invite; the "section in use" copy; staff actions check team membership before any lookup. Still open: games of a venue with several branches all went to its first section (`…010100`); the hosted rollout's read-only check confirms no such venue exists before `db push`.

**Deferred minor findings from the Stage B2 review** (open play), each worth a test plus a fix when touched next:
- A withdraw racing a match makes `apply_match` raise `invalid_match`: Match now shows an error page, and the tick's match loop stops for that tick (no per-session try).
- Favourites naming deactivated activities still count in `request_seat`/`offerNext`/`wants_game` (`planMatch` ignores them), so such a player can't be seated late or offered a seat in a players-choose session.
- The repeat-request priority rule differs from spec §3: post-match requesters never earn it; requesters of a never-matched session, and players who withdrew or declined, do.
- `cancel_open_play_session` doesn't refuse a session that has started (a stale button within the 10 s before the tick closes it).
- **Before the hosted deploy:** the first tick closes every past `open`/`matched` session in history and emails "no seat" to its players, possibly weeks late. Silently close old sessions in a migration first.
- The tick matches, closes and emails for suspended venues too (no venue-status filter).
- "Seat cancelled. We offered it to the next player." shows even when nobody was waiting (`cancelSeat` ignores `offerNext`'s result).
- My bookings shows upcoming seats only; `listMySeats` already returns past ones (spec §7 asks for both).
- Waitlist copy says "You're #2", but offers go by skill fit first; consider "You're on the waitlist (n waiting)".
- `respondByTokenAction` checks the venue from a bound argument, not the request host (harmless: the token is the secret).
- Also open: `deliverPendingEmails` (B1) treats an Auth lookup error as a final `skipped` instead of a retryable failure, which now matters for offer emails; and `05_schedule.test.sql` (Stage A) uses fixed dates in November 2026 and starts failing on 2026-11-13.

**Deferred minor findings from the M1 review**, each worth a test plus a fix when the area is touched next:
- ~~Cross-venue references~~ — fixed in Stage A's final review with composite foreign keys (see §5).
- **Owner can attach any login.** `players_owner_all` lets an owner insert a player row with `user_id` set to *any* login. Players can also set `phone` to any number, which only matters once real Twilio sending is wider than presenter mode.
- **RPCs don't check session state.** `create_offer` / `accept_offer` don't look at `sessions.status` or `starts_at`, so an offer could be made or accepted for a closed or past night.
- **Duplicate player ids** in `formGroups` input get seated twice. The DB prevents duplicates upstream; add a dedupe or assert in the engine.
- **The repair step's bans are permanent.** It bans a table+game pair forever, so a group dissolved early can't re-form even if enough players later arrive. This affects seating quality, not correctness.
- **Clock-change gap times.** `zonedTimeToUtc` turns a wall time that doesn't exist on the spring-forward day (e.g. 01:30) into 02:30 BST. Reasonable, but untested.
- **Rounding mismatch.** `seconds_since_cancel` is rounded down (`floor`) in the RPC but rounded to nearest (`Math.round`) in the sim, so analytics may differ by 1s.
- **Missing events.** `accept_offer` writes no event for `seat_taken` / `already_booked`. Every other state change has one.

**Deferred minor findings from the Stage B1 final review** (fix before production / when touched):
- `claim_pending_emails`' OR filter can't use the pending partial index → a seq scan every 10 s; add a partial index on `email_status in ('pending','sending')`.
- `cron.job_run_details` grows ~8,640 rows/day; add a cleanup job or turn off `cron.log_run`.
- Double submit at the booking limit answers "limit reached" instead of "already yours".
- `book_resource` price math is int and overflows above ~৳22,000/h × 960 min; cast to numeric and bound the price input.
- Email sends have no timeouts (a >5 min hang lets the next tick reclaim and double-send); `/api/jobs/tick` builds the sender before the tick, so missing EMAIL_* vars make every tick a 500 — **move sender creation into the email step before B2 adds steps**.
- The staff "+ Walk-in" form shows on a non-live venue but always fails; a tampered walk-in `startsAt` → RangeError 500; a multi-slot booking running into another booking says "just taken" while its start shows Free.
- Integration tests claim the local DB's real pending notifications (demo emails get marked sent/failed without sending).
- Deleting an auth user with bookings fails (history is protected); account deletion will need anonymisation.

**Deferred minor findings from the Stage A final review** (fix with a test when the area is next touched):
- **Before Stage B/C writes real bookings:** `on delete cascade` from `player_profiles` and `activities` would erase booking history. Switch to `restrict`/`set null` plus soft deletes.
- The last-owner guard is check-then-write: two owners removing each other at the same moment can leave none. Enforce it in the DB.
- Deleting a branch that ever had a session fails (23503) and shows the raw Postgres text. Map it to a message, like `activityInUse`.
- No upper bound on money input (above int4 poisha gives a 500). A one-emoji venue name passes the JS 2-character check but fails the DB CHECK.
- Admin "Restore" always sets `live`; restoring a suspended *onboarding* venue skips the owner's publish. Restore the previous status instead.
- Unknown or suspended venue returns 200 + noindex, not 404 (see §6).
- A re-uploaded logo keeps its URL (cached for 1h); switching png→jpg leaves the old file. Use versioned file names.
- The schedule form lists every branch's resources and accepts past dates.
- The slug can't be edited even during onboarding.
- `saveProfile` is select-then-write: a double submit says "phone already used", and `phone_taken` lets a signed-in user probe whether a number is registered at a venue.
- `organizations.created_by` is readable by any signed-in user (table-wide select grant).
- `createOrganization` isn't atomic; a crash mid-way leaves an owner-less org holding the slug.
- The "Invite cancelled" confirmation never shows (its row disappears on refresh).

- Second skin (padel courts or gym classes) to prove re-skinning works (stretch goal).
- The swap search already re-scores only the two groups a swap touches (delta scoring). For much bigger venues, the next win is replacing the linear `seatings.find(...)` scans in the greedy `seatPass` with per-game open-group queues.

## 8. Change log

- **2026-10-28: R2 (public site) built on `r2-public-site`** (11 tasks; not merged, hosted untouched). Commits: tokens and fonts (`18a00d6`), matte section colours migration `20261028010000` (`a243b32`), site helpers (`c1b6a81`), coming-up games and root links (`647e51c`), one host and old-link redirects (`8be6613`), site components, motion and photos (`3bf6b7d`), shell + home + section pages (`cf12a77`), booking / game / offer pages (`20f5c16`), profile with ratings per section, My bookings, sign-in (`27d2bd5`), old routes removed + manage contrast pass (`f373113`), e2e journey and docs. Suite: typecheck, lint, build, unit 51/23/228, pgTAP 365, advisors clean, race 4, integration 110, e2e 1 journey (3 sections), replay "No schema changes found". Found by browser checks and fixed: a booked slot stayed picked; the dev-log reload loop; phone layout of the availability times. Final fresh review (Opus): 0 Critical, 2 Important, 10 Minor. Both Important fixed RED→GREEN in one pass: sign-in was behind the "Not open yet" gate (so staff couldn't sign in to publish a brand that isn't live) → `/signin` in its own `(auth)` group, e2e `r2-not-live`; old `/book` links 404'd (RF1) → mapped to the section's booking page, `route.test` + `site.test`. Minors deferred (§7). Suite after the fixes: typecheck, lint, build, unit 51/23/230, pgTAP 365, advisors clean, race 4, integration 111, e2e 2, replay clean. The local DB has extra bookings/requests from checks (players 12 and `e2e-*`). **Next:** merge (the user's call); the hosted rollout (README → Rolling R2 out: `supabase db push` for the colours) needs the user's go-ahead.
- **2026-10-27: R1 rolled out to hosted** (`rhycdpswtiitjhzoczfq`) and `main` pushed to GitHub (`ba51e6c`). Before: Chattoturf live with 1 branch, 1 owner, no staff/invites/sessions/bookings/players, so no venue had two branches. `supabase db push` applied the four R1 migrations; `pnpm brand:setup` added the café and lounge: Chattoturf now has 3 sections (turf, cafe, lounge), 14 spaces, 15 games. Hosted advisors: only the Auth warning "leaked password protection disabled" (we use email links and Google, no passwords). `.env.local` is back on local (`demo-brand`). The project-local `.claude/settings.local.json` (gitignored) allows Claude to run the rollout commands (`db push`, `env:hosted`/`env:local`, `brand:setup`, linked advisors).
- **2026-10-27: R1 review minors fixed** (branch `r1-minor-fixes`, merged to `main`): see §7. Suite: unit 51/23/210, build, pgTAP 359, advisors clean, race 4, integration 110, replay clean.
- **2026-10-27: One Brand R1 merged to `main` locally** (fast-forward to `8483837`; branches `one-brand-r1` and `one-brand-design` deleted). The full suite was re-run on merged `main`: typecheck, lint, build, unit 51/23/210, pgTAP 351, advisors clean, race 4, integration 108. **Not pushed to GitHub yet; the hosted rollout (README → Rolling R1 out) still waits for the user's go-ahead.** Next stage: R2, the public website on one host.
- **2026-10-25: One Brand R1 (foundation) built on `one-brand-r1`** (not merged; hosted untouched). Commits: sections (`53419e2`), games and ratings per section (`9c7d56c`), the web app on sections (`8f2c8d9`), open play and profiles on ratings (`71faa91`), staff per section (`8b1c95e`), brand setting and `pnpm brand:setup` (`2228ff4`), docs. Migrations `20261025010000_sections`, `…010100_section_games_and_ratings`, `…010200_section_staff`. Final fresh Opus review: 0 Critical, 1 Important, 11 Minor; one fix pass (section_* names, brand:setup makes an onboarding brand live, write-barrier tests, rollout docs), 7 minors deferred (§7). Full suite after the fixes: typecheck, lint, build, unit 51/23/210, pgTAP 351, advisors clean, race 4, integration 108; the migrations replay with no schema changes. The local database was reset (the user approved replacing the old Dhanmondi demo venue) and now holds **Demo Arena** (`demo-brand`, owner `owner@demo-arena.test`, 12 demo players, one open game per section). **Hosted rollout after merge** (README → Rolling R1 out): a read-only check that no venue has two branches, `supabase db push`, `pnpm env:hosted`, `pnpm brand:setup --owner <email>` (adds the café and lounge to Chattoturf; `--name` only names a new brand) — each needs the user's go-ahead. Chattoturf's existing staff get only the turf (the sections at push time); flip owner→staff to give them all until R3 has a screen.
- **2026-10-25: One-brand redesign spec written** (`docs/superpowers/specs/2026-10-25-one-brand-sections-design.md`, branch `one-brand-design`). The user's decisions: one client's business (not reused for others), all three sections in one place, approach A (branches become sections, the organization row is the brand), staff per section, skill per section, hours and rules per section, one brand look with section accents. Build stages: R1 foundation (data, access rules, migration, `pnpm brand:setup`), R2 public website, R3 manage area. Awaiting the user's review of the spec, then the R1 plan.
- **2026-10-21: Gmail sending support kept on `main`.**
  - What it adds: `EMAIL_TRANSPORT=smtp` takes an optional `SMTP_USER` / `SMTP_PASS` (e.g. Gmail: `smtp.gmail.com`, port 465, an App Password; `EMAIL_FROM` must be the Gmail address). Port 465 uses TLS from the start; other ports upgrade with STARTTLS. `smtpOptions()` is in `lib/email/sender.ts`, and `pnpm env:hosted` keeps `SMTP_USER`, `SMTP_PASS` and `RESEND_API_KEY` when they're set.
  - Where it came from: another Claude session wrote it on a `gmail-smtp` branch in this same folder, then put the files back on disk uncommitted. At the user's choice I cherry-picked it onto `main` and deleted the branch.
  - Not configured: Gmail's 2-Step Verification wouldn't turn on for the user's account, so there's no App Password yet.
- **2026-10-21: Google sign-in on the hosted project; the one-brand direction confirmed.**
  - **Google OAuth:**
    - Google Cloud project `booking-and-matchmaking-web`, owned by the user's "S" Google account. The `mirazihsan21` account has no access to it, which caused a "missing permissions" page.
    - Google Auth Platform: External, **Testing** (test users only, up to 100). OAuth client "Supabase" (Web application), redirect URI `https://rhycdpswtiitjhzoczfq.supabase.co/auth/v1/callback`. The first attempt gave `redirect_uri_mismatch` until the URI was saved exactly.
    - Supabase → Sign In / Providers → Google is enabled (`/auth/v1/settings` shows `google: true`). `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in `.env.local`, and `pnpm env:hosted` keeps it.
    - Click **Publish app** under Audience when everyone may sign in; basic scopes need no Google review.
  - **Email:** the Gmail SMTP route stalled (2-Step Verification wouldn't turn on: a security-key prompt), and Resend is waiting for a domain. So email-link sign-in on hosted still reaches team members only; Google sign-in is the players' route for now.
  - **Direction:** the user confirmed that the one-brand business will run **all three sections** (turf, board-game café, gaming lounge) **under one brand: one website, one sign-in.** Today each section is a separate venue chosen in the onboarding wizard (`presets/{turf,boardgame,lounge}.ts`). The redesign brainstorm starts from this.
  - **Rename:** the turf preset's "7-a-side" is now **"7-a-side football"**, matching "5-a-side futsal" (the user found the bare name unclear). Existing rows were renamed too: Chattoturf on hosted, Dhanmondi Turf locally.
- **2026-10-21: Direction from the user: Resend first, then a one-brand business.** Email goes through Resend: the account comes first; the domain is verified once the user has the brand's domain. Until then, development email stays in Mailpit, because Resend only reaches the account owner without a verified domain. **After that the product shifts from a multi-business platform to one brand's own business.** That's an architectural change, so it needs a brainstorm, a spec and a plan before any code. Bookings, matching, offers and payments carry over; the tenancy, onboarding and many-venues layer gets simplified. The brand's domain becomes the website address and the email sender. The Google OAuth setup was started (Cloud project "Booking and Matchmaking Web") but paused in favour of Resend.
- **2026-10-21: Stage B2 merged to `main`** (`f1f1988`, a merge commit because `main` carries GitHub's initial-commit merge; the merged tree is identical to the reviewed branch). The suite was re-run on merged `main`: unit 51/23/205, build, pgTAP 286, advisors clean, race 4, integration 84. Pushing `main` merged the GitHub PR; the local branch is deleted. The remote `stage-b2-open-play` can be deleted on GitHub. Next: players' sign-in email (Resend SMTP or Google OAuth), then Stage C (bKash) or deployment (Stage E).
- **2026-10-21: First venue on the hosted project.** The user set the Auth URL configuration (Site URL `http://localhost:3000`; redirects `http://localhost:3000/**`, `http://*.localhost:3000/**`), signed in with their Supabase account email and published **Chattoturf** (`chattoturf`, turf: 1 branch, 3 spaces, 3 formats). The hosted project has 1 auth user. Players can't sign up yet: built-in email reaches team members only, so custom SMTP (Resend) or Google OAuth comes next.
- **2026-10-21: GitHub and hosted Supabase.** The GitHub repo is `origin` = https://github.com/mirazihsan21-web/Booking-Matchmaking-Website. Its own "Initial commit" (a README) was merged into `main` keeping our README (`f80d200`, no force-push), and `main` (Stages A + B1) is pushed. Claude Code's permission check blocked my push of `stage-b2-open-play`, so the user pushed it with `!` and opened the PR on GitHub. **The app now uses the hosted Supabase project `rhycdpswtiitjhzoczfq`** ("Booking & Matchmaking", ap-northeast-2), at the user's request:
  - The user signed the CLI in with the owner account. I linked the project and ran `db push` (all 19 migrations, onto an empty database); advisors on the hosted project are clean (`supabase db advisors --linked`).
  - `pnpm env:hosted` (`apps/web/scripts/write-env-hosted.mjs`) writes `.env.local` from `supabase/.temp/project-ref` plus `supabase projects api-keys --reveal`. The secret key (`sb_secret_…`) is masked without `--reveal`. It keeps `JOB_SECRET` and the email settings. `pnpm env:local` switches back.
  - **Tests stay on the local stack on purpose:** they create and delete users and venues and pause the cron tick. global-setup reads `supabase status`, not `.env.local`; `db:test` and `db:reset` now pass `--local` explicitly, because the project is linked.
  - While the local stack runs, its pg_cron tick calls the dev server, whose service client now talks to the hosted database. So matching, expiry and closing run on hosted data in development, and app emails go to the local Mailpit. The hosted pg_cron tick does nothing: Vault has no `app_url`, and it couldn't reach localhost anyway.
  - **Still to do on hosted:** URL configuration (Site URL plus `*.localhost` redirects); custom SMTP (built-in email reaches team members only); the invite email template; Google OAuth. The hosted database starts empty; the local demo venue isn't copied.
- **2026-10-21: Stage B2 built** on `stage-b2-open-play` (9 tasks): open-play requests, matching at the cut-off or on **Match now** (groups + balanced teams), waitlist offers with one-time email links, seat cancellations, closing at the start, the player session/offer pages, Seats in My bookings, and the staff session view. Two migrations (`20261021020000_open_play_requests`, `20261021020100_open_play_offers`). Counts: engine 51, sim 23, web unit 205, integration 82, pgTAP 285, race 3; advisors clean; migrations replay from scratch. Browser journey on Dhanmondi Turf (Fri 23 Oct 8pm): 12 requests → two teams (skill 13 v 14) + 2 waitlisted; a cancelled seat offered by email, taken from the link; an ignored 60 s offer passed on; a session matched by the tick at its cut-off and closed at the start with "no seat" for those still waiting. The local DB now holds 11 seeded test players (`b2-*@example.test`) and that session's history. Final review (fresh Opus): 0 Critical, 4 Important — 3 fixed RED→GREEN (stranded seats, lost hand-offs, match-cap starvation), 1 re-graded (accept vs cancel serialises through the FK lock; race test added); 10 Minor deferred (§7). Final counts: web unit 205, integration 84, pgTAP 286, race 4.
- **2026-10-21: Stage B1 merged to `main`** (fast-forward through `stage-b-design`, which carried the Stage B spec and the B1 plan; both branches deleted). Next: the B2 plan (open play, matching, waitlist offers). Its first step is the deferred fix that moves email-sender creation into the tick's email step. Waiting on the user for bKash sandbox access, a product name + root domain, and Google OAuth credentials.
- **2026-10-21: Stage B1 final review and fix pass.** A fresh reviewer found 0 Critical, 4 Important and 9 Minor issues; I fixed the 4 Important ones plus 2 re-graded Minors (time-bomb fixtures, overnight "today"), each with a test that failed first, and deferred 7 (§7). Two new migrations (`20261021010000_attendance_after_start`, `20261021010100_branch_in_payloads`). Counts: web unit 191, integration 65, pgTAP 213, race 3. Browser-checked: branch picker, branch in My bookings and notifications, attendance hidden on future bookings.
- **2026-10-20/21: Stage B1 built** on `stage-b1-bookings` (11 tasks): booking-history protection, venue booking settings + slot length, the notifications outbox with a live bell, email delivery (Mailpit/Resend), the 10-second `pg_cron` → `pg_net` → `/api/jobs/tick` job, whole-space bookings with walk-ins, the slot grid, `/book`, `/me/bookings`, `/me/notifications` and the staff Bookings day view. Tests: engine 51, sim 23, web unit 183, integration 62, pgTAP 211, race 3; advisors clean; migrations replay from scratch. The browser journey found and fixed a bell double count. Final review pending.
- **2026-10-20: Stage B spec written** (branch `stage-b-design`), awaiting the user's review. Next: the B1 plan.
- **2026-10-20: Stage A merged to `main`** (fast-forward from `640a2c5`; branch `stage-a-platform-foundation` deleted). The merged tree was re-verified: typecheck, unit, pgTAP, race and integration tests. Next up: the Stage B spec and plan (booking & matchmaking). Start with the deferred cascade-into-bookings minor (§7).
- **2026-10-20: Stage A final review and fix pass.** A fresh reviewer found 0 Critical, 3 Important and 15 Minor issues. I fixed the three Important ones and three Minor ones re-graded to Important (cancel invites, reserved slugs, `.env.example`), each RED→GREEN, and deferred the other 12 Minor ones (§7). Two new migrations. Counts now: engine 51, sim 23, web unit 123, web integration 38, pgTAP 143, race 1; advisors clean, build clean. Invite and cancel flows checked in a real browser.
- **2026-10-20: Stage A (platform foundation) built** on branch `stage-a-platform-foundation` (15 tasks). What now works:
  - Multi-tenant schema with organizations, members, invites, branches, resources, activities, open-play sessions, player profiles and platform admins. The M1 venue tables were dropped (nothing was deployed).
  - Email-link sign-in (Google ready behind a flag), venue subdomains, the self-serve wizard (type → name/slug → branding/logo → location → review → publish), owner admin for branches, spaces, activities, staff, settings and the weekly open-play schedule (clash and opening-hours checks), a venue's public page, player profiles, and `/admin` with suspend/restore.
  - Engine: `splitTeams` for two balanced teams.
  - Tests: engine 51, sim 23, web unit 100, web integration 36, pgTAP 132, race 1. `db:lint` (advisors) clean, `next build` clean.
  - Browser journey verified end to end: owner signs up → turf venue published → 4 weekly 5-a-side matches → a player signs up on the subdomain and saves a profile → admin suspends ("not available") → restores.

- **2026-10-20: Pivot to a real product.** The user wants a real, re-skinnable, multi-tenant booking & matchmaking platform for BD cafés, turfs and gaming lounges. The new spec `2026-10-20-booking-platform-design.md` supersedes the demo spec and the M2 demo plan. Next up is Stage A (platform foundation).

- **2026-10-20: M1 complete and merged to `main`** (fast-forward; branch `m1-foundation` deleted). Merged `main` re-verified: install, typecheck, unit, pgTAP and race tests all green. Final test counts:
  - Unit and property tests: engine 41, sim 23, web 7.
  - Database: 85 pgTAP checks, plus 1 two-connection race test.
  - Typecheck and `next build` are clean.

  A fresh-reviewer pass found 1 Critical and 2 Important issues; all are fixed with tests that failed first. The 8 Minor findings are deferred (listed in §7).

  Smaller M1 decisions not covered above:
  - `generateVenue` takes an optional `skin`. Sim venue and player rows omit `created_at` and use the DB default.
  - Every foreign-key column has a full (non-partial) index, and pgTAP enforces it.
  - `create_offer` also raises `seat_out_of_range` / `group_not_found`.
  - All three migrations were **edited in place** during M1 because nothing was deployed. **From M2 on, schema changes must be new migration files.**
- **2026-10-20:** M1 Tasks 1–8 done on `m1-foundation`: engine (41 tests incl. property tests, 2ms/500 players), sim (23 tests), web shell (7 tests, `next build` OK). Supabase CLI 2.121.0 + `supabase/config.toml` (Postgres 17, ports 54321/54322/54323) added. **Tasks 9–11 (schema, RLS, RPCs) are blocked:** this machine has no WSL2 or Docker Desktop, and local Supabase needs both.
- **2026-10-20:** Spec and M1 plan committed (`dd38762`, `e5677ab`). Started M1 on branch `m1-foundation`.
