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
pnpm db:start            # local Supabase: API :54321, DB :54322, Studio :54323, Mailpit :54324
pnpm env:local           # writes apps/web/.env.local from the running stack
pnpm --filter web dev    # http://localhost:3000
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
pnpm db:test             # pgTAP: schema, tenancy RLS, grants, booking and schedule RPCs
pnpm test:race           # two simultaneous "accept offer" calls
pnpm db:lint             # Supabase security/performance advisors, fails on warnings
pnpm db:reset            # re-apply all migrations to a clean local DB
pnpm env:local           # regenerate apps/web/.env.local
pnpm admin:grant <email> # make a user a platform admin
pnpm db:stop
```

## Numbers

Hard numbers for the case study, re-measured as features land.

| Metric | Value | How |
|---|---|---|
| Match 500 players into tables (median of 5) | **2.0–2.4 ms** | `packages/engine/test/bench.test.ts` (10 games, 60 tables, 2000 swap iterations) |
| Engine tests (incl. property tests) | 51 | `pnpm --filter @bm/engine test` |
| Web unit tests | 100 | `pnpm --filter web test` |
| Web integration tests (real Supabase) | 36 | `pnpm test:integration` |
| Database assertions | 132 pgTAP checks + 1 two-connection race test | `pnpm db:test`, `pnpm test:race` |
