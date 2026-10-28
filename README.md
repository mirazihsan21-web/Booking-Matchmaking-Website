# Booking & Matchmaking

Booking and matchmaking for **one brand in Bangladesh that runs a turf, a board-game café and a gaming
lounge in one place**, built by Console Log Studio. One website, one sign-in: players book a pitch, a table
or a PC, and join open games where a matching engine forms fair groups (or two balanced teams) at the
section's cut-off and offers cancelled seats to a fair waitlist. Staff run their sections from `/manage`.
bKash payments land in Stage C.

"Booking & Matchmaking" is a working name (see `m.platform.name` in `apps/web/messages/en.ts`).

> Platform spec: [`docs/superpowers/specs/2026-10-20-booking-platform-design.md`](docs/superpowers/specs/2026-10-20-booking-platform-design.md)
> · One-brand redesign: [`docs/superpowers/specs/2026-10-25-one-brand-sections-design.md`](docs/superpowers/specs/2026-10-25-one-brand-sections-design.md)
> · Project notes for maintainers: [`memory.md`](memory.md)

**One brand.** The brand is an organization row; its **sections** (turf, café, lounge) each have their own
hours, booking rules, spaces, games, ratings and staff. R1 (the foundation) and R2 (the public site, spec
[`2026-10-28-r2-public-site-design.md`](docs/superpowers/specs/2026-10-28-r2-public-site-design.md)) are
built; the manage area's redesign (R3) is next.

## Repo layout

| Path | What it is |
|---|---|
| `packages/engine` | Pure TypeScript matching engine: `formGroups`, `rankWaitlist`, `splitTeams`, `explainScore`. No I/O, seeded RNG. |
| `packages/sim` | Seeded fake data shaped as DB rows (still the M1 shapes; reworked in Stage B). |
| `apps/web` | Next.js 16 app (Tailwind 4, shadcn/ui). Business-type presets in `presets/`, all copy in `messages/en.ts`. |
| `supabase/` | Migrations, pgTAP tests and a two-connection offer race test. |

`apps/web` routes:

Everything is on one host (`localhost:3000` locally):

| Path | What |
|---|---|
| `/` | The landing page: a hero made of the three sections' photos, our services (price from, spaces, today's hours, games, book / join), how it works, games coming up, why play here, hours and location |
| `/<section>` (`/turf`, `/cafe`, `/lounge`) | The section: its photo, open games, what you can play, the week's hours |
| `/<section>/book` | Book a space: space tags, a 7-day strip, the slot grid and a sticky **Book** bar |
| `/sessions/<id>` | A game: seats left, request a seat / join the waitlist, your team once matched |
| `/offers/<token>`, `/me/offers/<id>` | A seat offer (from the email link, or the bell) |
| `/signin` | One sign-in for players and staff (email link; Google when enabled) |
| `/me`, `/me/bookings`, `/me/notifications` | Profile with a level per section, bookings and seats, notifications |
| `/manage` → `/manage/<brand slug>/…` | Owners and staff: sections, spaces, games, schedule, bookings, staff, settings |

`proxy.ts` refreshes the session. A link to an old venue subdomain (`<slug>.<root>/…`, from R1 emails)
gets a 308 to the same page on the root host (through `/api/moved`); an old booking link
(`/book?section=…&resource=…&date=…`) goes to its section's booking page with the same space and day, or home
when its section is unknown. `/t/…` is not found.

## Prerequisites

- **Node 24+**
- **pnpm 12** via Corepack. On Windows without admin rights:
  `corepack enable pnpm --install-directory "$env:APPDATA\npm"`
- **Docker Desktop** (WSL2 backend on Windows) for the local Supabase stack

## Getting started

