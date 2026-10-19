# M1 Foundation & Engine: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm monorepo, a deterministic TypeScript matching engine, a seeded data simulator, the Next.js shell with the board-game skin, and the Supabase schema with RLS and transactional booking RPCs. Everything is tested.

**Architecture:**
- `packages/engine` is pure TS with no I/O. It turns seat requests into table groups plus an ordered waitlist, and ranks waitlist candidates for an open seat.
- `packages/sim` generates DB-shaped rows (venue, players, 12 weeks of history) from a seed, using the engine.
- `apps/web` is the Next.js shell carrying the skin config.
- `supabase/` holds migrations: schema → RLS → RPCs. Postgres enforces seat invariants, so concurrent SMS replies can't double-book.

**Tech Stack:** Node 24, pnpm 12.14.0, TypeScript (strict), Vitest 5, fast-check 4, Next.js 16 (App Router), Tailwind 4, shadcn/ui, Supabase CLI 2.x (local Docker stack), pgTAP, `pg` (race test only).

**Spec:** `docs/superpowers/specs/2026-10-20-booking-matchmaking-design.md`

## Global Constraints

- Work on branch `m1-foundation`, created from `main` before Task 1. Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Use `"type": "module"` and TS `strict: true` everywhere. Workspace packages are consumed as TS source (`"exports": { ".": "./src/index.ts" }`), with no build step.
- Package names: `@bm/engine`, `@bm/sim`, `web`.
- `@bm/engine` has **zero runtime dependencies** and no I/O. It never calls `Math.random()` or `Date.now()`; all randomness comes from `createRng(seed)`.
- `@bm/sim` depends only on `@bm/engine`. No faker; it uses built-in name lists.
- Fake phone numbers come only from the Ofcom drama range `+447700900000`–`+447700900999`.
- Skill is an integer from 1 to 5. Money is stored in minor units (`*_cents`).
- DB naming is snake_case. The spec's `tables` table is named **`venue_tables`** to avoid clashing with the SQL keyword.
- Sim output rows use the **exact column names in the Schema Reference below**, so later milestones can insert them directly.
- No real SMS in M1. No Twilio dependency.
- TypeScript: use the major version that `create-next-app` installs (currently 7.x) and pin that same version at the root. If `next build`'s type-check fails on TS 7, pin `typescript@6.0.3` across the workspace.

## Schema Reference (used by Tasks 7, 9, 10, 11)

Every venue-scoped table has `venue_id uuid not null references venues(id) on delete cascade`, so RLS and Realtime filters can use it directly. Every table's `id` is `uuid primary key default gen_random_uuid()` unless noted. "cascade" means `on delete cascade`.

| Table | Columns & constraints |
|---|---|
| `venues` | `name text not null`; `timezone text not null default 'Europe/London'`; `skin text not null default 'boardgame'`; `offer_ttl_seconds int not null default 900 check (>0)`; `owner_id uuid not null → auth.users cascade`; `is_demo bool not null default false`; `expires_at timestamptz`; `created_at timestamptz not null default now()` |
| `venue_tables` | `name text not null`; `capacity smallint not null check (1..20)`; `x real not null default 0`; `y real not null default 0` |
| `games` | `name text not null`; `min_players smallint check (≥1)`; `max_players smallint`; `duration_min smallint check (>0)`; `popularity real not null default 1 check (>0)`; `check (min_players <= max_players)` |
| `players` | `user_id uuid null → auth.users on delete set null`; `name text not null`; `phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$')`; `skill smallint check (1..5)`; `sms_opt_in bool not null default true`; `created_at`; `unique (venue_id, phone)`; `unique (venue_id, user_id)` |
| `player_games` | no `id`; `player_id → players cascade`; `game_id → games cascade`; `rank smallint check (≥1)`; `primary key (player_id, game_id)`; `unique (player_id, rank)` |
| `availability` | `player_id → players cascade`; `weekday smallint check (0..6)` (0 = Sunday); `start_time time`; `end_time time`; `check (start_time < end_time)` |
| `sessions` | `starts_at timestamptz`; `ends_at timestamptz`; `seat_price_cents int check (≥0)`; `status session_status not null default 'open'`; `check (starts_at < ends_at)` |
| `seat_requests` | `session_id → sessions cascade`; `player_id → players cascade`; `priority smallint not null default 0`; `created_at`; `unique (session_id, player_id)` |
| `groups` | `session_id → sessions cascade`; `table_id → venue_tables cascade`; `game_id → games cascade`; `capacity smallint check (>0)`; `unique (session_id, table_id)` |
| `bookings` | `session_id → sessions cascade`; `group_id → groups cascade`; `player_id → players cascade`; `seat_no smallint check (≥1)`; `status booking_status not null default 'confirmed'`; `source booking_source not null default 'matched'`; `price_cents int check (≥0)`; `created_at`; `cancelled_at timestamptz`; **partial unique** `(session_id, player_id) where status <> 'cancelled'`; **partial unique** `(group_id, seat_no) where status <> 'cancelled'` |
| `waitlist_entries` | `session_id → sessions cascade`; `player_id → players cascade`; `priority smallint not null default 0`; `queue_position int not null` (1-based, from the engine); `status waitlist_status not null default 'waiting'`; `created_at`; `unique (session_id, player_id)` |
| `seat_offers` | `group_id → groups cascade`; `seat_no smallint`; `waitlist_entry_id → waitlist_entries cascade`; `status offer_status not null default 'pending'`; `expires_at timestamptz not null`; `created_at`; `responded_at timestamptz`; **partial unique** `(group_id, seat_no) where status = 'pending'` |
| `messages` | `player_id null → players on delete set null`; `direction message_direction`; `body text not null`; `provider text check (in ('simulated','twilio'))`; `provider_sid text`; `status text not null default 'sent'`; `created_at` |
| `events` | `session_id null → sessions cascade`; `type text not null`; `payload jsonb not null default '{}'`; `created_at` |

