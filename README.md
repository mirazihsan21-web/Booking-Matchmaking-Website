# Booking & Matchmaking

A multi-tenant booking and matchmaking platform for **board-game cafés, futsal/turf/court venues and
gaming lounges in Bangladesh**, built by Console Log Studio. Venues sign themselves up, get their own
subdomain in their own colours, set up branches, spaces, activities and an open-play schedule, and
players create a profile per venue. A matching engine forms fair groups (or two balanced teams) and
keeps a fair waitlist. Bookings, matchmaking and bKash payments land in Stages B and C.

"Booking & Matchmaking" is a working name (see `m.platform.name` in `apps/web/messages/en.ts`).

> Platform spec: [`docs/superpowers/specs/2026-10-20-booking-platform-design.md`](docs/superpowers/specs/2026-10-20-booking-platform-design.md)
> · Project notes for maintainers: [`memory.md`](memory.md)

## Repo layout

| Path | What it is |
|---|---|
| `packages/engine` | Pure TypeScript matching engine: `formGroups`, `rankWaitlist`, `splitTeams`, `explainScore`. No I/O, seeded RNG. |
| `packages/sim` | Seeded fake data shaped as DB rows (still the M1 shapes; reworked in Stage B). |
| `apps/web` | Next.js 16 app (Tailwind 4, shadcn/ui). Business-type presets in `presets/`, all copy in `messages/en.ts`. |
| `supabase/` | Migrations, pgTAP tests and a two-connection offer race test. |

`apps/web` routes:

| Host | Path | Who |
|---|---|---|
| `localhost:3000` | `/`, `/signin`, `/onboarding` | Landing page, sign-in, the venue sign-up wizard |
| | `/manage/[slug]/…` | Owners and staff: branches, spaces, activities, schedule, staff, settings |
| | `/admin` | Platform admins: every venue, suspend / restore |
| `<slug>.localhost:3000` | `/`, `/signin`, `/me` | A venue's public page, sign-in, and the player's profile there |

`proxy.ts` refreshes the session and rewrites venue hosts to the internal `/t/[slug]` routes.

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
pnpm --filter web dev    # http://localhost:3000 (keep it on :3000: the job tick calls it)
```

Then:

1. Open http://localhost:3000, choose **Create your venue** and sign in with any email address.
   Sign-in links land in Mailpit at http://127.0.0.1:54324 (nothing leaves your machine).
2. Finish the wizard and publish. The venue is live at `http://<slug>.localhost:3000`
   (browsers resolve `*.localhost` to your machine, so no hosts-file edits are needed).
3. Sign in on the venue's subdomain as a different email to create a player profile.
4. To use `/admin`, make yourself a platform admin: `pnpm admin:grant you@example.com`
   (the user must have signed in once). With `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`
   set in the shell, the same command targets a hosted project instead.

### Bookings, notifications and the job tick

- Players book a space at `http://<slug>.localhost:3000/book` (after creating a profile at `/me`), see their
  bookings at `/me/bookings`, and get a live bell plus an email for each booking change.
- Staff see every booking, add walk-ins (name + phone) and mark attendance at `/manage/<slug>/bookings`.
- Every 10 seconds the database (`pg_cron` → `pg_net`) calls `POST /api/jobs/tick` with a shared secret,
  and the app sends pending notification emails. `pnpm env:local` stores the app URL
  (`http://host.docker.internal:3000`) and a fresh `JOB_SECRET` in Supabase Vault and `.env.local`, so
  **restart the dev server after running it**. Locally the emails go to Mailpit over SMTP port 54325.
- Owners set the booking rules in **Settings → Bookings**: how far ahead players can book, the cancellation
  and matching cut-offs, and how many upcoming bookings one player may hold. Each space has a slot length.

Staff invites arrive in Mailpit too. Their template lives in `supabase/templates/invite.html`; copy it to the
hosted project's "Invite user" email template when you deploy.

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
pnpm db:test             # pgTAP: schema, RLS, grants, RPCs, cross-venue references, history, outbox, jobs, bookings
pnpm test:race           # two-connection races: accepting an offer, booking the same slot, beating the limit
pnpm db:lint             # Supabase security/performance advisors, fails on warnings
pnpm db:reset            # re-apply all migrations to a clean local DB
pnpm env:local           # regenerate apps/web/.env.local + the Vault job secrets (then restart the dev server)
pnpm admin:grant <email> # make a user a platform admin
pnpm db:stop
```

## Numbers

Hard numbers for the case study, re-measured as features land.

| Metric | Value | How |
|---|---|---|
| Match 500 players into tables (median of 5) | **2.0–2.4 ms** | `packages/engine/test/bench.test.ts` (10 games, 60 tables, 2000 swap iterations) |
| Engine tests (incl. property tests) | 51 | `pnpm --filter @bm/engine test` |
| Web unit tests | 183 | `pnpm --filter web test` |
| Web integration tests (real Supabase, Realtime, Mailpit) | 62 | `pnpm test:integration` |
| Database assertions | 211 pgTAP checks + 3 two-connection race tests | `pnpm db:test`, `pnpm test:race` |
