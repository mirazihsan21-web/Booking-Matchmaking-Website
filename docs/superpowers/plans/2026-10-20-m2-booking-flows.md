# M2 Booking Flows: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the booking loop work end to end. A visitor starts a sandbox café, sets up players, runs matching for a night, and cancels a seat. The waitlisted player then gets an offer by (simulated) SMS, replies YES or NO, and expired offers move on to the next person automatically.

**Architecture:**
- **Reads** go through the user's RLS-scoped Supabase client.
- **Booking-flow writes** go through `apps/web/lib/booking/*`. That code runs on the server with a `service_role` client and calls the transactional RPCs from M1, plus one new one, `apply_matching`.
- **The matching engine** runs in TypeScript; Postgres applies the result atomically.
- **SMS** goes through a `Notifier` interface. Its `simulated` adapter writes `messages` rows.
- **Offer expiry:** `pg_cron` runs every 10 seconds. It calls a secret-protected Next.js route through `pg_net`, which expires offers and passes each freed seat to the next person.

**Tech Stack:**
- Already in use: Next.js 16.4 (App Router, Cache Components), Tailwind 4, shadcn, Vitest 5, pgTAP, Supabase CLI 2.121 with Postgres 17.
- New in M2: `@supabase/supabase-js` ^2.118.0, `@supabase/ssr` ^0.12.7, `server-only`, `pg_cron`, `pg_net`, Supabase Vault.

**Spec:** `docs/superpowers/specs/2026-10-20-booking-matchmaking-design.md` (M2 section). Project notes: `memory.md`.

### Scope decisions (deviations from the spec's milestone list)
- **Sandbox venues move from M3 to M2.** This means anonymous sign-in, plus a demo venue cloned from the skin with 40 players, 12 weeks of history and open nights. The owner and player pages need an owner and a venue to exist at all. M3 keeps the demo *experience*: floor plan, phones, timeline, scripted scenario, Twilio and reminders.
- **The player pages use the spec's "view-as" model.** The sandbox owner acts as any of their venue's players, which the M1 owner policies already allow. Real players signing in with their own login is deferred. It would need self-insert policies and phone verification.
- **Hosted-Supabase readiness.** Supabase's change of 2026-04-28 means new tables are no longer exposed to the Data API automatically; it applies to every project from 2026-10-30. So M2 adds explicit grants and merges duplicate policies, which keeps `supabase db advisors` clean.

## Global Constraints

