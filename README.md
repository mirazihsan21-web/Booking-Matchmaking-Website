# Meeple House: Booking & Matchmaking

A portfolio build from Console Log Studio. Players set their availability, favourite games and skill
level. A matching engine forms balanced tables and keeps a fair waitlist. When someone cancels, the
seat refills itself over SMS, and owners see which nights and games earn the most. It's a board-game
café on the surface. Underneath is a reusable booking engine for restaurants, gyms, clinics and
coworking spaces.

> Design: [`docs/superpowers/specs/2026-10-20-booking-matchmaking-design.md`](docs/superpowers/specs/2026-10-20-booking-matchmaking-design.md)
> · Project notes for maintainers: [`memory.md`](memory.md)

## Repo layout

| Path | What it is |
|---|---|
| `packages/engine` | Pure TypeScript matching engine (`formGroups`, `rankWaitlist`, `explainScore`). No I/O, seeded RNG. |
| `packages/sim` | Seeded fake venues, players and 12 weeks of booking history, shaped as DB rows. |
| `apps/web` | Next.js 16 app (Tailwind 4, shadcn/ui). Domain words and colours come from `skins/`. |
| `supabase/` | Migrations (schema → RLS → booking RPCs), pgTAP tests and an offer race test. |

## Prerequisites

- **Node 24+**
- **pnpm 12** via Corepack. On Windows without admin rights:
  `corepack enable pnpm --install-directory "$env:APPDATA\npm"`
- **Docker Desktop** (WSL2 backend on Windows) for the local Supabase stack

## Getting started

```bash
pnpm install
pnpm db:start            # local Supabase: API :54321, DB :54322, Studio :54323
pnpm test                # engine, sim and web unit/property tests
pnpm db:test             # pgTAP: schema, RLS and booking RPCs
pnpm --filter web dev    # http://localhost:3000
```

Other useful commands:

```bash
pnpm typecheck           # every package
pnpm db:reset            # re-apply all migrations to a clean local DB
pnpm db:stop
```

## Numbers

Hard numbers for the case study, re-measured as features land.

| Metric | Value | How |
|---|---|---|
| Match 500 players into tables (median of 5) | **2.0–2.4 ms** | `packages/engine/test/bench.test.ts` (10 games, 60 tables, 2000 swap iterations) |
| Engine invariants checked per run | 7 properties × 300 random sessions | `packages/engine/test/form-groups.property.test.ts` |
| Database assertions | 80 pgTAP checks + 1 two-connection race test | `pnpm db:test`, `pnpm test:race` |