**Enums:**
- `session_status`: `open`, `matched`, `closed`
- `booking_status`: `confirmed`, `cancelled`, `attended`, `no_show`
- `booking_source`: `matched`, `waitlist`
- `waitlist_status`: `waiting`, `offered`, `promoted`, `expired`, `withdrawn`
- `offer_status`: `pending`, `accepted`, `declined`, `expired`
- `message_direction`: `outbound`, `inbound`

**Event `type` values and payload keys:**
- `booking_cancelled` {booking_id, player_id, group_id, seat_no}
- `offer_created` {offer_id, player_id, group_id, seat_no, expires_at}
- `offer_accepted` {offer_id, booking_id, player_id}
- `offer_declined` {offer_id, player_id}
- `offer_expired` {offer_id, player_id}
- `seat_filled` {group_id, seat_no, booking_id, seconds_since_cancel}

## Review Focus

These are inputs the spec implies but never spells out. Each one has a pinned test in the task that owns it:

1. **A night with too few players for any game, or with no tables or no players.** The engine returns everyone waitlisted, with no throw and no under-minimum groups (Task 3).
2. **Favourites pointing at deleted or unknown games.** They are ignored. A player with only unknown favourites is waitlisted, not crashed on (Task 3).
3. **A late or duplicate "YES" after an offer expired or was already accepted.** It returns `expired` / `already_accepted` and never creates a second booking (Task 11, including the true two-connection race).
4. **Session times across DST.** Local wall-clock nights convert to the correct UTC instant in summer and winter, including on the clock-change day (Task 6).
5. **Malformed phone numbers or out-of-range skill reaching the DB.** These are rejected by CHECK constraints (Task 9).

---