- Work on branch `m2-booking-flows`, created from `main`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never edit the M1 migrations.** Every schema change is a new file created with `pnpm exec supabase migration new <name>` (the CLI picks the timestamp).
- **Every new table or function gets explicit `grant`/`revoke` statements.** Nothing relies on default privileges. Every new function gets `set search_path = ''`. Booking RPCs: `security invoker`, execute granted to `service_role` only.
- **Secrets stay on the server.** The service client lives in `apps/web/lib/booking/service-client.ts`, which starts with `import 'server-only'`. Client components never import it. The secret key is never in a `NEXT_PUBLIC_` variable.
- **Environment variables:**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SECRET_KEY`
  - `JOB_SECRET`
  - Locally, `pnpm env:local` writes them from `supabase status` (Task 4).
- **Next.js 16.** Read the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing Next code (`apps/web/AGENTS.md` says so).
  - Any page part that reads cookies or the session renders inside `<Suspense>`. Otherwise the build fails under Cache Components.
  - Server actions call `refresh()` from `next/cache` after a mutation.
  - Session checks use `supabase.auth.getClaims()`, never `getSession()`, on the server.
- **`pnpm test` stays database-free.** Tests that need the database live in `apps/web/test/integration/**` and run with `pnpm test:integration`, alongside `pnpm db:test` and `pnpm test:race`.
- **Fake data only.** Phones come only from `+447700900000`–`999`. No Twilio code in M2.
- **SMS wording** comes only from `apps/web/lib/notify/copy.ts` (Task 6). Never inline it.
- **Sandbox constants** (`apps/web/lib/sandbox/constants.ts`):
  - `SANDBOX_PLAYERS = 40`
  - `SANDBOX_HISTORY_WEEKS = 12`
  - `SANDBOX_UPCOMING_DAYS = 7`
  - `SANDBOX_TTL_HOURS = 24`
  - `SANDBOX_OFFER_TTL_SECONDS = 60`

## Review Focus

1. **Messy SMS replies.** `" yes! "`, `"Y"`, `"Nope"`, `"cancel"` or gibberish map to the right action or to the help text. Nothing throws (Task 9).
2. **A YES or NO with no offer outstanding**, or a C with no upcoming booking, gets a polite SMS and changes nothing (Task 9).
3. **Matching triggered twice** (double-click, two tabs) creates groups exactly once. The second call reports `already_matched` (Tasks 2 and 7).
4. **Cancelling, or offering a seat, after the night has started** is refused, so nobody gets an offer for a game in progress (Task 8).
5. **Starting the demo twice** (refresh, double submit) reuses the visitor's sandbox instead of building a second one (Task 5).

---

### Task 1: Data API grants and merged policies

**Files:**
- Create (CLI): `supabase/migrations/<ts>_api_grants_and_policy_merge.sql`
- Create: `supabase/tests/database/04_grants.test.sql`
- Modify: `supabase/tests/database/02_rls.test.sql` (the anon assertion)
- Modify: root `package.json` (script `"db:lint": "supabase db advisors --local --type all --fail-on warn"`)

**Interfaces:**
- Produces this privilege matrix:

  | Tables | `authenticated` | `anon` | `service_role` |
  |---|---|---|---|
  | `venues`, `venue_tables`, `games`, `sessions`, `groups`, `player_games`, `availability` | select, insert, update, delete | nothing | all |
  | `players` | select, insert, delete, plus update on `(name, phone, skill, sms_opt_in)` only | nothing | all |
  | `seat_requests` | select, delete, plus insert on `(venue_id, session_id, player_id)` only | nothing | all |
  | `bookings`, `waitlist_entries`, `seat_offers`, `messages`, `events` | select only | nothing | all |

  Future tables get no default grants: run `alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated`.
- **Policies:** exactly one permissive policy per table, per role, per action. The same rules apply as before, merged with `or`:
  - Catalogue tables: one `select` policy (`is_venue_member`) plus separate owner policies `for insert`, `for update` and `for delete` (no more `for all`).
  - `player_games`, `availability`, `seat_requests`: one `for all` policy, `is_venue_owner(venue_id) or is_own_player(player_id, venue_id)`.
  - `players`: `select` and `update` are each `owner or user_id = auth.uid()`; `insert` and `delete` are owner only.
  - Booking-flow tables: one `select` policy each, owner or own (offers via the entry's player).

- [ ] **Step 1: Write the failing test** `04_grants.test.sql`, using `table_privs_are` from pgTAP:
  - `anon has no privileges on any public table`: loop over the 14 tables, expecting `'{}'`.
  - `authenticated can only read booking-flow tables`: for `bookings`, `waitlist_entries`, `seat_offers`, `messages`, `events`, expect `ARRAY['SELECT']`.
  - `authenticated has full CRUD on the catalogue`: for `games`, expect `ARRAY['DELETE','INSERT','SELECT','UPDATE']`.
  - `service_role can write booking-flow tables`: `ok(has_table_privilege('service_role', 'public.bookings', 'INSERT,UPDATE,DELETE'))`. Use `has_table_privilege` rather than an exact list, because Supabase may also grant `TRUNCATE`/`REFERENCES`/`TRIGGER`.
- [ ] **Step 2: Change the anon assertion in `02_rls`.** `anon sees no venues` becomes a `throws_ok` of `select * from public.venues` as anon with `'42501'` (`'anon cannot read venues'`).
- [ ] **Step 3: Run** `pnpm db:test` and `pnpm db:lint`. Expected: 04 FAILS (anon still has privileges), the anon assertion FAILS, and `db:lint` exits non-zero with `multiple_permissive_policies` warnings.
- [ ] **Step 4: Write the migration.** Revoke and grant per the matrix. Re-state the column grants from M1. Drop the old policies and create the merged ones.
- [ ] **Step 5: Run** `pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm test:race`. Expected: all pass, and `db:lint` reports no WARN or ERROR.
- [ ] **Step 6: Commit** `feat(db): explicit Data API grants and one policy per action`.

### Task 2: `apply_matching` RPC

**Files:**
- Create (CLI): `supabase/migrations/<ts>_apply_matching.sql`
- Create: `supabase/tests/database/05_apply_matching.test.sql`

**Interfaces:**
- Produces `public.apply_matching(p_session_id uuid, p_groups jsonb, p_waitlist jsonb) returns text`. It is `plpgsql`, `security invoker` and `search_path ''`, and only `service_role` can execute it.
  - `p_groups` is `[{ "table_id": uuid, "game_id": uuid, "player_ids": uuid[] }]`.
  - `p_waitlist` is `[{ "player_id": uuid, "priority": int }]`, ordered: the first entry gets `queue_position` 1.
- **Return values:**
  - `'not_found'` when the session doesn't exist.
  - `'already_matched'` when `sessions.status <> 'open'`. The session row is locked `for update` first, so concurrent calls serialise.
  - `'applied'` on success.
- **Raises:**
  - `invalid_group`: the table or game isn't in the session's venue, a table is used twice, or the group size is `> least(table.capacity, game.max_players)` or `< game.min_players`.
  - `player_not_requested`: a player in either list has no `seat_requests` row for the session.
  - `player_listed_twice`: a player appears more than once across both lists.
- **On success it writes:**
  - `groups` rows, with capacity `least(table.capacity, game.max_players)`.
  - `bookings`: seats 1..n in `player_ids` order, `source 'matched'`, status `confirmed`, `price_cents` = the session's `seat_price_cents`.
  - `waitlist_entries` rows.
  - Session status becomes `matched`.
  - An `events` row with type `'session_matched'` and payload `{seated, waitlisted}`.

- [ ] **Step 1: Write the failing test.** Fixture: one venue, two tables (capacity 4), games Azul {2,4} and Catan {3,4}, an open session with 7 requesters, and a venue B table. Assertions:
  - `applies groups, seats and waitlist` → `'applied'`, with 2 groups, 6 bookings on seats 1..n, 1 waitlist entry at `queue_position` 1, the session `matched` and one `session_matched` event.
  - `a second call reports already_matched and writes nothing`: counts unchanged (Review Focus 3).
  - `rejects a player who never requested a seat`: `throws_ok … 'P0001', 'player_not_requested'`.
  - `rejects an over-capacity group` (5 players at a capacity-4 table): `invalid_group`.
  - `rejects an under-minimum group` (2 at Catan): `invalid_group`.
  - `rejects another venue's table`: `invalid_group`.
  - `rejects a player listed twice`: `player_listed_twice`.
  - `unknown session → not_found`.
  - `authenticated cannot execute it`: `42501`.

  Each rejection case runs on a fresh open session.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: FAIL (the function doesn't exist).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `pnpm db:reset && pnpm db:test && pnpm db:lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): apply_matching writes a whole night's seating atomically`.

### Task 3: Sim — upcoming nights and id remapping

**Files:**
- Create: `packages/sim/src/upcoming.ts`, `packages/sim/src/remap.ts`
- Modify: `packages/sim/src/index.ts`
- Test: `packages/sim/test/upcoming.test.ts`, `packages/sim/test/remap.test.ts`

**Interfaces:**
- Produces `generateUpcoming(o: { venue: SimVenue; players: SimPlayers; days: number; now: Date; seed: number }): { sessions: SessionRow[]; seat_requests: SeatRequestRow[] }`.
  - **Sessions:** one per venue night on the local dates `today .. today + days - 1` (in the venue timezone), keeping only those with `starts_at > now`. Status is `'open'`.
  - **Requests:** the same availability and probability rule as `generateHistory` (0.55 on Fri/Sat, 0.35 otherwise). `priority` is 0 and `created_at = now − rng.int(1, 72) h`.
- Produces `remapIds<T extends Record<string, readonly object[]>>(data: T, newId: () => string): T`.
  1. Collect every row's `id` value, across all keys.
  2. Map each to `newId()`.
  3. Return a deep copy in which every string equal to a collected id is replaced. This covers foreign-key columns and the `payload` jsonb.
  4. Anything else, including `owner_id` and `user_id`, is untouched.

- [ ] **Step 1: Write the failing tests:**
  - `upcoming.test.ts`, with `now = 2026-10-23T12:00:00Z` (a Friday), the Task 6 fixture catalogue, `days 7` and seed 3:
    - `creates open sessions only for nights that have not started yet`. Every `starts_at > now`, the status is `open`, and the count equals the nights in the window: Fri 23, Sat 24, Tue 27 → 3.
    - `only lets available players request`.
    - `is deterministic for a seed`.
    - `dates requests in the past`: every `created_at < now`.
  - `remap.test.ts`, on a small `{ venues, players, events }` fixture:
    - `replaces every id and every reference to it consistently`.
    - `rewrites ids inside event payloads`.
    - `leaves owner_id and non-id strings untouched`.
    - `does not mutate the input`.
- [ ] **Step 2: Run** `pnpm --filter @bm/sim test`. Expected: FAIL (the modules don't exist).
- [ ] **Step 3: Implement both modules** and export them.
- [ ] **Step 4: Run** `pnpm --filter @bm/sim test && pnpm --filter @bm/sim typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): upcoming open nights and collision-free id remapping`.

### Task 4: Supabase clients, env and integration-test harness

**Files:**
- Modify: `apps/web/package.json`:
  - deps `@supabase/supabase-js@^2.118.0`, `@supabase/ssr@^0.12.7`, `server-only`
  - scripts `"test:integration": "vitest run --config vitest.integration.config.ts"` and `"env:local": "node scripts/write-env-local.mjs"`
- Modify: root `package.json` (`"test:integration": "pnpm --filter web test:integration"`, `"env:local": "pnpm --filter web env:local"`)
- Modify: `supabase/config.toml` (`enable_anonymous_sign_ins = true`)
- Create:
  - `apps/web/lib/supabase/server.ts`, `client.ts`, `proxy.ts`: verbatim from the official example (see memory.md / supabase `examples/auth/nextjs`). `proxy.ts` redirects to `/` instead of `/login`, and only for paths starting with `/owner` or `/play`.
  - `apps/web/proxy.ts`
  - `apps/web/lib/booking/service-client.ts`
  - `apps/web/scripts/write-env-local.mjs`
  - `apps/web/.env.example`
  - `apps/web/vitest.integration.config.ts`
  - `apps/web/test/integration/global-setup.ts`
  - `apps/web/test/integration/helpers.ts`
- Test: `apps/web/test/integration/harness.test.ts`

**Interfaces:**
- `createServiceClient(): SupabaseClient`. It uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`, with `auth: { persistSession: false, autoRefreshToken: false }`.
- `global-setup.ts` runs `pnpm exec supabase status -o json` from the repo root. It sets `NEXT_PUBLIC_SUPABASE_URL` (from `API_URL`), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`, unless they are already set.
- `helpers.ts` provides:
  - `serviceDb(): SupabaseClient`
  - `createTestOwner(db): Promise<string>`, which uses `db.auth.admin.createUser({ email: \`${randomUUID()}@m2.test\`, email_confirm: true })`
  - `deleteTestOwner(db, userId): Promise<void>`, which cascades to the user's venues
- `write-env-local.mjs` writes `apps/web/.env.local` with the four env vars. It sets `JOB_SECRET=local-dev-job-secret`.
- The integration config sets `include: ['test/integration/**/*.test.ts']`, `globalSetup` and `fileParallelism: false`.