```bash
pnpm install
pnpm db:start            # local Supabase: API :54321, DB :54322, Studio :54323, Mailpit :54324 (SMTP :54325)
pnpm env:local           # writes apps/web/.env.local and points the database's job tick at this app
pnpm brand:setup --name "Demo Arena" --demo   # the local demo brand (BRAND_SLUG=demo-brand), see below
pnpm --filter web dev    # http://localhost:3000 (keep it on :3000: the job tick calls it)
```

The demo brand, **Demo Arena**, is live at http://localhost:3000 with three sections, 12 rated demo players
(`demo-demo-brand-<n>@example.test`) and an open game per section (re-run `--demo` to add a game to any
section whose games have passed). Its owner is `owner@demo-arena.test`; to manage it yourself:
`pnpm brand:setup --owner you@example.com` (an existing account becomes the owner at once; a new address
gets an owner invite, accepted at its first sign-in).

Sign in at http://localhost:3000/signin with any email address; the link lands in Mailpit at
http://127.0.0.1:54324 (nothing leaves your machine). Set your level per section at `/me`, then book a space
or ask for a seat in a game. Staff go to http://localhost:3000/manage.

### Using the hosted Supabase project

The app can run against the hosted project (`rhycdpswtiitjhzoczfq`) instead of the local stack:

```bash
pnpm exec supabase login                                     # once, with the account that owns the project
pnpm exec supabase link --project-ref rhycdpswtiitjhzoczfq   # once
pnpm exec supabase db push                                   # apply new migrations to the hosted database
pnpm env:hosted                                              # .env.local → hosted (keys read from the CLI, never printed)
pnpm env:local                                               # .env.local → back to the local stack
```

- **Tests always use the local stack** (`db:test`, `db:reset` and `db:lint` say `--local`): they create and
  delete users and venues. Keep `pnpm db:start` running.
- While the local stack runs, its 10-second job keeps calling the dev server, which then works on the hosted
  database; app emails still land in the local Mailpit. The hosted database's own job is idle until the app
  is deployed (it can't reach `localhost`).
- In the dashboard (Authentication → URL Configuration) set the Site URL to `http://localhost:3000` and add
  `http://localhost:3000/**` to the redirect URLs. Keep "Confirm email" on.
- Supabase's built-in email only reaches your project team's addresses, a few per hour. Players need a custom
  SMTP provider (e.g. Resend) or Google sign-in. Staff invites also need `supabase/templates/invite.html`
  copied into the "Invite user" template.

### The brand, its sections and staff

- `BRAND_SLUG` in `apps/web/.env.local` names the brand the site runs (`pnpm env:local` → `demo-brand`,
  `pnpm env:hosted` → `chattoturf`). `getBrand()` in `apps/web/lib/tenancy/brand.ts` loads it with its sections.
- `pnpm brand:setup [--name "<name>"] [--owner <email>] [--demo]` creates the brand (live) or tops it up: any
  missing section (turf, café, lounge, in that order) with its preset spaces and games, and the owner. It is
  safe to repeat and never changes what exists. `--name` is needed the first time; `--demo` refuses anything
  but the local stack.
- Owners set each section's name, hours and booking rules (how far ahead, cancel and match cut-offs, the most
  upcoming bookings per player) at `/manage/<slug>/sections`, and add a section there.
- **Staff per section:** an invite names the sections a staff member runs (all ticked by default). Staff see
  and run only those sections' bookings, schedule and sessions; the database enforces it too. Owners run all.
- **Ratings per section:** players rate their level for each section on `/me`; a section they haven't rated
  asks them to rate it before they can join its open play.

### The public site (R2)