### Task 1: Workspace + engine types + seeded RNG

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/src/index.ts`, `packages/engine/src/types.ts`, `packages/engine/src/rng.ts`
- Test: `packages/engine/test/rng.test.ts`

**Interfaces:**
- Produces (`packages/engine/src/types.ts`, re-exported from `index.ts`):
  ```ts
  export type Id = string;
  export interface EnginePlayer { id: Id; skill: number; favourites: Id[]; priority: number; requestedAt: number }
  export interface EngineGame { id: Id; minPlayers: number; maxPlayers: number }
  export interface EngineTable { id: Id; capacity: number }
  export interface MatchConfig { preferenceWeights: number[]; skillWeight: number; fillWeight: number; iterations: number }
  export interface MatchInput { players: EnginePlayer[]; games: EngineGame[]; tables: EngineTable[]; config?: Partial<MatchConfig>; seed: number }
  export interface Group { tableId: Id; gameId: Id; playerIds: Id[] }
  export interface ScoreBreakdown { preference: number; skillSpread: number; filledSeats: number; underMin: number; total: number }
  export interface MatchResult { groups: Group[]; waitlist: Id[]; score: ScoreBreakdown; diagnostics: { iterations: number; acceptedSwaps: number } }
  ```
  - `favourites` is ordered, most preferred first.
  - `priority`: higher is served first.
  - `requestedAt`: epoch ms; earlier wins ties.
- Produces (`rng.ts`): `createRng(seed: number): Rng` where `interface Rng { next(): number; int(min: number, max: number): number; pick<T>(items: readonly T[]): T; shuffle<T>(items: readonly T[]): T[]; uuid(): string }`

- [ ] **Step 1: Scaffold the workspace.**
  - Create a root `package.json` with:
    - `"private": true`
    - `"packageManager": "pnpm@12.14.0"`
    - `"engines": {"node": ">=24"}`
    - scripts `"test": "pnpm -r --if-present test"` and `"typecheck": "pnpm -r --if-present typecheck"`
    - devDeps `typescript`, `vitest@^5`
  - `pnpm-workspace.yaml` lists `apps/*` and `packages/*`.
  - `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, `target ES2022`, `module ESNext`, `moduleResolution bundler`, `verbatimModuleSyntax`, `skipLibCheck`.
  - In `packages/engine/package.json`, set the name to `@bm/engine` and add scripts `"test": "vitest run"` and `"typecheck": "tsc --noEmit -p ."`.
  - Run `pnpm install`.
- [ ] **Step 2: Write the failing test** `packages/engine/test/rng.test.ts`:
  ```ts
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  it('replays the same sequence for the same seed', () => {
    const a = createRng(42), b = createRng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });
  it('differs across seeds', () => expect(createRng(1).next()).not.toBe(createRng(2).next()));
  it('next() is in [0, 1)', () => { const r = createRng(7); for (let i = 0; i < 10_000; i++) { const x = r.next(); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); } });
  it('int() is inclusive at both ends', () => { const r = createRng(3); const seen = new Set<number>(); for (let i = 0; i < 1000; i++) seen.add(r.int(1, 3)); expect([...seen].sort()).toEqual([1, 2, 3]); });
  it('shuffle() returns a permutation and leaves the input untouched', () => { const input = [1, 2, 3, 4, 5]; const out = createRng(5).shuffle(input); expect(input).toEqual([1, 2, 3, 4, 5]); expect([...out].sort()).toEqual(input); expect(createRng(5).shuffle(input)).toEqual(out); });
  it('uuid() is deterministic RFC 4122 v4', () => { expect(createRng(9).uuid()).toBe(createRng(9).uuid()); expect(createRng(9).uuid()).toMatch(UUID_V4); });
  ```
- [ ] **Step 3: Run** `pnpm --filter @bm/engine test`. Expected: FAIL (cannot resolve `../src/rng`).
- [ ] **Step 4: Implement** `types.ts` as above. For `rng.ts`, use mulberry32 for `next()`. `shuffle` is Fisher–Yates on a copy. `uuid()` takes 16 bytes from `int(0,255)`, sets the version nibble to 4 and the variant bits to `10`, and formats as 8-4-4-4-12. Re-export everything from `index.ts`.
- [ ] **Step 5: Run** `pnpm --filter @bm/engine test && pnpm --filter @bm/engine typecheck`. Expected: PASS, no type errors.
- [ ] **Step 6: Commit** `feat(engine): workspace scaffold, engine types and seeded RNG`.

### Task 2: Scoring, config and explanations

**Files:**
- Create: `packages/engine/src/config.ts`, `packages/engine/src/score.ts`, `packages/engine/src/explain.ts`
- Test: `packages/engine/test/score.test.ts`, `packages/engine/test/explain.test.ts`

**Interfaces:**
- Consumes: the types from Task 1.
- Produces:
  - `DEFAULT_CONFIG: MatchConfig = { preferenceWeights: [3, 2, 1], skillWeight: 1, fillWeight: 2, iterations: 2000 }`
  - `UNDER_MIN_PENALTY = 1000`
  - `resolveConfig(partial?: Partial<MatchConfig>): MatchConfig`
  - `groupCapacity(game: EngineGame, table: EngineTable): number`, which is `min(table.capacity, game.maxPlayers)`
  - `canHost(game: EngineGame, table: EngineTable): boolean`, which is `groupCapacity ≥ game.minPlayers`
  - `scoreGroups(groups: Group[], input: MatchInput): ScoreBreakdown`
  - `explainScore(result: MatchResult, input: MatchInput, playerId: Id): PlayerExplanation`, where:
    ```ts
    export interface PlayerExplanation { playerId: Id; status: 'seated' | 'waitlisted'; tableId?: Id; gameId?: Id; favouriteRank?: number; preferencePoints?: number; tableSkillRange?: [number, number]; waitlistPosition?: number; reason: string }
    ```

**Scoring rules:**
- `preference` = Σ over seated players of `preferenceWeights[rank] ?? 0`, where rank is the 0-based index of the group's game in that player's favourites.
- `skillSpread` = Σ over groups of (max skill − min skill).
- `filledSeats` = number of seated players.
- `underMin` = number of groups below their game's `minPlayers`.
- `total = preference − skillWeight·skillSpread + fillWeight·filledSeats − UNDER_MIN_PENALTY·underMin`

- [ ] **Step 1: Write the failing tests.** Fixture: game `g1` {min 2, max 4}, table `t1` {capacity 4}, `p1` {skill 1, favourites ['g1']}, `p2` {skill 3, favourites ['x', 'g1']}.
  ```ts
  it('scores a group', () => expect(scoreGroups([{ tableId: 't1', gameId: 'g1', playerIds: ['p1', 'p2'] }], input))
    .toEqual({ preference: 5, skillSpread: 2, filledSeats: 2, underMin: 0, total: 7 }));
  it('penalises groups under the game minimum', () => expect(scoreGroups([{ tableId: 't1', gameId: 'g1', playerIds: ['p1'] }], input).underMin).toBe(1));
  it('caps capacity at the game maximum', () => expect(groupCapacity({ id: 'g', minPlayers: 2, maxPlayers: 4 }, { id: 't', capacity: 6 })).toBe(4));
  it('rejects tables too small for the game minimum', () => expect(canHost({ id: 'g', minPlayers: 3, maxPlayers: 4 }, { id: 't', capacity: 2 })).toBe(false));
  it('merges partial config over defaults', () => expect(resolveConfig({ iterations: 0 })).toEqual({ ...DEFAULT_CONFIG, iterations: 0 }));
  // explain.test.ts — result = { groups: [{ tableId: 't1', gameId: 'g1', playerIds: ['p1', 'p2'] }], waitlist: ['p3'], ... }
  it('explains a seated player', () => expect(explainScore(result, input, 'p2')).toMatchObject({ status: 'seated', favouriteRank: 1, preferencePoints: 2, tableSkillRange: [1, 3], reason: 'Seated for your #2 pick with players of skill 1–3' }));
  it('explains a waitlisted player', () => expect(explainScore(result, input, 'p3')).toMatchObject({ status: 'waitlisted', waitlistPosition: 1, reason: 'Waitlisted at position 1: every table running one of your games is full' }));
  it('throws for unknown players', () => expect(() => explainScore(result, input, 'nope')).toThrow('Unknown player nope'));
  ```
- [ ] **Step 2: Run** `pnpm --filter @bm/engine test`. Expected: FAIL (missing modules).
- [ ] **Step 3: Implement** the three modules and export them from `index.ts`.
- [ ] **Step 4: Run** `pnpm --filter @bm/engine test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): scoring, config defaults and player explanations`.

### Task 3: `formGroups` — greedy seating, repair, skill chunking, swap search

**Files:**
- Create: `packages/engine/src/form-groups.ts`
- Test: `packages/engine/test/form-groups.test.ts`

**Interfaces:**
- Consumes: `createRng`, `resolveConfig`, `groupCapacity`, `canHost`, `scoreGroups`.
- Produces: `formGroups(input: MatchInput): MatchResult`.
  - `groups` are ordered by their table's position in the sorted table list.
  - `waitlist` is in service order.

**Algorithm** (the tests don't pin it all down, so follow this exactly):
```
favs(p)       = p.favourites, de-duplicated, keeping only known game ids, in order
service order = players sorted by priority desc, requestedAt asc, id asc
tables        = sorted by capacity asc, id asc; banned = Set<"tableId|gameId">

seatPass(pool):   // pool in service order; groups/free tables persist across passes
  for p in pool: for g in favs(p):
    if an existing group of g (creation order) has size < its capacity → join it; next player
    else t = first free table with canHost(g, t) and "t|g" not banned → open group(t, g, capacity = groupCapacity) with p; next player
  players never seated stay unseated

1. seatPass(all players)
2. repeat: under = groups with size < game.minPlayers; if none, stop
     for each: ban "table|game", free the table, return members to unseated
     seatPass(unseated, in service order)   // terminates: each round bans ≥1 of finitely many pairs
3. for each game with ≥2 groups: members sorted by (skill asc, id asc), refilled into its groups
   (in table order) as contiguous chunks, keeping each group's current size
4. repeat cfg.iterations times: pick two seated players a, b from different groups uniformly via rng;
     if b's game ∈ favs(a) and a's game ∈ favs(b), swap them; keep the swap only if scoreGroups().total strictly increases
     (count kept swaps in diagnostics.acceptedSwaps)
5. waitlist = unseated players in service order
```

- [ ] **Step 1: Write the failing tests.** Build fixtures with a small helper, `player(id, skill, favourites, priority = 0, requestedAt = index)`.
  ```ts
  it('seats everyone when seats suffice', ...)                // 4× favs ['catan'], catan {3,4}, one table cap 4 → 1 group of 4, waitlist []
  it('waitlists overflow in service order', ...)              // p1..p6 favs ['catan'], priorities [0,5,0,0,1,0], one table cap 4
                                                              //   → seated set {p2,p5,p1,p3}, waitlist ['p4','p6']
  it('groups similar skills at the same table', ...)          // 8× favs ['azul'], azul {2,4}, two tables cap 4, skills [1,5,1,5,2,4,2,4]
                                                              //   → sorted per-group skills [[1,1,2,2],[4,4,5,5]]
  it('dissolves under-minimum groups and falls back to the next favourite', ...)
                                                              // p1,p2 favs ['catan','azul'], catan {3,4}, azul {2,4}, one table cap 4 → one group, gameId 'azul'
  it('waitlists players whose only game cannot reach its minimum', ...)  // p1,p2 favs ['catan'] → groups [], waitlist ['p1','p2']
  // Review Focus 1 & 2:
  it('handles no players', () => expect(formGroups({ ...base, players: [] })).toMatchObject({ groups: [], waitlist: [] }));
  it('handles no tables', ...)                                // everyone waitlisted
  it('ignores tables too small for every game', ...)          // tables cap 2, every game min 3 → groups []
  it('ignores favourites that reference unknown games', ...)  // p1 favs ['ghost'] → waitlist ['p1'], no throw
  ```
- [ ] **Step 2: Run** `pnpm --filter @bm/engine test -- form-groups`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `formGroups` per the algorithm and export it.
- [ ] **Step 4: Run** `pnpm --filter @bm/engine test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): formGroups greedy seating, repair, skill chunking and swap search`.

### Task 4: Engine property tests + latency benchmark

**Files:**
- Modify: `packages/engine/package.json` (devDep `fast-check@^4`)
- Test: `packages/engine/test/arbitraries.ts`, `packages/engine/test/form-groups.property.test.ts`, `packages/engine/test/bench.test.ts`

**Interfaces:**
- Consumes: `formGroups`, `groupCapacity`.
- Produces: `arbMatchInput(): fc.Arbitrary<MatchInput>`. It generates:
  - 1–6 games (min 1–4, max between min and 8)
  - 0–10 tables (capacity 1–10)
  - 0–80 players (skill 1–5, priority 0–3, distinct requestedAt, 0–3 favourites drawn from the game ids, plus an `'unknown'` id 10% of the time)
  - a random integer seed

- [ ] **Step 1: Write the property tests.** Use `fc.assert(fc.property(arbMatchInput(), …), { numRuns: 300 })`. Each test is named after its invariant:
  - `every player is seated exactly once or waitlisted exactly once`
  - `groups use distinct tables and sizes stay within [game.minPlayers, groupCapacity]`
  - `seated players only play a favourite game`
  - `same input gives the same result`: `expect(formGroups(i)).toEqual(formGroups(structuredClone(i)))`
  - `no waitlisted player fits a free seat in a group running one of their favourites`
  - `swap search never lowers the score`: `formGroups(i).score.total >= formGroups({ ...i, config: { iterations: 0 } }).score.total`
  - `when everyone wants one game, every seated player has priority ≥ every waitlisted player`. This uses a dedicated arbitrary with a single game.
- [ ] **Step 2: Write** `bench.test.ts`, `it('matches 500 players in under 100ms')`:
  - Fixture: seed 1, 10 games {min 2, max 6}, 60 tables of capacity 4–6 (via `createRng(1)`), 500 players with 1–3 favourites.
  - Do one warm-up call, then take the median of 5 `performance.now()` timings.
  - Assert `< 100`.
- [ ] **Step 3: Run** `pnpm --filter @bm/engine test`. Expected: PASS. If a property fails, fix `form-groups.ts`, not the property. fast-check prints the shrunk counterexample; add it as an example test in `form-groups.test.ts` before fixing.
- [ ] **Step 4: Commit** `test(engine): property tests for matching invariants and latency benchmark`.

### Task 5: `rankWaitlist`

**Files:**
- Create: `packages/engine/src/rank-waitlist.ts`
- Test: `packages/engine/test/rank-waitlist.test.ts`

**Interfaces:**
- Produces:
  - `interface OpenSeat { gameId: Id; tableSkills: number[] }`
  - `type WaitlistCandidate = EnginePlayer & { available: boolean }`
  - `rankWaitlist(seat: OpenSeat, candidates: WaitlistCandidate[]): Id[]`
- **Rules:**
  1. Keep candidates where `available` is true and `favourites` includes `seat.gameId`.
  2. Sort by `fit = Math.round(|skill − mean(tableSkills)|)` ascending. Fit is 0 when `tableSkills` is empty.
  3. Break ties by priority desc, then requestedAt asc, then id asc.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('drops unavailable candidates and those who do not want the game', ...)
  it('ranks skill fit above priority', ...)        // tableSkills [4,4,5]; c1 {skill 4, priority 0}, c2 {skill 1, priority 9} → ['c1','c2']
  it('breaks fit ties by priority', ...)           // c1 {skill 4, priority 0}, c2 {skill 4, priority 2} → ['c2','c1']
  it('breaks remaining ties by requestedAt', ...)
  it('ranks by priority at an empty table', ...)   // tableSkills []
  ```
- [ ] **Step 2: Run** `pnpm --filter @bm/engine test -- rank-waitlist`. Expected: FAIL.
- [ ] **Step 3: Implement** it and export it from `index.ts`.
- [ ] **Step 4: Run** `pnpm --filter @bm/engine test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): rankWaitlist for open-seat offers`.

### Task 6: Sim — venue, players and timezone conversion

**Files:**
- Create: `packages/sim/package.json` (`@bm/sim`, dep `"@bm/engine": "workspace:*"`), `packages/sim/tsconfig.json`, `packages/sim/src/index.ts`, `packages/sim/src/rows.ts`, `packages/sim/src/catalogue.ts`, `packages/sim/src/names.ts`, `packages/sim/src/time.ts`, `packages/sim/src/venue.ts`, `packages/sim/src/players.ts`, `packages/sim/src/engine-adapters.ts`
- Test: `packages/sim/test/time.test.ts`, `packages/sim/test/venue-players.test.ts`

**Interfaces:**
- Consumes: `createRng` from `@bm/engine`.
- Produces:
  - `rows.ts`: one row type per Schema Reference table, using **snake_case keys exactly as in the table**. Timestamps are ISO strings, times are `'HH:MM'`, and every row has its `id` (except `player_games`) and `venue_id`. Examples: `VenueRow`, `VenueTableRow`, `GameRow`, `PlayerRow`, `PlayerGameRow`, `AvailabilityRow`, `SessionRow`, `SeatRequestRow`, `GroupRow`, `BookingRow`, `WaitlistEntryRow`, `SeatOfferRow`, `EventRow`.
  - `catalogue.ts`:
    - `interface SeedGame { name: string; minPlayers: number; maxPlayers: number; durationMin: number; popularity: number }`
    - `interface SeedTable { name: string; capacity: number; x: number; y: number }`
    - `interface SeedNight { weekday: 0|1|2|3|4|5|6; start: string; end: string; seatPriceCents: number }`
    - `interface Catalogue { games: SeedGame[]; tables: SeedTable[]; nights: SeedNight[] }`
  - `time.ts`: `zonedTimeToUtc(date: string /* YYYY-MM-DD */, time: string /* HH:MM */, timeZone: string): Date`. Use the `Intl.DateTimeFormat` offset technique; no date library.
  - `venue.ts`: `generateVenue(o: { catalogue: Catalogue; name: string; timezone: string; ownerId: string; seed: number }): SimVenue`, where `SimVenue = { venue: VenueRow; venue_tables: VenueTableRow[]; games: GameRow[]; nights: SeedNight[] }`
  - `players.ts`: `generatePlayers(o: { venue: SimVenue; count: number; seed: number }): SimPlayers`, where `SimPlayers = { players: PlayerRow[]; player_games: PlayerGameRow[]; availability: AvailabilityRow[] }`
  - `engine-adapters.ts`, used by Task 7, Task 8 and later milestones:
    - `toEngineGames(games: GameRow[]): EngineGame[]`
    - `toEngineTables(tables: VenueTableRow[]): EngineTable[]`
    - `toEnginePlayer(player: PlayerRow, playerGames: PlayerGameRow[], priority: number, requestedAt: number): EnginePlayer`. `favourites` comes from this player's `player_games`, sorted by `rank`.
- **Generation rules:**
  - Skill weights by level 1–5: 10/25/35/20/10 %.
  - Each player gets 1–3 distinct favourite games, drawn weighted by `popularity`, with rank starting at 1.
  - Each player is available on 1–3 venue nights, taking that night's weekday and start/end.
  - Names look like `"Maya K."` and come from built-in lists of 40 first names and 26 surname initials.
  - The phone for index *i* is `+447700900` followed by *i* zero-padded to 3 digits. If `count > 1000`, throw `RangeError('generatePlayers supports at most 1000 players')`.

- [ ] **Step 1: Write the failing tests** (Review Focus 4 in `time.test.ts`):
  ```ts
  it('converts BST wall time', () => expect(zonedTimeToUtc('2026-07-11', '14:00', 'Europe/London').toISOString()).toBe('2026-07-11T13:00:00.000Z'));
  it('converts GMT wall time', () => expect(zonedTimeToUtc('2026-01-10', '14:00', 'Europe/London').toISOString()).toBe('2026-01-10T14:00:00.000Z'));
  it('handles the spring-forward day', () => expect(zonedTimeToUtc('2026-03-29', '19:00', 'Europe/London').toISOString()).toBe('2026-03-29T18:00:00.000Z'));
  ```
  Then in `venue-players.test.ts`, using a tiny inline catalogue:
  - `generates identical output for the same seed`
  - `creates the requested number of players with unique ids and drama-range phones` (`/^\+447700900\d{3}$/`)
  - `gives each player 1–3 distinct favourites from the venue's games, ranked from 1`
  - `keeps skills as integers 1–5`
  - `only uses venue nights for availability`
  - `rejects more than 1000 players`, which expects a `RangeError`
  - `toEnginePlayer orders favourites by rank`: player_games ranks {g2: 1, g1: 2} → `favourites` `['g2', 'g1']`