- [ ] **Step 1: Write the failing test** `harness.test.ts`:
  - `service client reaches the local database`: `serviceDb().from('venues').select('id').limit(1)` returns no `error`.
  - `test owners can be created and removed`.
- [ ] **Step 2: Run** `pnpm test:integration`. Expected: FAIL (missing modules or config).
- [ ] **Step 3: Implement** the files above. Then run `pnpm exec supabase stop && pnpm db:start` so the anonymous sign-in config takes effect.
- [ ] **Step 4: Run** `pnpm test:integration && pnpm --filter web typecheck && pnpm --filter web build`. Expected: PASS, and the build still succeeds with `proxy.ts`.
- [ ] **Step 5: Commit** `feat(web): Supabase SSR clients, proxy and integration-test harness`.

### Task 5: Sandbox venues

**Files:**
- Create: `apps/web/lib/sandbox/constants.ts`, `apps/web/lib/sandbox/create-sandbox.ts`
- Test: `apps/web/test/integration/sandbox.test.ts`

**Interfaces:**
- Consumes:
  - `generateVenue`, `generatePlayers`, `generateHistory`, `generateUpcoming`, `remapIds` from `@bm/sim`
  - `getSkin` from `@/skins`
  - `createServiceClient`
- Produces `createSandbox(db: SupabaseClient, ownerId: string, o?: { now?: Date; seed?: number }): Promise<{ venueId: string; created: boolean }>`.
  - **Reuse:** if the owner already has a venue with `is_demo` and `expires_at > now`, return `{ venueId, created: false }`.
  - **Generate:**
    - `seed = o.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]`
    - venue from `getSkin('boardgame')` with `ownerId`
    - `SANDBOX_PLAYERS` players
    - history for `SANDBOX_HISTORY_WEEKS`, with `endDate` = today in the venue timezone (generated at the sim's default 900s TTL, so history refill times look realistic)
    - `generateUpcoming` for `SANDBOX_UPCOMING_DAYS`
  - **Then set** `is_demo = true`, `expires_at = now + SANDBOX_TTL_HOURS`, `offer_ttl_seconds = SANDBOX_OFFER_TTL_SECONDS`.
  - **Remap and insert:** run `remapIds(…, crypto.randomUUID)`, then insert in foreign-key order, in batches of 500: venues, venue_tables, games, players, player_games, availability, sessions, seat_requests, groups, bookings, waitlist_entries, seat_offers, events.
  - **On any insert error**, delete the venue (cascade) and rethrow.

- [ ] **Step 1: Write the failing tests:**
  - `creates a demo venue with 40 players, 12 weeks of history and open nights`: players = 40; closed sessions = 60 (12 weeks × 5 nights); open sessions 4 or 5 (the 5 weekly nights, minus tonight's if it has already started); `is_demo` true, `offer_ttl_seconds` 60, `expires_at` within 1 minute of now + 24 h.
  - `reuses the visitor's sandbox on a second call` (Review Focus 5): `created: false`, the same `venueId`, and still one venue for that owner.
  - `gives two sandboxes built from the same seed disjoint ids`: two owners, `seed: 1` for both, no error, and no shared player ids.
- [ ] **Step 2: Run** `pnpm test:integration -- sandbox`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): one-click sandbox venues seeded from the skin`.

### Task 6: Notifier, SMS copy and time formatting

**Files:**
- Create: `apps/web/lib/notify/notifier.ts`, `apps/web/lib/notify/copy.ts`, `apps/web/lib/format.ts`
- Test: `apps/web/test/copy.test.ts`, `apps/web/test/format.test.ts`, `apps/web/test/integration/notifier.test.ts`

**Interfaces:**
- `interface OutboundSms { venueId: string; playerId: string; body: string }`
- `interface Notifier { send(sms: OutboundSms): Promise<void> }`
- `createSimulatedNotifier(db: SupabaseClient): Notifier` inserts a `messages` row: `direction 'outbound'`, `provider 'simulated'`, `status 'sent'`.
- `formatShortTime(iso: string, timeZone: string): string` returns `'7pm'`, `'7:30pm'` or `'2pm'` (lower case, minutes only when non-zero).
- `formatNight(iso: string, timeZone: string): string` returns, e.g., `'Fri 24 Oct, 6pm'`.
- `sms` in `copy.ts` holds the **exact copy**:

  | Key | Text |
  |---|---|
  | `offer({table, game, time})` | `Seat open at ${table} for ${game}, ${time}. Reply YES to take it or NO to pass.` |
  | `accepted({table, game, time})` | `You're in! ${table}, ${game}, ${time}. See you there.` |
  | `late()` | `Sorry, that offer has expired.` |
  | `seatTaken()` | `Sorry, someone else just took that seat. You're still on the waitlist.` |
  | `declined()` | `No worries, we've taken you off tonight's waitlist.` |
  | `alreadyBooked()` | `You already have a seat tonight, so we've passed this one on.` |
  | `offerExpired({table})` | `Your offer for ${table} expired, so we've passed it on.` |
  | `cancelled({table, time})` | `Your seat at ${table} for ${time} is cancelled.` |
  | `noOffer()` | `You don't have a seat offer right now.` |
  | `noBooking()` | `You don't have an upcoming booking to cancel.` |
  | `help()` | `Reply YES to take a seat, NO to pass, or C to cancel your booking.` |

- [ ] **Step 1: Write the failing tests:**
  - `copy.test.ts`: `offer` and `accepted` render with `{table: 'Table 3', game: 'Catan', time: '7pm'}` to the exact strings above, and every text is under 160 characters (a single SMS segment).
  - `format.test.ts`: `formatShortTime('2026-07-11T18:00:00Z','Europe/London')` → `'7pm'`, `'2026-07-11T18:30:00Z'` → `'7:30pm'`, `'2026-01-10T14:00:00Z'` → `'2pm'`. `formatNight('2026-10-24T17:00:00Z','Europe/London')` → `'Sat 24 Oct, 6pm'`.
  - `notifier.test.ts` (integration): `the simulated notifier stores an outbound message`.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm test:integration -- notifier`. Expected: FAIL.
- [ ] **Step 3: Implement** the three modules. `formatShortTime` uses `Intl.DateTimeFormat('en-GB', {hour:'numeric', minute:'2-digit', hour12:true, timeZone})`, then lower-cases and drops `:00` and the space.
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): simulated SMS notifier and single-source SMS copy`.

### Task 7: `runMatching`

**Files:**
- Create: `apps/web/lib/booking/deps.ts`, `apps/web/lib/booking/run-matching.ts`
- Test: `apps/web/test/integration/run-matching.test.ts`, `apps/web/test/integration/fixtures.ts`

**Interfaces:**
- `interface BookingDeps { db: SupabaseClient; notifier: Notifier; now: () => Date }`
- `createBookingDeps(): BookingDeps` wires the service client, the simulated notifier and `() => new Date()`.
- `seedFromId(id: string): number`: 32-bit FNV-1a of the string.
- `loadMatchingInput(db, sessionId): Promise<{ input: MatchInput; venueId: string } | null>`. It builds the engine input from:
  - `seat_requests`, using `requestedAt = Date.parse(created_at)`
  - players (`skill`)
  - `player_games`, via `toEnginePlayer`
  - the venue's games and tables, via `toEngineGames` / `toEngineTables`
  - **the server-owned priority rule:** 1 if the player has a `waitlist_entries` row with status `'expired'` for another session in the same venue whose `starts_at` falls within the 7 days before this session's `starts_at`; otherwise 0
  - `seed = seedFromId(sessionId)`
- `runMatching(deps, sessionId): Promise<{ status: 'applied' | 'already_matched' | 'not_found' | 'no_requests'; seated: number; waitlisted: number }>`. It calls `formGroups`, maps the result to the `apply_matching` JSON, and calls the RPC.
- `fixtures.ts` provides:
  - `sandboxFor(db): Promise<{ ownerId; venueId }>`
  - `openSession(db, venueId): Promise<string>`: the first open session by `starts_at`
  - `fillSession(db, venueId, sessionId): Promise<void>`: inserts a request for every venue player who has none, so the night overflows the 32 seats

- [ ] **Step 1: Write the failing tests:**
  - `seats requesters and waitlists the rest`: after `fillSession`, `status 'applied'`, `seated + waitlisted = 40`, `waitlisted ≥ 8`, `bookings` count = `seated`, and the session is `matched`.
  - `refuses to match a night twice` (Review Focus 3): the second call returns `already_matched` and the group count is unchanged.
  - `gives priority to players left on the waitlist in the last 7 days`: insert an `expired` waitlist entry for player X on a closed session 2 days earlier, then `loadMatchingInput` shows X with `priority 1` and the others with 0.
  - `reports no_requests for a night nobody asked for`: delete the requests first.
- [ ] **Step 2: Run** `pnpm test:integration -- run-matching`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): runMatching feeds the engine and applies the night atomically`.

### Task 8: Cancelling and offering seats onward

**Files:**
- Create: `apps/web/lib/booking/offer-next-seat.ts`, `apps/web/lib/booking/cancel-booking.ts`, `apps/web/lib/booking/seat-context.ts`
- Test: `apps/web/test/integration/cancel-and-offer.test.ts`

**Interfaces:**
- `seatContext(db, groupId): Promise<{ groupId; sessionId; venueId; tableName; gameId; gameName; startsAt: string; timeZone: string; sessionStatus: string } | null>`
- `offerNextSeat(deps, groupId, seatNo): Promise<{ offerId: string; playerId: string } | null>`
  1. Return `null` unless the session is `matched` **and** `starts_at > deps.now()`.
  2. Build candidates from the `waiting` entries. Use `available: true` (they asked for this night), `priority` = the entry's priority, `requestedAt` = the matching `seat_requests.created_at`, plus skill and favourites.
  3. Get `tableSkills` from the live bookings in the group, then rank with `rankWaitlist`.
  4. Try `create_offer` for each candidate in order:
     - `entry_not_waiting` → try the next candidate.
     - `offer_pending` or `seat_not_free` → return `null`.
     - Success → send `sms.offer({table, game, time: formatShortTime(startsAt, tz)})` and return.
- `cancelBooking(deps, bookingId): Promise<{ status: 'cancelled' | 'not_found' | 'session_started' | 'not_cancellable'; offer: { offerId: string; playerId: string } | null }>`
  - Return `session_started` when `starts_at <= now`.
  - `booking_not_cancellable` → `not_cancellable`.
  - On success, send `sms.cancelled` to the player who cancelled, then call `offerNextSeat`.

- [ ] **Step 1: Write the failing tests.** Set up a sandbox, fill and match a night, and take one booking at a table:
  - `cancelling frees the seat and offers it to the best-ranked waitlisted player`:
    - the booking is `cancelled`;
    - there is one pending offer for that group and seat;
    - its player equals `rankWaitlist`'s top choice, recomputed in the test;
    - the canceller received the `sms.cancelled` text;
    - the candidate received the exact `sms.offer` text.
  - `offers nothing when nobody is waiting`: a matched night with no waitlist → `offer: null`.
  - `refuses to cancel once the night has started` (Review Focus 4): `now = starts_at + 1 min` → `session_started`, and the booking is still `confirmed`.
  - `does not offer seats for a night in progress` (Review Focus 4): `offerNextSeat` with `now` after the start → `null`.
- [ ] **Step 2: Run** `pnpm test:integration -- cancel-and-offer`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): cancellations hand the seat to the best waitlisted player`.

