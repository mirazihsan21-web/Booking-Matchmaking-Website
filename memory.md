# Project Memory: Booking & Matchmaking

Living notes for anyone (human or AI) who needs to **understand, fix or upgrade** this project later.
Add to this file whenever a decision is made, a gotcha is found, or something changes.
Newest entries go at the top of each log section.

---

## 1. What this is

- Portfolio project #5 from `Agency_Portfolio_Projects.pdf` (Console Log Studio, 14 Oct 2026).
- It is a **showcase demo, not a SaaS**. It proves the agency can build booking systems (restaurants, gyms, clinics, coworking).
- **Board-game café skin** ("Meeple House"):
  - Players set availability, favourite games and skill (1–5).
  - The engine forms balanced tables.
  - Cancellations are refilled from the waitlist by SMS.
  - Owners see revenue analytics.
- **Demo moment:** simulate 40 players (32 seats, so a waitlist is guaranteed), cancel one, and watch the seat refill over (simulated) SMS.

## 2. Key documents

| Doc | Path |
|---|---|
| Design spec (the authority) | `docs/superpowers/specs/2026-10-20-booking-matchmaking-design.md` |
| M1 plan (foundation + engine) | `docs/superpowers/plans/2026-10-20-m1-foundation-and-engine.md` |
| Execution ledger (scratch, git-ignored) | `.superpowers/sdd/<plan-name>/progress.md` |
| Original brief | `Agency_Portfolio_Projects.pdf` (deliberately **not** committed) |

Milestones: **M1** foundation + engine → **M2** booking flows → **M3** demo experience → **M4** analytics + ship.

## 3. Environment & setup gotchas (Windows dev box)

- OS: Windows 11. The shells are PowerShell 5.1 and Git Bash. Node **v24.20.0**.
- **pnpm 12.14.0** is installed via Corepack into the *user* npm dir:
  `corepack enable pnpm --install-directory "C:\Users\USER\AppData\Roaming\npm"`.
  Plain `corepack enable` fails with EPERM because it tries to write to `C:\Program Files\nodejs` (needs admin).
- **Docker Desktop is required** for local Supabase (`supabase start`, pgTAP tests). It wasn't installed as of 2026-10-20.
- Local Supabase DB URL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- Git identity is repo-local: `Console Log Studio <pandasweet067@gmail.com>`.
- Git warns "LF will be replaced by CRLF". This is harmless (Windows autocrlf).
- TypeScript **7.x** is the native (Go) compiler. If `next build` type-checking breaks on it, pin `typescript@6.0.3` across the workspace.

## 4. Architecture quick map

```
apps/web            Next.js App Router + Tailwind 4 + shadcn/ui; skins/ holds re-skin config
packages/engine     pure TS matching engine (no I/O, seeded RNG): formGroups, rankWaitlist, explainScore
packages/sim        seeded fake data → DB-shaped rows (snake_case = DB columns)
supabase/           migrations (schema → RLS → RPCs) + pgTAP tests + race test
```

- **Seat invariants live in Postgres.** Partial unique indexes plus `accept_offer` row locks mean duplicate SMS "YES" replies can't double-book.
- **Booking-flow tables** (bookings, waitlist_entries, seat_offers, messages, events) are written only by RPCs running as `service_role`. Owners can only read them.
- **SMS goes through a Notifier interface.** The `simulated` adapter shows messages in on-screen phones (via Realtime on `messages`). The `twilio` adapter is presenter-mode only, to verified numbers. Public demo sandboxes can never send real SMS.

## 5. Decisions & rulings log

- **2026-10-20 · Plan:** owners get **read-only** access to booking-flow tables, not the spec's "full access". This keeps seat invariants in one place (RPCs).
- **2026-10-20 · Plan:** the spec's `tables` table is named **`venue_tables`** to avoid clashing with SQL keywords.
- **2026-10-20 · Plan:** the engine's local search uses **swaps only** (no single-player moves). Swaps keep group sizes fixed, which keeps the "no free seat left unused" and "search never lowers score" guarantees true.
- **2026-10-20 · Plan:** an SMS "NO" to an offer **withdraws** the player from that night's waitlist. That stops the same seat bouncing back to them.
- **2026-10-20 · Design:** the matching engine is TypeScript, not Rust; Rust is already shown in portfolio project #8. There is no Stripe checkout; revenue = attended seats × seat price.
- **2026-10-20 · Design:** fake phone numbers come only from the Ofcom drama range `+447700900000–999`, so they can never reach a real person.

## 6. Known issues / gotchas

_(none yet)_

## 7. Upgrade ideas / future work

- Second skin (padel courts or gym classes) to prove re-skinning works (stretch goal).
- If matching ever needs to handle much larger venues, swap the full re-score in local search for delta scoring.

## 8. Change log

- **2026-10-20:** Spec and M1 plan committed (`dd38762`, `e5677ab`). Started M1 on branch `m1-foundation`.