- [ ] **Step 2: Run** `pnpm install && pnpm --filter @bm/sim test`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules. In `generateVenue`, row ids come from `rng.uuid()` and the venue gets `offer_ttl_seconds: 900`, `is_demo: false`.
- [ ] **Step 4: Run** `pnpm --filter @bm/sim test && pnpm --filter @bm/sim typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): seeded venue and player generators with timezone-safe times`.

### Task 7: Sim — 12-week history

**Files:**
- Create: `packages/sim/src/history.ts`
- Test: `packages/sim/test/history.test.ts`

**Interfaces:**
- Consumes: `formGroups`, `rankWaitlist`, `groupCapacity` from `@bm/engine`; `SimVenue`, `SimPlayers`, `zonedTimeToUtc`, and the row types from Task 6.
- Produces: `generateHistory(o: { venue: SimVenue; players: SimPlayers; weeks: number; endDate: string /* YYYY-MM-DD, exclusive */; seed: number }): SimHistory`, where `SimHistory = { sessions; seat_requests; groups; bookings; waitlist_entries; seat_offers; events }`. Each field is an array of the matching row type.

**Rules:**
- **Sessions.** Create one session per venue night in each of the `weeks` weeks before `endDate`, with status `closed`. Use `zonedTimeToUtc` with the venue's timezone.
- **Requests.** Only players available that weekday can request. The request probability is 0.55 on Fri/Sat and 0.35 on other nights. `priority` is 1 if the player was waitlisted at their previous session, otherwise 0.
- **Matching.** Run `formGroups` with `seed + sessionIndex`. Seat numbers within a group are 1..n, in `playerIds` order.
- **Booking outcomes.** Each booking is `attended` (85%), `no_show` (5%) or `cancelled` (10%). A cancelled booking gets `cancelled_at = starts_at − rng.int(1, 48) hours`.
- **Waitlist.** Every waitlisted player gets an entry with `queue_position` = waitlist index + 1.
- **Refills.** For each cancelled seat, with probability 0.7, offer it to the top `rankWaitlist` candidate who is still `waiting`. The offer is created 0–2 min after the cancellation and accepted 1–30 min after it is created. This produces:
  - an `accepted` offer,
  - a new booking with `source 'waitlist'` and status `attended`,
  - the entry set to `promoted`,
  - events `booking_cancelled`, `offer_created`, `offer_accepted`, `seat_filled` (with `seconds_since_cancel`), all with realistic `created_at`.