### Task 9: SMS replies

**Files:**
- Create: `apps/web/lib/booking/parse-reply.ts`, `apps/web/lib/booking/handle-reply.ts`
- Test: `apps/web/test/parse-reply.test.ts`, `apps/web/test/integration/handle-reply.test.ts`

**Interfaces:**
- `type ReplyKeyword = 'yes' | 'no' | 'cancel' | 'unknown'`
- `parseReply(body: string): ReplyKeyword`
  - Lower-case the text and strip everything except letters.
  - `yes|y|yeah|yep|sure` → `yes`; `no|n|nope|pass` → `no`; `c|cancel` → `cancel`; anything else → `unknown`.
- `handleReply(deps, { playerId, body, provider?: 'simulated' | 'twilio' }): Promise<{ keyword: ReplyKeyword; result: string }>`
  1. Always log the inbound message: `direction 'inbound'`, `provider ?? 'simulated'`.
  2. Find the player's **latest offer of any status**, via their waitlist entries, ordered by `created_at desc`.
  3. Then, by keyword:

  | Keyword | Situation | Result | SMS / follow-up |
  |---|---|---|---|
  | `yes` | no offer | `no_offer` | `sms.noOffer` |
  | `yes` | otherwise | the result of `accept_offer(latest)` | `accepted` → `sms.accepted`; `already_accepted` → nothing; `expired` or `declined` → `sms.late`; `seat_taken` → `sms.seatTaken`; `already_booked` → `sms.alreadyBooked`, then `offerNextSeat` |
  | `no` | no offer, or `decline_offer` returns `not_pending` | `no_offer` | `sms.noOffer` |
  | `no` | `declined` | `declined` | `sms.declined`, then `offerNextSeat` |
  | `cancel` | the player's next `confirmed` booking whose night hasn't started | `cancelled` | `cancelBooking` |
  | `cancel` | no such booking | `no_booking` | `sms.noBooking` |
  | `unknown` | — | `help` | `sms.help` |

