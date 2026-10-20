# Project Memory: Booking & Matchmaking

Living notes for anyone (human or AI) who needs to **understand, fix or upgrade** this project later.
Add to this file whenever a decision is made, a gotcha is found, or something changes.
Newest entries go at the top of each log section.

---

## 1. What this is

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
- `supabase/seed.sql` doesn't exist yet, so `db reset` prints "no files matched pattern". That's harmless. Seeding from `@bm/sim` comes in M2/M3.
- Local Supabase DB URL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- Git identity is repo-local: `Console Log Studio <pandasweet067@gmail.com>`.
- Git warns "LF will be replaced by CRLF". This is harmless (Windows autocrlf).
- **TypeScript is pinned to ^5.9.3 across the workspace.** `create-next-app` 16.4.2 scaffolds `typescript ^5`, so the whole repo follows it. TS 7.x (the native Go compiler) is newer and works for the engine/sim, but Next's type-check isn't verified against it. Try upgrading once Next templates move to TS 7.
- `create-next-app` refuses to run ("application path is not writable") if the **parent folder doesn't exist**. Run `mkdir -p apps` first.

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
- **Skin colours** are applied as inline CSS variables on `<html>` (`skinToCssVars`). They override shadcn's `:root` values for `--primary`, `--accent`, `--background` and `--foreground` only. Other shadcn tokens (`--primary-foreground`, etc.) keep their defaults. Dark mode isn't skinned yet.
- **fast-check `shuffledSubarray`:** `maxLength` must not exceed the source array's length, or every property errors out immediately (looks like 6 failures in ~1ms). See `packages/engine/test/arbitraries.ts`.
- **Vitest 5 hides `console.log` output by default.** To see benchmark output, run `npx vitest run test/bench.test.ts --silent=false --reporter=verbose` (from `packages/engine`).
- **How to check property tests still have teeth:** break one rule in `form-groups.ts` (e.g. `<` → `<=` on capacity), run the property tests, and confirm one goes red. Then `git checkout` the file.

## Numbers (for the case study)

- `formGroups` with 500 players, 10 games, 60 tables, 2000 swap iterations: **median 2.04ms** (2026-10-20, dev laptop).

## 7. Upgrade ideas / future work

- **Product name still to be decided.** The UI uses the working name "Booking & Matchmaking" from `apps/web/messages/en.ts` (`m.platform.name`). Change it there once the user picks a name, and set the root domain in `NEXT_PUBLIC_ROOT_DOMAIN`.

**Deferred minor findings from the M1 review**, each worth a test plus a fix when the area is touched next:
- **Cross-venue references.** `groups.session_id/table_id/game_id`, `bookings.group_id`, `player_games.game_id` and the like aren't tied to the row's `venue_id`. Example: an owner could make a group pointing at another venue's session. Fix with composite foreign keys on `(venue_id, id)`.
- **Owner can attach any login.** `players_owner_all` lets an owner insert a player row with `user_id` set to *any* login. Players can also set `phone` to any number, which only matters once real Twilio sending is wider than presenter mode.
- **RPCs don't check session state.** `create_offer` / `accept_offer` don't look at `sessions.status` or `starts_at`, so an offer could be made or accepted for a closed or past night.
- **Duplicate player ids** in `formGroups` input get seated twice. The DB prevents duplicates upstream; add a dedupe or assert in the engine.
- **The repair step's bans are permanent.** It bans a table+game pair forever, so a group dissolved early can't re-form even if enough players later arrive. This affects seating quality, not correctness.
- **Clock-change gap times.** `zonedTimeToUtc` turns a wall time that doesn't exist on the spring-forward day (e.g. 01:30) into 02:30 BST. Reasonable, but untested.
- **Rounding mismatch.** `seconds_since_cancel` is rounded down (`floor`) in the RPC but rounded to nearest (`Math.round`) in the sim, so analytics may differ by 1s.
- **Missing events.** `accept_offer` writes no event for `seat_taken` / `already_booked`. Every other state change has one.

- Second skin (padel courts or gym classes) to prove re-skinning works (stretch goal).
- The swap search already re-scores only the two groups a swap touches (delta scoring). For much bigger venues, the next win is replacing the linear `seatings.find(...)` scans in the greedy `seatPass` with per-game open-group queues.

## 8. Change log

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