- **Leftovers.** Entries still `waiting` end as `expired`.
- **Timestamps** (`h` = hours before `starts_at`):
  - `seat_requests.created_at` is `starts_at − rng.int(73, 240) h`. That value, parsed to epoch ms, is the engine's `requestedAt`.
  - Matched bookings and waitlist entries have `created_at = starts_at − 72 h`, and every booking's `price_cents` is the session's `seat_price_cents`.
  - Event `created_at` values:
    - `booking_cancelled` = `cancelled_at`
    - `offer_created` = the offer's `created_at`
    - `offer_accepted` and `seat_filled` = the offer's `responded_at`
  - `seconds_since_cancel` = `responded_at − cancelled_at`, in seconds.

- [ ] **Step 1: Write the failing tests** (fixture: the Task 6 inline catalogue, 60 players, `weeks: 12`, `endDate: '2026-10-19'`, seed 7):
  - `is deterministic for a seed`
  - `creates weeks × nights sessions, all before endDate, ordered by starts_at`
  - `references only existing sessions, groups and players`
  - `never puts two live bookings in one seat or one player twice in a session`. A booking is live when `status <> 'cancelled'`; this mirrors the DB partial unique indexes.
  - `backs every seat_filled event with a waitlist-sourced booking and positive seconds_since_cancel`
  - `keeps the cancellation share between 5% and 20%`