- [ ] **Step 1: Write the failing tests:**
  - `parse-reply.test.ts` (Review Focus 1): a table test covering `' yes! '`→yes, `'Y'`→yes, `'YEP'`→yes, `'Nope.'`→no, `'n'`→no, `'C'`→cancel, `'cancel please'`→unknown, `'STOP'`→unknown, `''`→unknown, `'🤷'`→unknown.
  - `handle-reply.test.ts`, on a filled and matched night with one cancellation already offered:
    - `YES accepts the pending offer and confirms by SMS`
    - `a second YES sends nothing new`
    - `NO declines and offers the seat to the next player`
    - `YES with no offer gets the no-offer reply and changes nothing` (Review Focus 2)
    - `C cancels the next booking and offers the seat on`
    - `C with no booking gets the no-booking reply` (Review Focus 2)
    - `gibberish gets the help reply`
    - `every reply is logged as an inbound message`
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm test:integration -- handle-reply`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): SMS reply handler for YES / NO / C`.

### Task 10: Offer expiry job and cron

**Files:**
- Create: `apps/web/lib/booking/expire-offers-job.ts`, `apps/web/app/api/jobs/expire-offers/route.ts`
- Create (CLI): `supabase/migrations/<ts>_cron_jobs.sql`
- Create: `supabase/seed.sql`
- Test: `apps/web/test/expire-offers-route.test.ts`, `apps/web/test/integration/expire-offers-job.test.ts`, `supabase/tests/database/06_cron.test.sql`