- **Look ("A1 · Matte"):** dark and flat, with each section in its own colour: turf `#43a66b`, café `#2e9e93`,
  lounge `#8a78e6` (a new section gets its kind's colour; there is no control to change it yet). Tokens live
  in `apps/web/lib/site/tokens.ts` and `app/globals.css`; headings use Anton, text Inter. Every text/background
  pair is at least 4.5:1 (`test/site-tokens.test.ts`). Each section's words come from its kind: **Join match /
  Grab a seat / Squad up**, **Book pitch / Book table / Book a PC**.
- **Photos:** `apps/web/public/sections/{turf,cafe,lounge}.jpg`, free-licence (Pexels / Unsplash), each under
  250 KB; authors and links in `public/sections/CREDITS.md`. Swap in the brand's own photos by replacing the files.
- **Live:** the home, section and game pages refresh every 30 s while visible. Motion (cards rising in, the open
  dot, seat bars filling) only runs when the system allows motion.
- **Footer** on every site page: the brand and its address, the sections, and sign-in or the player's own pages.
- **One sign-in:** `/signin?next=…` for everyone (staff invite emails send `next=/manage`). It works even while
  the brand isn't live, so staff can sign in to set it up and publish it; the other public pages then say
  "Not open yet".

### Bookings, notifications and the job tick

- Players book a space at `/<section>/book` (after creating a profile at `/me`), see their
  bookings at `/me/bookings`, and get a live bell plus an email for each booking change.
- Staff see every booking, add walk-ins (name + phone) and mark attendance at `/manage/<slug>/bookings`.
- Every 10 seconds the database (`pg_cron` → `pg_net`) calls `POST /api/jobs/tick` with a shared secret,
  and the app sends pending notification emails. `pnpm env:local` stores the app URL
  (`http://host.docker.internal:3000`) and a fresh `JOB_SECRET` in Supabase Vault and `.env.local`, so
  **restart the dev server after running it**. Locally the emails go to Mailpit over SMTP port 54325.
- Booking rules are per section (**Sections**): how far ahead players can book, the cancellation and matching
  cut-offs, and how many upcoming bookings one player may hold in that section. Each space has a slot length.

### Open play: requests, matching and seat offers

- Players open a game from the home page or its section's page (`/sessions/<id>`), press **Request a seat**
  (**Join the waitlist** when it is full), and later see
  their table or team with the other players' display names. Seats are cancelled there or at `/me/bookings`.
- At the venue's match cut-off (default 6 hours before the start) the tick runs the engine over the requests:
  groups, and two balanced teams for team games. Everyone hears where they stand. With too few players the
  session stays open and matching retries until the start. Staff can also press **Match now** on
  `/manage/<slug>/sessions/<id>`, where they see requests, teams with skill totals, the waitlist and live offers.
- A cancelled seat goes to the waiting player who fits that table best. They get a bell notification and an
  email with a one-time **Take the seat** link (`/offers/<token>`, no sign-in; only a hash of the token is
  stored). Unanswered offers expire after the section's offer time and pass on; a free seat whose hand-off
  failed is offered by the next tick; at the start the session closes and anyone still waiting hears there was
  no seat.

Staff invites arrive in Mailpit too. Their template lives in `supabase/templates/invite.html`; copy it to the
hosted project's "Invite user" email template when you deploy.

### Rolling R1 out to the hosted project (after merge)

The hosted database still has the multi-venue shape until these run, in order:

1. **Check first** (dashboard → SQL editor, read-only): `select organization_id from branches group by 1 having count(*) > 1;`
   should return no rows. The migration puts every game in a venue's first section, so a venue with two
   branches and games scheduled in the second would need its games sorted out by hand first.
2. Then:

   ```bash
   pnpm exec supabase db push        # sections, ratings per section, staff per section
   pnpm env:hosted                   # .env.local → hosted; BRAND_SLUG=chattoturf, Google flag from the project
   pnpm brand:setup --owner <owner email>   # adds the café and lounge to Chattoturf (no --name, no --demo)
   pnpm env:local                    # back to local when done
   ```

`db push` turns Chattoturf's branch into its turf section (same hours and rules). Its staff and pending staff
invites get every section that exists **at push time, so only the turf**. `brand:setup` then adds the café and
lounge with their preset spaces and games; edit their hours and rules under Sections. To give an existing
staff member the new sections before the manage redesign (R3) adds a screen for it, change their role to
owner and back to staff on the Staff page (staff made from an owner get every section), or re-invite them.
`--name` only names a brand that doesn't exist yet; it doesn't rename one.

### Rolling R2 out to the hosted project (after merge)

One migration changes the database: `20261028010000_matte_section_colours.sql` gives each kind its matte
colour and repaints sections that still have their kind's old default colour (a colour an owner picked stays).

```bash
pnpm exec supabase db push        # the matte section colours
```

Nothing else changes on the hosted side. When the site is deployed, keep the old wildcard subdomain pointing at
it for a while so links in R1 emails (`<slug>.<root>/…`) still redirect to the same page.

### Google sign-in (optional)

Email links work out of the box. For Google:

1. Create an OAuth client in Google Cloud with the redirect URI `http://127.0.0.1:54321/auth/v1/callback`.
2. Export `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your shell, set `enabled = true` under
   `[auth.external.google]` in `supabase/config.toml`, and restart Supabase (`pnpm db:stop && pnpm db:start`).
3. Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in `apps/web/.env.local` to show the button.

## Commands

```bash
pnpm typecheck           # every package (web runs `next typegen` first)
pnpm test                # engine, sim and web unit/property tests
pnpm test:integration    # web against the local Supabase (real auth users, RLS)
pnpm test:e2e            # Playwright: one player signs in, books and joins a game in each section (see below)
pnpm smoke "/|Coming up" # quick page check on the running dev server: `path|text;text`, `--as <email>` signs in (local only)
pnpm db:test             # pgTAP: schema, RLS, grants, RPCs, cross-venue references, history, outbox, jobs, bookings, open play, sections, ratings, section staff
pnpm test:race           # two-connection races: accepting an offer, booking the same slot, beating the limit, accept vs cancel session
pnpm db:lint             # Supabase security/performance advisors, fails on warnings
pnpm db:reset            # re-apply all migrations to a clean local DB
pnpm env:local           # regenerate apps/web/.env.local + the Vault job secrets (then restart the dev server)
pnpm brand:setup         # create or top up the brand (BRAND_SLUG): --name, --owner <email>, --demo (local only)
pnpm admin:grant <email> # add a user to platform_admins (a database role; no page uses it since R2)
pnpm db:stop
```

### End-to-end journey

`pnpm test:e2e` needs the local stack, `pnpm env:local` and the demo brand (`pnpm brand:setup --name "Demo Arena" --demo`).
It reuses a dev server on :3000 or starts one. A fresh `e2e-<random>@example.test` signs in once by email link (read
from Mailpit), rates each section, then in each section books tomorrow's first free slot and asks for a seat in the
first game (or joins its waitlist). A second test sets the brand to `onboarding`, checks that `/` says "Not open yet"
while `/signin` still works, and sets the status back. Each run leaves the journey player's bookings and requests in
the local database.
Results and the HTML report go to `<OS temp>/bookingandmatchmaking-e2e`, never into the repo (files written in the
repo make `next dev` reload in a loop).

## Numbers

Hard numbers for the case study, re-measured as features land.

| Metric | Value | How |
|---|---|---|
| Match 500 players into tables (median of 5) | **2.0–2.4 ms** | `packages/engine/test/bench.test.ts` (10 games, 60 tables, 2000 swap iterations) |
| Engine tests (incl. property tests) | 51 | `pnpm --filter @bm/engine test` |
| Web unit tests | 231 | `pnpm --filter web test` |
| Web integration tests (real Supabase, Realtime, Mailpit) | 112 | `pnpm test:integration` |
| Database assertions | 365 pgTAP checks + 4 two-connection race tests | `pnpm db:test`, `pnpm test:race` |
| End-to-end tests (Playwright, Chromium) | 2 (the journey through 3 sections; sign-in while not live) | `pnpm test:e2e` |