- [ ] **Step 2: Run** `pnpm --filter @bm/sim test -- history`. Expected: FAIL.
- [ ] **Step 3: Implement** `generateHistory` and export it.
- [ ] **Step 4: Run** `pnpm --filter @bm/sim test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): 12-week booking history generator driven by the engine`.

### Task 8: Next.js shell + board-game skin

**Files:**
- Create (via CLI): `apps/web/*` (Next.js App Router, Tailwind 4, ESLint, alias `@/*`, no `src/`), `apps/web/components.json` (shadcn init)
- Create: `apps/web/skins/types.ts`, `apps/web/skins/boardgame.ts`, `apps/web/skins/index.ts`, `apps/web/lib/theme.ts`, `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json` (name `web`; deps `@bm/engine`, `@bm/sim` as `workspace:*`; scripts `test: vitest run`, `typecheck: tsc --noEmit`), `apps/web/next.config.ts` (`transpilePackages: ['@bm/engine', '@bm/sim']`), `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`
- Test: `apps/web/test/skins.test.ts`

**Interfaces:**
- Consumes: `Catalogue`, `generateVenue`, `generatePlayers`, `toEngineGames`, `toEngineTables`, `toEnginePlayer` from `@bm/sim`; `canHost`, `formGroups` from `@bm/engine`.
- Produces:
  - `interface Skin { key: 'boardgame'; brand: { name: string; tagline: string }; currency: string; timezone: string; labels: { resource: string; resourcePlural: string; activity: string; activityPlural: string; session: string; sessionPlural: string; participant: string; participantPlural: string }; palette: { primary: string; accent: string; background: string; foreground: string }; catalogue: Catalogue }`
  - `getSkin(key: string): Skin`, which throws `Unknown skin <key>` for an unknown key.
  - `skinToCssVars(skin: Skin): Record<string, string>`, which maps the palette to `--primary`, `--accent`, `--background`, `--foreground`.

**Board-game skin values:**

| Field | Value |
|---|---|
| Brand name | `Meeple House` |
| Tagline | `Find your table. Meet your game-night crew.` |
| Currency | `GBP` |
| Timezone | `Europe/London` |
| Labels | table/tables, game/games, night/nights, player/players |
| Palette | primary `#0F766E`, accent `#F59E0B`, background `#FFFBF5`, foreground `#1C1917` |

Games (min, max, duration in minutes, popularity):

| Game | Min | Max | Duration (min) | Popularity |
|---|---|---|---|---|
| Catan | 3 | 4 | 90 | 10 |
| Ticket to Ride | 2 | 5 | 60 | 9 |
| Codenames | 4 | 8 | 20 | 8 |
| Carcassonne | 2 | 5 | 45 | 7 |
| Azul | 2 | 4 | 40 | 7 |
| Wingspan | 1 | 5 | 70 | 6 |
| Pandemic | 2 | 4 | 60 | 6 |
| 7 Wonders | 3 | 7 | 30 | 5 |

Tables: `Table 1`–`Table 5` have capacity 4, and `Table 6`–`Table 7` have capacity 6, for **32 seats** in total. Lay them out on a grid for x/y.

Nights:

| Night | Weekday | Times | Seat price (cents) |
|---|---|---|---|
| Tue | 2 | 18:00–22:00 | 600 |
| Thu | 4 | 18:00–22:00 | 600 |
| Fri | 5 | 18:00–23:00 | 800 |
| Sat | 6 | 14:00–23:00 | 1000 |
| Sun | 0 | 13:00–19:00 | 700 |

- [ ] **Step 1: Scaffold the app.**
  - Run `pnpm create next-app@latest apps/web --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-pnpm --skip-install --disable-git --yes`.
  - In `apps/web`, run `pnpm dlx shadcn@latest init` with the defaults.
  - Apply the package.json and next.config edits listed above, then run `pnpm install` at the root.