**Interfaces:**
- `expireOffersJob(deps): Promise<{ expired: number; reoffered: number }>`. It runs the `expire_offers()` RPC, then for each row:
  - sends `sms.offerExpired({table})` to the player whose offer expired;
  - calls `offerNextSeat`.
- `POST /api/jobs/expire-offers`:
  - Returns `401 {error:'unauthorized'}` unless `Authorization === \`Bearer ${process.env.JOB_SECRET}\`` **and** `JOB_SECRET` is non-empty.
  - Otherwise returns `200` with the job's result as JSON.
- **Migration:**
  - `create extension if not exists pg_cron` and `create extension if not exists pg_net with schema extensions`.
  - `private.trigger_expire_offers() returns bigint`:
    - `security definer`, `search_path ''`.
    - Reads `app_url` and `job_secret` from `vault.decrypted_secrets`.
    - Returns `null` if either is missing.
    - Otherwise `net.http_post(url := app_url || '/api/jobs/expire-offers', headers := {Authorization: 'Bearer ' || job_secret, Content-Type: application/json}, body := '{}', timeout_milliseconds := 5000)`.
  - `private.cleanup_sandboxes() returns int`: deletes anonymous `auth.users` created more than 24 h ago (which cascades to their venues), plus `is_demo` venues whose `expires_at < now()`. Returns the number of venues removed.
  - Revoke execute on both functions from `public, anon, authenticated`.
  - Schedule `cron.schedule('expire-offers', '10 seconds', 'select private.trigger_expire_offers()')` and `cron.schedule('cleanup-sandboxes', '17 * * * *', 'select private.cleanup_sandboxes()')`.