- [ ] **Step 2: Write the failing tests** in `test/skins.test.ts`:
  - `getSkin returns the board-game skin and rejects unknown keys`
  - `every game has min ≤ max and positive popularity`
  - `every game can be hosted by at least one table`
  - `the floor has 32 seats`: sum of table capacities `toBe(32)`
  - `night weekdays are unique`
  - `skinToCssVars maps the palette`: `toEqual({ '--primary': '#0F766E', '--accent': '#F59E0B', '--background': '#FFFBF5', '--foreground': '#1C1917' })`
  - `a 40-player demo night leaves a waitlist`: with `generateVenue(seed 2026)` and `generatePlayers(count 40, seed 2026)`, everyone requests the Friday night, so `formGroups(...).waitlist.length` is `≥ 4` and `groups.length` is `≥ 5`. This pins the demo story's precondition.
- [ ] **Step 3: Run** `pnpm --filter web test`. Expected: FAIL.
- [ ] **Step 4: Implement** the skins and `theme.ts`.
  - In `layout.tsx`, put `skinToCssVars(getSkin('boardgame'))` on `<html style>`, and set metadata `title` to the brand name and `description` to the tagline.
  - Replace the template contents of `page.tsx` with a hero that shows the brand name, tagline, and the line "Live demo coming soon".
- [ ] **Step 5: Run** `pnpm --filter web test && pnpm --filter web build`. Expected: tests PASS, and the build completes (applying the TS fallback from Global Constraints if needed).
- [ ] **Step 6: Commit** `feat(web): Next.js shell with config-driven board-game skin`.

### Task 9: Supabase local stack + schema migration

**Prerequisite:** Docker Desktop is installed and running (`docker info` succeeds).

**Files:**
- Create (via CLI): `supabase/config.toml`
- Create: `supabase/migrations/20261020000001_schema.sql`, `supabase/tests/database/01_schema.test.sql`, `README.md`
- Modify: root `package.json` (devDep `supabase@^2`; scripts `"db:start": "supabase start"`, `"db:reset": "supabase db reset"`, `"db:test": "supabase test db"`)

**Interfaces:**
- Produces: every table, enum and constraint in the **Schema Reference**, plus `venue_id` indexes on each venue-scoped table and an index on `seat_offers (status, expires_at)`.

- [ ] **Step 1: Set up the CLI.** Run `pnpm add -D -w supabase`, then `pnpm supabase init`, then `pnpm db:start`. Expected: the local stack is up, and the DB URL is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- [ ] **Step 2: Write the failing pgTAP test** `01_schema.test.sql`. Wrap it in `begin; create extension if not exists pgtap with schema extensions; select plan(N); … select * from finish(); rollback;`. It covers:
  - `has_table` for all 14 tables.
  - `has_enum` for all 6 enums.
  - `throws_ok` for:
    - `skill = 6` (`23514`)
    - `phone = 'not-a-phone'` (`23514`) (Review Focus 5)
    - a game with `min_players 5, max_players 4` (`23514`)
    - two `confirmed` bookings for the same (session, player) (`23505`)
    - two live bookings in the same (group, seat) (`23505`)
    - two `pending` offers for the same (group, seat) (`23505`)
  - `lives_ok` for a `cancelled` plus a `confirmed` booking in the same seat.
  - Fixtures insert into `auth.users (id, email)` first.
- [ ] **Step 3: Run** `pnpm db:test`. Expected: FAIL (tables missing).
- [ ] **Step 4: Write the migration** to match the Schema Reference exactly.
- [ ] **Step 5: Run** `pnpm db:reset && pnpm db:test`. Expected: PASS.
- [ ] **Step 6: Write `README.md`.** Cover:
  - the project pitch (one paragraph from the spec)
  - prerequisites: Node 24, pnpm via Corepack, Docker Desktop
  - `pnpm install`
  - `pnpm db:start`
  - `pnpm test`
  - `pnpm db:test`
  - `pnpm --filter web dev`
- [ ] **Step 7: Commit** `feat(db): Supabase schema with booking invariants as constraints`.

### Task 10: Row-level security

**Files:**
- Create: `supabase/migrations/20261020000002_rls.sql`, `supabase/tests/database/02_rls.test.sql`

**Interfaces:**
- Produces:
  - `public.is_venue_owner(v uuid) returns boolean`
  - `public.is_venue_member(v uuid) returns boolean`, which is true for the owner or a player whose `user_id = auth.uid()`

  Both are `language sql stable security definer set search_path = ''`.
- **Policy matrix.** RLS is enabled on every table, and `anon` gets nothing.

  | Tables | Owner | Player (own venue) |
  |---|---|---|
  | `venues`, `venue_tables`, `games`, `sessions`, `groups` | full CRUD | select |
  | `players` | full CRUD | select/update own row (`user_id = auth.uid()`) |
  | `player_games`, `availability`, `seat_requests` | full CRUD | select/insert/update/delete own rows (via own `players` row) |
  | `bookings`, `waitlist_entries`, `seat_offers`, `messages` | **select only** | select own rows |
  | `events` | select only | none |

  **Deliberate deviation from the spec's "full access":** writes to booking-flow tables go only through the Task 11 RPCs, which run as `service_role`. That keeps seat invariants in one place.

- [ ] **Step 1: Write the failing pgTAP test.** Fixtures: owners A and B, each with a venue; player user P in venue A; another player Q in venue A; one booking each for P and Q. Switch identity with `set local role authenticated; set local request.jwt.claims = '{"sub":"…","role":"authenticated"}';`. Assertions:
  - Owner A sees venue A's players and 0 of venue B's.
  - Owner B updating venue A's game changes 0 rows.
  - P sees exactly 1 row in `players`, sees venue A's `games`, sees 1 booking (their own), and sees 0 rows in `events`.
  - P can insert their own `availability`.
  - P inserting `availability` for Q throws `42501`.
  - Owner A inserting into `bookings` throws `42501`.
  - `anon` sees 0 venues.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `pnpm db:reset && pnpm db:test`. Expected: PASS (01 and 02).
- [ ] **Step 5: Commit** `feat(db): row-level security for owners and players`.

### Task 11: Booking RPCs + accept-offer race test

**Files:**
- Create: `supabase/migrations/20261020000003_booking_rpcs.sql`, `supabase/tests/database/03_booking_rpcs.test.sql`, `supabase/tests/race/accept-offer-race.test.ts`
- Modify: root `package.json` (devDeps `pg`, `@types/pg`; script `"test:race": "vitest run supabase/tests/race"`)

**Interfaces:**

All functions are `plpgsql`, `security invoker` and `set search_path = ''`, with `revoke execute … from public, anon, authenticated` and `grant execute … to service_role`. Each one writes the Schema Reference event for what it does.

- **`cancel_booking(p_booking_id uuid) returns table (group_id uuid, seat_no smallint, session_id uuid)`**
  - `confirmed` → set to `cancelled` with `cancelled_at = now()`, write the event, and return the row.
  - Already `cancelled` → return the row; **no second event**.
  - `attended` / `no_show` → `raise exception 'booking_not_cancellable'`.
  - Missing → return no rows.
- **`create_offer(p_group_id uuid, p_seat_no smallint, p_waitlist_entry_id uuid) returns uuid`**
  - Raises `seat_not_free` if a live booking holds the seat.
  - Raises `offer_pending` if a pending offer exists for the seat.
  - Raises `entry_not_waiting` unless the entry is `waiting`.
  - Otherwise: entry → `offered`, `expires_at = now() + venue.offer_ttl_seconds`.
- **`accept_offer(p_offer_id uuid) returns text`**
  1. Lock the offer, then its group (`for update`).
  2. Return codes, in order:
     - `not_found`
     - `already_accepted` (idempotent duplicate YES)
     - `declined`
     - `expired`: status is expired, or it is still pending with `expires_at <= now()`. A pending one gets marked `expired` and its entry `expired`.
     - `seat_taken`: a live booking holds the seat; mark the offer `expired`.
     - `already_booked`: the player already has a live booking in this session.
     - `accepted`: insert booking (`source 'waitlist'`, `price_cents` = the session's `seat_price_cents`, next to `confirmed`); offer → `accepted` with `responded_at`; entry → `promoted`; write events `offer_accepted` and `seat_filled`, where `seconds_since_cancel` = seconds since the latest `cancelled_at` on that seat.
- **`decline_offer(p_offer_id uuid) returns text`**
  - Pending → `declined`, and the entry becomes `withdrawn` (off tonight's waitlist).
  - Otherwise returns `not_pending` or `not_found`.
- **`expire_offers() returns table (offer_id uuid, group_id uuid, seat_no smallint)`**
  - Every pending offer with `expires_at <= now()` → `expired`, and its entry → `expired`.
  - Returns the affected rows, so M2's job can offer the seat to the next candidate.

- [ ] **Step 1: Write the failing pgTAP test.** Fixture:
  - a venue with `offer_ttl_seconds 900`, one table (capacity 4), one game {2, 4}, one session (`seat_price_cents 800`) and one group (capacity 4)
  - players p1–p6, with p1–p4 booked into seats 1–4
  - waitlist entries for p5 and p6

  Assertions, in order:
  1. `cancel_booking(b1)` returns seat 1, and repeating it adds no second `booking_cancelled` event.
  2. `create_offer` on seat 2 raises `seat_not_free`.
  3. `create_offer(seat 1, p5)` succeeds, and a second offer on seat 1 raises `offer_pending`.
  4. `accept_offer` → `'accepted'`. p5 has one `waitlist`-sourced booking at seat 1 for 800, the entry is `promoted`, and there is one `seat_filled` event with `seconds_since_cancel >= 0`.
  5. Repeating `accept_offer` → `'already_accepted'` and still exactly one p5 booking (Review Focus 3).
  6. Cancel b2, offer it to p6, then `update seat_offers set expires_at = now() - interval '1 second'`. `accept_offer` → `'expired'`, with no booking and the entry `expired` (Review Focus 3).
  7. A fresh offer followed by `decline_offer` → `'declined'` with the entry `withdrawn`, and then `accept_offer` → `'declined'`.
  8. `expire_offers()` returns only past-due pending offers.
  9. A live booking inserted directly into the offered seat makes `accept_offer` → `'seat_taken'`.
  10. A player with a live booking in the session gets `'already_booked'`.
  11. As `authenticated`, `select accept_offer(...)` throws `42501`.
- [ ] **Step 2: Write** `accept-offer-race.test.ts`, `it('serialises concurrent YES replies into exactly one booking')`:
  1. Open two `pg.Client`s to the local DB and seed the same fixture shape under a fresh venue in `beforeAll`.
  2. Client A runs `BEGIN; select accept_offer($1)` and expects `'accepted'`, keeping the transaction open.
  3. Client B starts `select accept_offer($1)` without awaiting it. After 200 ms, B's promise is still pending.
  4. A runs `COMMIT`.
  5. B resolves to `'already_accepted'`. The count of live bookings for that player/session is `1`.
  6. `afterAll` deletes the venue (cascade) and closes both clients.
- [ ] **Step 3: Run** `pnpm db:test && pnpm test:race`. Expected: FAIL (functions missing).
- [ ] **Step 4: Write the migration.**
- [ ] **Step 5: Run** `pnpm db:reset && pnpm db:test && pnpm test:race`. Expected: PASS (01–03 and the race test).
- [ ] **Step 6: Commit** `feat(db): transactional booking RPCs with offer race protection`.

### Task 12: M1 wrap-up check

- [ ] **Step 1: Run** `pnpm typecheck && pnpm test && pnpm --filter web build && pnpm db:reset && pnpm db:test && pnpm test:race`. Expected: every command exits 0.
- [ ] **Step 2: Record the benchmark** median from Task 4's output in `README.md` under "Numbers" (first case-study figure).
- [ ] **Step 3: Commit** `docs: record M1 engine benchmark`.