- **`seed.sql`** (local only):
  - `select vault.create_secret('http://host.docker.internal:3000', 'app_url');`
  - `select vault.create_secret('local-dev-job-secret', 'job_secret');`

- [ ] **Step 1: Write the failing tests:**
  - `expire-offers-route.test.ts` (unit, no DB; set and restore `process.env.JOB_SECRET`):
    - `rejects a missing token`: 401.
    - `rejects a wrong token`: 401.
    - `rejects everything when JOB_SECRET is unset`: `Bearer ` → 401.
  - `expire-offers-job.test.ts` (integration):
    - `expires past-due offers, tells the player, and offers the seat onward`. Cancel to create an offer, set its `expires_at` in the past through the service db, run the job. Expect `{expired: 1, reoffered: 1}`, the `sms.offerExpired` text to the first player and an `sms.offer` text to the next one.
    - `does nothing when no offer is due`: `{expired: 0, reoffered: 0}`.
  - `06_cron.test.sql`:
    - `cron has both jobs on schedule` (query `cron.job`).
    - `the trigger returns null without vault secrets` (delete them inside the test transaction).
    - `the trigger queues a request with secrets` (returns a non-null id).
    - `cleanup removes stale anonymous users and expired demo venues but keeps fresh ones`.
    - `authenticated cannot call the private jobs`.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm test:integration -- expire && pnpm db:test`. Expected: FAIL.
- [ ] **Step 3: Implement** the job, the route, the migration and the seed.
- [ ] **Step 4: Run** `pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm --filter web test && pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: cron-driven offer expiry that hands seats onward`.

### Task 11: Owner UI: start demo, nights, matching and cancellations

**Files:**
- Create: `apps/web/lib/auth/dal.ts`, `apps/web/app/actions.ts`, `apps/web/app/owner/page.tsx`, `apps/web/app/owner/sessions/[sessionId]/page.tsx`, `apps/web/app/owner/actions.ts`, plus small components under `apps/web/components/owner/`
- Modify: `apps/web/app/page.tsx` (add the **Start the demo** button)
- shadcn: `pnpm dlx shadcn@latest add card badge table`

**Interfaces:**
- `dal.ts` (`server-only`):
  - `getUserId(): Promise<string | null>`, via `getClaims()`
  - `requireOwnerVenue(): Promise<{ userId: string; venue: VenueRow }>`: loads the newest non-expired demo venue owned by the user through the RLS client, and calls `redirect('/')` if there's no user or venue.
- **Actions:**
  - `startDemo()` (`app/actions.ts`): `signInAnonymously()` if there's no user, `createSandbox(createServiceClient(), userId)`, then `redirect('/owner')`.
  - `runMatchingAction(sessionId)` and `cancelBookingAction(bookingId)` (`app/owner/actions.ts`): load the session or booking through the RLS client, check `venue_id === requireOwnerVenue().venue.id` (otherwise throw `Error('forbidden')`), call the `lib/booking` function with `createBookingDeps()`, then `refresh()`.
- **Pages** (each data-reading part sits inside `<Suspense>` with a skeleton fallback):
  - `/owner`: the venue name and its nights. Upcoming first, then the last 7 closed ones. Each row shows `formatNight`, status, request count, booked count and waitlist count, and links to the night.
  - `/owner/sessions/[sessionId]`:
    - **Open nights:** the request list plus a **Run matching** button.
    - **Matched nights:** one card per table (game, players with skill and seat number, and a **Cancel** button per live booking), the waitlist in `queue_position` order with status, pending offers with the player and expiry time, and the night's last 20 events.

- [ ] **Step 1: Read the bundled Next docs** before writing code: `01-app/02-guides/authentication-with-cache-components.md`, `01-app/01-getting-started/07-mutating-data.md` and `16-proxy.md`.
- [ ] **Step 2: Implement** the DAL, the actions and the pages.
- [ ] **Step 3: Run** `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`. Expected: all pass, with no "uncached data accessed outside of `<Suspense>`" build errors.
- [ ] **Step 4: Smoke test** with `pnpm --filter web dev` and the Playwright MCP browser:
  1. Landing → **Start the demo**.
  2. `/owner` lists the nights.
  3. Open an open night, then **Run matching**: tables appear.
  4. Click **Cancel** on a booking. An offer appears under pending offers, if anyone is waiting.

  Screenshot each step into the workspace.
- [ ] **Step 5: Commit** `feat(web): owner pages to start a demo, match nights and cancel seats`.

### Task 12: Player UI (view-as) and the SMS inbox

**Files:**
- Create: `apps/web/app/play/page.tsx`, `apps/web/app/play/[playerId]/page.tsx`, `apps/web/app/play/actions.ts`, plus components under `apps/web/components/play/`
- shadcn: `pnpm dlx shadcn@latest add input label select checkbox`

**Interfaces:**
- **Actions** (`app/play/actions.ts`): every one first loads the player through the RLS client and checks `player.venue_id === requireOwnerVenue().venue.id`.
  - `updateProfileAction(playerId, formData)`: name, skill 1–5, `sms_opt_in`. Uses the RLS client.
  - `setFavouritesAction(playerId, gameIds: string[])`: 1–3 distinct ids. Deletes the old `player_games` rows, then inserts ranks 1..n.
  - `setAvailabilityAction(playerId, weekdays: number[])`: replaces the rows, copying start/end from the skin's nights.
  - `requestSeatAction(playerId, sessionId)` / `withdrawRequestAction(playerId, sessionId)`: open nights that haven't started only. Uses the RLS client.
  - `cancelMySeatAction(playerId, bookingId)`: calls `cancelBooking`.
  - `replyAction(playerId, body)`: calls `handleReply`.
  - All of them call `refresh()`.
- **Pages:**
  - `/play`: the venue's players (name, skill, favourite games) with links. A banner explains: *"You're the café owner. Pick a player to see the app as them."*
  - `/play/[playerId]`:
    - profile form;
    - favourites (three ranked selects);
    - availability (one checkbox per night);
    - upcoming nights with **Request a seat** / **Withdraw**, or the booked table and game with **Cancel my seat**;
    - a **Messages** panel: this player's messages, oldest first, with inbound ones right-aligned. It has a text box and quick-reply buttons **YES**, **NO** and **C** that call `replyAction`.

- [ ] **Step 1: Implement** the actions and pages, with the same `<Suspense>` rule as Task 11.
- [ ] **Step 2: Run** `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`. Expected: pass.
- [ ] **Step 3: Smoke test** in the Playwright MCP browser, from a fresh demo:
  1. Owner: fill a night by requesting seats as several players, run matching and cancel a booking.
  2. `/play/<offered player>`: the offer SMS shows in Messages. Tap **YES**: the confirmation appears, and the owner page shows the seat refilled.
  3. Repeat with **NO**: the next player gets the offer.

  Screenshot each step.
- [ ] **Step 4: Commit** `feat(web): view-as player pages with an SMS inbox`.

### Task 13: M2 wrap-up

- [ ] **Step 1: Run** `pnpm typecheck && pnpm test && pnpm --filter web build && pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm test:race && pnpm test:integration`. Expected: every command exits 0.
- [ ] **Step 2: Check the cron end to end.** Run `pnpm --filter web dev`. In the browser, cancel a booking so an offer goes out, then don't reply. Within about 70 s (60 s TTL plus the 10 s cron), the Messages panel shows the `offerExpired` text, and the next player has a new offer.
- [ ] **Step 3: Update the docs:**
  - `README.md`: env setup (`pnpm env:local`), `pnpm test:integration`, `pnpm db:lint`, and the demo flow.
  - `memory.md`: M2 decisions, the gotchas found, and the change log.
- [ ] **Step 4: Commit** `docs: M2 setup, flows and notes`.
