# Stage B2 — Open Play, Matching and Waitlist Offers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Individuals can join scheduled open play.
- They request a seat.
- At the venue's cut-off (or on **Match now**) the engine forms fair groups. For team formats it splits each group into two balanced teams.
- Everyone is told where they stand.
- A cancelled seat is offered to the best-fitting person waiting, by a live notification and a one-click email link. Unanswered offers pass on automatically, and everything closes when the session starts.

**Architecture:**
- **SQL owns every state change.** That covers requests, applying a match, offers, cancellations and closing. The functions are `service_role`-only, run under the M1 lock order and write their notifications in the same transaction.
- **TypeScript owns the engine.** `lib/open-play/match.ts` is pure: requests → `formGroups` → `splitTeams` → a match plan. `lib/open-play/open-play.ts` loads data, calls the engine and the SQL, and generates offer tokens.
- **The 10-second tick gains three steps:** expire and refill offers, match due sessions, close started sessions. They run before the emails.

**Tech Stack:** as B1 (Next.js 16.4, Supabase local with pg_cron/pg_net/Vault, Vitest 5, pgTAP), plus `@bm/engine`'s `formGroups`, `rankWaitlist` and `splitTeams`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-stage-b-booking-matchmaking-design.md`, B2 parts:
- §1 (rules 1–2);
- §2.5;
- §3 B2;
- §4;
- §5 steps 1–3;
- §6 offer emails;
- §7 B2 screens;
- §8 B2;
- §9 B2 edge cases.

Notes: `memory.md`.

## Global Constraints

- **Branch** `stage-b2-open-play`, cut from `main`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Migrations are new files, hand-named after `20261021010100`** (the CLI's clock-stamped names sort too early; see memory.md §3). Apply them with `pnpm exec supabase migration up --local`, and prove from-scratch replay with `pnpm exec supabase db diff --local --schema public` → `No schema changes found`. Don't run `db:reset` casually.
- **The B1 rules carry over:**
  - RLS on every new table, with explicit grants and one policy per action.
  - No `security definer` in `public`; `search_path = ''` everywhere.
  - Booking-flow functions are `service_role` only and return status text.
  - Composite tenant FKs `(x_id, organization_id)`.
  - pgTAP fixtures never assume an empty DB: they use dates relative to `now()`, as in `11_resource_bookings` (`pg_temp.at`).
- **Lock order** (deadlock-free; extends M1): **session → offer → group → waitlist entry**. `accept_offer` takes no session lock.
- **Seat numbering and teams.**
  - A group's `capacity` is `2 × team_size` for `two_teams` activities, else `least(resource.capacity, activity.max_players)`.
  - In a team group, team 1 sits in seats `1…team_size` and team 2 in seats `team_size+1…2 × team_size`. A booking's `team` follows from its seat, so a refilled seat keeps its team.
- **A live session** is one with status `open` or `matched` and `starts_at > now()`. Offer, accept and request functions refuse anything else as `closed`. (The M1 offer tests run on `open` sessions a day ahead, so they stay valid.)
- **Offer tokens are minted by the email step, never stored** (spec §2.5, §6).
  - Tokens are `randomBytes(32).toString('base64url')`. `seat_offers.token_hash text not null unique` stores only the lower-case hex SHA-256.
  - `create_offer` keeps its M1 signature and sets the hash of a random value nobody knows.
  - When the tick emails an `offer` notification, it mints the real token, swaps its hash in with `issue_offer_token`, and puts `/offers/<token>` on the venue's subdomain in the email.
  - The notification row keeps `/me/offers/<id>`.
  - A retried email mints a fresh token, so only the newest email's link works.
  - Opening the link (GET) never accepts; **Take the seat** is a POST.
  - *Ruling vs spec §3:* `create_offer` takes no `token_hash`. If it did, the token would have to be stored until the tick sent the email, which §2.5 forbids.
- **Player cancel cut-off:** a player may cancel a seat only while `now < starts_at − cancel_cutoff_minutes`. Staff may cancel any time before the session starts.
- **Copy** lives in `messages/en.ts`. Notification payloads carry ids, times and venue data (names) only; the words come from `renderNotification`.
- **Domain modules take a `SupabaseClient`** and don't import `server-only`. Server actions check the caller first (`requireOrgRole` / `getPlayer`), then use the service client.
- **Email is only sent by the tick** (the outbox).

## Review Focus

1. **A request racing the match.** A player requests after `matchSession` has read the requests but before `apply_match` commits. They must end up seated or waitlisted, never lost. `apply_match` appends any unhandled request to the waitlist. Tested in Task 1.
2. **Requesting again after cancelling, withdrawing or declining.** The `waitlist_entries (session_id, profile_id)` and `seat_requests` unique keys must not cause a 500. The existing row is reused and goes to the back of the queue. Tested in Task 1.
3. **Anything on a cancelled, closed or started session:** request, withdraw, accept or decline an offer, cancel a seat, or Match now. Each gives a clear "closed" outcome and changes nothing. Tested in Tasks 1, 2 and 4.
4. **A player with no favourites in a "players choose" session.** They can be seated in any active activity, not stuck on the waitlist forever. Tested in Task 3.
5. **A freed seat nobody waiting can take** (empty waitlist, or no candidate wants that activity). The seat stays free, and the next late request takes it directly. Tested in Task 4.

---

### Task 1: SQL — requests and applying a match

**Files:**
- Create: migration `20261021020000_open_play_requests.sql`, `supabase/tests/database/12_open_play.test.sql`
- Modify: `supabase/tests/database/{01_schema,04_grants}.test.sql`

**Interfaces:**
- **Schema:**
  - `open_play_sessions.matched_at timestamptz`
  - `bookings.team smallint check (team in (1, 2))`
  - `alter type booking_source add value 'direct'`
  - `revoke insert, delete on seat_requests from authenticated`, and drop the `seat_requests_insert` / `seat_requests_delete` policies. The select policy stays.
- **`public.request_seat(p_session_id uuid, p_profile_id uuid) returns text`:** `requested`, `seated`, `waitlisted`, `already`, `closed` or `invalid`.
  1. Lock the session.
  2. `closed` when the status isn't `open`/`matched` or `starts_at <= now()`.
  3. `invalid` when the profile isn't in the session's organization.
  4. `already` when the player has a live booking, a seat request (pre-match), or a `waiting`/`offered` entry.
  5. **Before matching:** insert a `seat_requests` row (an existing row for this pair counts as `already`).
     - `priority = 1` if this profile's most recent earlier session at the venue with a seat request is `matched`/`closed` and has no booking for them. Otherwise 0.
     - Returns `requested`.
  6. **After matching:**
     - If no entry is `waiting`, take the lowest free seat (no live booking, no pending offer) in a group whose activity fits. "Fits" means the session's fixed activity, or one of the player's favourites, or any activity if they have none.
     - That writes a booking with `source 'direct'`, `team` from the seat, the session's seat price, and a `seat_confirmed` notification. Returns `seated`.
     - Otherwise insert or update a `waitlist_entries` row: status `waiting`, `queue_position = max + 1`, with a `waitlisted` notification. Returns `waitlisted`.
     - Re-using a withdrawn or expired row is the Review Focus 2 case.
- **`public.withdraw_request(p_session_id uuid, p_profile_id uuid) returns text`:** `withdrawn`, `has_offer`, `closed` or `not_found`.
  - **Before matching:** delete the request.
  - **After matching:** a `waiting` entry becomes `withdrawn`; an `offered` one returns `has_offer`, so the player answers the offer instead.
- **`public.apply_match(p_session_id uuid, p_groups jsonb, p_waitlist jsonb) returns text`:** `matched`, `already_matched`, `not_open` or `no_groups`.
  - `p_groups` is `[{"resource_id", "activity_id", "capacity", "seats": [{"profile_id", "seat_no", "team"}]}]`; `p_waitlist` is `["profile_id", …]` in queue order.
  - **Steps:**
    1. Lock the session. `matched` → `already_matched`; any other non-`open` status → `not_open`; an empty `p_groups` → `no_groups`, writing nothing.
    2. Validate: resources belong to the session, activities to the organization, every profile has a request, nobody is listed twice, and seats are in range. A violation raises `invalid_match`.
    3. Insert the groups.
    4. Insert bookings (`source 'matched'`, `team`, the seat price).
    5. Insert waitlist entries in order with `priority` copied from the request, then **append every request not mentioned anywhere** (Review Focus 1).
    6. Set `status 'matched'` and `matched_at = now()`.
    7. Notify: `seat_confirmed` for each seat and `waitlisted` for each entry.
  - **`seat_confirmed` payload:** `{ session_id, activity_name, resource_name, branch_name, multi_branch, starts_at, ends_at, team, price_poisha, via }`, with `via` one of `matched`, `direct` or `offer`, and link `/sessions/<id>`.
  - **`waitlisted` payload:** `{ session_id, activity_name, starts_at, position }`, link `/sessions/<id>`.

- [ ] **Step 1: Write the failing tests** (`12_open_play.test.sql`).
  - **Fixtures:** org `op-org-p`, a session 2 days ahead (relative) with Pitch 1 + Pitch 2 and fixed activity 5-a-side (`two_teams`, 5); 13 profiles with requests; a second, players-choose session for the favourites cases.
  - **request_seat:**
    - `requested`; then `already`;
    - `invalid` for another org's profile;
    - `closed` for a cancelled session and for one whose `starts_at` is past.
  - **The repeat-request priority rule:** a profile who requested a past matched session but has no booking there gets `priority = 1`.
  - **apply_match:**
    - with one group of 10 (seats 1–5 team 1, 6–10 team 2) and a waitlist of 2 → `matched`;
    - 10 bookings exist with teams 1/2 by seat;
    - 2 entries exist with positions 1–2;
    - status `matched`;
    - 10 `seat_confirmed` and 2 `waitlisted` notifications;
    - **Review Focus 1:** the 13th requester, left out of both arrays, is appended as position 3 with a notification;
    - a second call → `already_matched`;
    - an empty groups array on another session → `no_groups`, with nothing written and the status still `open`;
    - a profile without a request → raises `invalid_match`.
  - **After matching:**
    - with entries waiting, `request_seat` for a new profile → `waitlisted` at the back;
    - after every waiting entry is withdrawn and a seat is freed (cancel a booking directly), `request_seat` → `seated` with `source 'direct'` and the vacated team;
    - `withdraw_request` on a waiting entry → `withdrawn`, and requesting again → `waitlisted` (row reused, Review Focus 2).
  - **Grants:** `authenticated` cannot insert into `seat_requests` (42501) or execute the three functions.
  - **`01`/`04`:** the new columns, the enum value, and the revoked grants.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: 12 fails because the functions don't exist.
- [ ] **Step 3: Implement the migration**; apply with `migration up`.
- [ ] **Step 4: Run** `pnpm db:test && pnpm db:lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): open-play requests and atomic match application`.

### Task 2: SQL — offers, cancellations, closing

**Files:**
- Create: migration `20261021020100_open_play_offers.sql`, `supabase/tests/database/13_offers.test.sql`
- Modify: `supabase/tests/database/{01_schema,04_grants}.test.sql`. `03_booking_rpcs` and the race test must pass **unchanged**.

**Interfaces:**
- **Schema:**
  - `seat_offers.token_hash text not null unique`. Backfill any existing rows with `encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex')`, then set `not null`. pgcrypto lives in `extensions`; the local DB has 0 offers today.
- **`create_offer(p_group_id, p_seat_no, p_waitlist_entry_id)`:** same signature, replaced.
  - Keeps the M1 checks.
  - Raises `session_closed` unless the session is live.
  - `token_hash` = the hash of 32 random bytes nobody keeps.
  - `expires_at = least(now() + ttl, starts_at)`.
  - Writes an `offer` notification: payload `{ offer_id, session_id, activity_name, resource_name, branch_name, multi_branch, starts_at, ends_at, team, price_poisha, expires_at }`, link `/me/offers/<offer_id>`.
- **`public.issue_offer_token(p_offer_id uuid, p_token_hash text) returns text`:** `issued` | `not_pending`. Locks the offer and replaces its hash only while it's `pending` and unexpired. Service role only.
- **`accept_offer(p_offer_id)` (same signature, replaced):**
  - Returns `closed`, marking the offer `expired` and the entry `expired`, when the session isn't live.
  - The booking gets `team` from the seat.
  - Writes `seat_confirmed` (`via 'offer'`).
  - All other M1 outcomes are unchanged.
- **`decline_offer`:** unchanged outcomes; additionally returns `closed` for a closed session.
- **`expire_offers()`:** same signature and return; also writes an `offer_expired` notification (`{ session_id, activity_name, starts_at }`, link `/sessions/<id>`) for each player.
- **Replace `cancel_booking(p_booking_id)`** with **`cancel_booking(p_booking_id uuid, p_by_venue boolean default false) returns table (group_id uuid, seat_no smallint, session_id uuid)`**. Drop the one-argument version and re-grant, so existing one-argument calls resolve to the new function.
  - M1 behaviour stays.
  - Writes `seat_cancelled` (`{ session_id, activity_name, starts_at, by_venue }`, link `/me/bookings`).
  - Returns no row when the session is closed or cancelled. Nothing changes in that case.
- **`public.close_started_sessions() returns setof uuid`:** for `open`/`matched` sessions with `starts_at <= now()`:
  - set `closed`;
  - expire pending offers;
  - set `waiting`/`offered` entries to `expired`, with `no_seat` (`reason 'waitlist'`);
  - for sessions that never matched, set `no_seat` (`reason 'not_enough_players'`) for every requester;
  - return the ids.

  `no_seat` payload: `{ session_id, activity_name, starts_at, reason }`, link `/`.
- **Replace `cancel_open_play_session(p_session_id)`:** same signature; `open` **or** `matched` → `cancelled`.
  - Cancels live bookings and expires pending offers.
  - Withdraws waiting entries.
  - Deletes the reservations.
  - Writes `session_cancelled` (`{ session_id, activity_name, starts_at }`, link `/`) once per affected player: booked, waiting or requested.
  - Returns `not_open` for `closed`/`cancelled`, `not_found` otherwise.

- [ ] **Step 1: Write the failing tests** (`13_offers.test.sql`, relative dates).
  - **create_offer:**
    - writes a 64-char hex `token_hash` and an `offer` notification linked `/me/offers/<id>`, whose payload carries `offer_id`;
    - expiry is `least(ttl, start)`; a session starting in 5 minutes with a 15-minute TTL expires at the start;
    - on a closed session → raises `session_closed`.
  - **issue_offer_token:**
    - on a pending offer → `issued`, and `token_hash` equals the given hash;
    - after the offer is declined → `not_pending`, hash unchanged.
  - **accept_offer:**
    - → `accepted`; the booking's `team` is the seat's team, with a `seat_confirmed` (`via 'offer'`) notification;
    - on a session cancelled after the offer → `closed`, with no booking (Review Focus 3).
  - **expire_offers:** a past-due offer → returns the seat, and the player gets `offer_expired`.
  - **cancel_booking:** `(…, true)` → `seat_cancelled` with `by_venue` true; on a closed session → no row and no change.
  - **close_started_sessions:**
    - a matched session whose start passed → `closed`; its waiting player gets `no_seat`/`waitlist`;
    - an `open` session with requests → `closed`; requesters get `no_seat`/`not_enough_players`.
  - **cancel_open_play_session:** on a matched session → `cancelled`, every booking cancelled, the pending offer expired, everyone notified `session_cancelled` once.
  - **Grants:** `authenticated` cannot execute `issue_offer_token` or `close_started_sessions`.
- [ ] **Step 2: Run** `pnpm db:test && pnpm test:race`. Expected: 13 fails.
- [ ] **Step 3: Implement the migration.**
- [ ] **Step 4: Run** `pnpm db:test && pnpm db:lint && pnpm test:race`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): offers with tokens, session-aware accepts, closing and cancelling sessions`.

### Task 3: The match plan (pure TypeScript)

**Files:**
- Create: `apps/web/lib/open-play/match.ts`, `apps/web/test/open-play-match.test.ts`

**Interfaces:**
- `interface MatchRequest { profileId: string; skill: number; favourites: string[]; priority: number; requestedAt: number }`
- `interface MatchActivity { id: string; minPlayers: number; maxPlayers: number; teamMode: 'none' | 'two_teams'; teamSize: number | null }`
- `interface MatchResource { id: string; capacity: number }`
- `interface MatchPlan { groups: Array<{ resourceId: string; activityId: string; capacity: number; seats: Array<{ profileId: string; seatNo: number; team: 1 | 2 | null }> }>; waitlist: string[] }`
- **`planMatch(input: { sessionId: string; fixedActivityId: string | null; activities: MatchActivity[]; resources: MatchResource[]; requests: MatchRequest[] }): MatchPlan`:**
  1. Engine games are `{ id, minPlayers, maxPlayers }`, with min = max = `2 × teamSize` for two-team activities.
  2. Player favourites:
     - `[fixedActivityId]` when the activity is fixed;
     - otherwise their own list, or **every activity id** when empty (Review Focus 4).
  3. `seed = seedFromId(sessionId)`.
  4. Run `formGroups`.
  5. Each group gets a capacity per the Global Constraint.
  6. Seats: for two-team groups, `splitTeams` (team 0 → seats 1…n, team 1 → n+1…2n, each team in its returned id order); otherwise in `playerIds` order.
  7. The waitlist is `formGroups`' waitlist.
- **`seedFromId(id: string): number`:** FNV-1a 32-bit over the string (deterministic).

- [ ] **Step 1: Write the failing tests:**
  - **12 requests for 5-a-side** (skills 1–5 spread) on two pitches of capacity 14:
    - one group of capacity 10, with seats 1–10;
    - teams 5 v 5, and the skill-total gap equals `splitTeams`' optimum for those 10 players;
    - 2 on the waitlist, and every profile appears exactly once.
  - **24 requests** → 2 groups (one per pitch) and an empty waitlist.
  - **7 requests** → no groups; all 7 waitlisted (the caller treats that as `no_groups`).
  - **A pitch with capacity 8 for 5-a-side** → no groups.
  - **Players-choose café session** (Catan 3–4, Azul 2–4; tables 4/4): players are seated only in their favourites' games. A player with **no favourites** is seated (Review Focus 4).
  - **Same input twice** → an identical plan (deterministic).
  - **`seedFromId('a') !== seedFromId('b')`.**
- [ ] **Step 2: Run** `pnpm --filter web test -- open-play-match`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter web test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): match plan from requests (formGroups + splitTeams)`.

### Task 4: Open-play server logic

**Files:**
- Create: `apps/web/lib/open-play/open-play.ts`, `apps/web/test/integration/open-play.test.ts`

**Interfaces** (all take `db: SupabaseClient`, the service client; ids are checked against the organization, and malformed ids → `not_found`/`null`):
- `requestSeat(db, { organizationId, sessionId, profileId }): Promise<'requested' | 'seated' | 'waitlisted' | 'already' | 'closed' | 'not_found'>`
- `withdrawRequest(db, { organizationId, sessionId, profileId }): Promise<'withdrawn' | 'has_offer' | 'closed' | 'not_found'>`
- **`matchSession(db, { organizationId, sessionId }): Promise<'matched' | 'already_matched' | 'not_open' | 'no_groups' | 'not_found'>`:**
  1. Load requests with profile skill, ranked favourites, priority and `created_at`; the session's resources with capacity; and the activities (the fixed one, or the venue's active ones).
  2. Run `planMatch`.
  3. With no groups, return `no_groups` without calling SQL. Otherwise call `apply_match`.
- **`offerNext(db, { groupId, seatNo }): Promise<'offered' | 'no_candidate' | 'seat_not_free' | 'closed'>`:**
  1. Candidates are the session's `waiting` entries as `WaitlistCandidate`: skill, favourites (fixed activity → `[activityId]`, empty → all), priority, `requestedAt = created_at`, `available: true`.
  2. The seat is `{ gameId: group.activity_id, tableSkills: skills of the group's live bookings }`.
  3. Run `rankWaitlist`. If anyone is ranked, call `create_offer(group, seat, entry)` and return `offered`. If no one: `no_candidate` (Review Focus 5).
  4. Map the SQL exceptions `seat_not_free`/`offer_pending` → `seat_not_free`, and `session_closed` → `closed`.
- **`cancelSeat(db, { organizationId, bookingId, actor: { kind: 'player'; profileId: string } | { kind: 'staff' }, now? }): Promise<'cancelled' | 'too_late' | 'closed' | 'not_found' | 'not_cancellable'>`:**
  - A player cancels only their own booking, and only before the cut-off.
  - `cancel_booking(id, actor is staff)`; then `offerNext` for the freed seat.
- **`respondToOffer(db, { offerId, response: 'accept' | 'decline' }): Promise<AcceptOutcome | 'declined' | 'not_pending' | 'closed' | 'not_found'>`**, where `AcceptOutcome` is the `accept_offer` text.
  - After `declined` or `already_booked`, it calls `offerNext` for that seat.
- **`issueOfferToken(db, offerId: string): Promise<string | null>`:** mints a token, calls `issue_offer_token(offerId, sha256hex(token))`, and returns the token (`null` on `not_pending`). Used by the email step (Task 5) and by tests.
- **`findOffer(db, by: { token: string } | { offerId: string; profileId: string; organizationId: string }): Promise<OfferView | null>`:**
  - `OfferView = { id; organizationSlug; status; expiresAt; seatNo; team; session: { id; startsAt; endsAt; activityName; resourceName; pricePoisha } }`.
  - By token it matches on the hash; by id it requires the profile's own offer.
  - The `/offers/[token]` page also checks `organizationSlug` against the subdomain.
- **`seatsLeft(db, { organizationId, sessionIds }): Promise<Map<string, number>>`:**
  - Before matching: Σ over the session's resources of the seats it could host, minus requests. For a fixed activity that's the group capacity, or 0 if the resource is too small for a two-team game; for players-choose it's `resource.capacity`.
  - After matching: Σ group capacity − live bookings − pending offers.
  - Never below 0.
- **`playerSessionView(db, { organizationId, sessionId, profileId: string | null })`:** returns `{ session; seatsLeft; me: { state: 'none' | 'requested' | 'seated' | 'waitlisted' | 'offered'; position?; offerId?; bookingId?; team?; cancellable? } | null; group: { resourceName; activityName; teams: Array<{ team: 1 | 2 | null; names: string[] }> } | null } | null`.
  - `group` is filled only for a seated player.
  - Display names only.
- **`staffSessionView(db, { organizationId, sessionId })`:** returns the session, requests (name, skill), groups (with team skill totals and names), the waitlist (position, name, status), pending offers (name, expires) and `notEnoughPlayers` (open and past its cut-off), or `null`.
- **`listMySeats(db, { organizationId, profileId, now? })`:** `{ upcoming, past }`, with rows `{ bookingId; sessionId; activityName; startsAt; team; pricePoisha; status; cancellable }`.

- [ ] **Step 1: Write the failing tests** (fresh org, with a 5-a-side session 2 days ahead on two pitches and 12 player profiles):
  1. **Requests:** 12 requests → `requested` each; a duplicate → `already`.
  2. **Matching:**
     - `matchSession` → `matched`;
     - `playerSessionView` for a seated player shows team 1 or 2 and 10 display names split 5/5, with no phones anywhere in the view;
     - a waitlisted player shows `waitlisted` with position 1 or 2;
     - a second `matchSession` → `already_matched`.
  3. **Too few players:** a second session with 7 requests → `no_groups`, and the status stays `open`.
  4. **Refill:**
     - a seated player cancels 3 days early → `cancelled`;
     - waitlist #1 gets an `offer` notification linked `/me/offers/<id>`;
     - `issueOfferToken` returns a token, and `findOffer({ token })` finds that offer;
     - a second `issueOfferToken` makes the first token stop working;
     - `respondToOffer(accept)` → `accepted`, with the same team as the cancelled seat.
  5. **Declining:** another cancel, then `decline` → `declined`, and the seat is offered to #2.
  6. **Privacy:** a waitlisted player's view has `group: null`, and no view contains a phone number.
  7. **Forwarded link:** a token used by anyone (no profile check) books the **offered** player.
  8. **No candidate (Review Focus 5):** cancel with an empty waitlist → the seat stays free (`no_candidate`); a new `requestSeat` → `seated`.
  9. **Cut-off:** a player cancels 1 h before the start → `too_late`; staff → `cancelled`.
  10. **Closed sessions (Review Focus 3):** after staff cancel the session, `requestSeat` → `closed`, `respondToOffer` on an open offer → `closed`, and `matchSession` → `not_open`.
  11. **Re-request (Review Focus 2):** withdraw then request again → `waitlisted`, not an error.
  12. **Seats left** on the two-pitch 5-a-side session: 20 before any request, 8 after 12 requests, 0 after matching, and 1 after a cancel with no candidate.
  13. **Malformed ids and tokens** → `not_found`/`null`.
- [ ] **Step 2: Run** `pnpm test:integration -- open-play`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): open-play requests, matching, cancellations and offers`.

### Task 5: Words for the open-play notifications and email links

**Files:**
- Modify: `apps/web/lib/notifications/render.ts`, `apps/web/lib/notifications/deliver.ts` (consumes `issueOfferToken` from Task 4), `apps/web/messages/en.ts`, `apps/web/test/notifications-render.test.ts`, `apps/web/test/integration/deliver.test.ts`

**Interfaces:**
- **`renderNotification`** for the B2 kinds (Asia/Dhaka, a session Fri 23 Oct 8–9pm, 5-a-side futsal, Pitch 1):

  | Kind | Title | Body |
  |---|---|---|
  | `seat_confirmed` | "You're in!" | "5-a-side futsal, Fri 23 Oct, 8pm–9pm. Pitch 1, Team 1. Pay ৳300 at the venue." (no ", Team n" when `team` is null; the branch rule from B1 applies to "Pitch 1") |
  | `waitlisted` | "You're on the waitlist" | "5-a-side futsal, Fri 23 Oct, 8pm. You're #2 — we'll offer you a seat if one opens." |
  | `offer` | "A seat is free — want it?" | "5-a-side futsal, Fri 23 Oct, 8pm–9pm. Pitch 1, Team 2. The offer ends at 7:15pm." |
  | `offer_expired` | "Your seat offer expired" | "5-a-side futsal, Fri 23 Oct, 8pm. We offered the seat to the next player." |
  | `seat_cancelled` | "The venue cancelled your seat" (`by_venue`) or "Seat cancelled" | "5-a-side futsal, Fri 23 Oct, 8pm." |
  | `session_cancelled` | "Session cancelled" | "5-a-side futsal, Fri 23 Oct, 8pm was cancelled by the venue." |
  | `no_seat` | "No seat this time" (`reason 'waitlist'`) or "The match didn't fill" (`'not_enough_players'`) | "5-a-side futsal, Fri 23 Oct, 8pm." |

  A null `activity_name` renders as "Open play".
- **`deliverPendingEmails`**, for an `offer` row, after the address and venue are known: `issueOfferToken(db, payload.offer_id)` (Task 4).
  - `null` → finish the row as `skipped`, because the offer is no longer pending.
  - Otherwise the email's button links to `/offers/<token>` instead of `row.link`.
  - The token is never logged or stored.

- [ ] **Step 1: Write the failing tests:**
  - the exact strings above;
  - **`deliver` integration case 1:** a pending offer's notification → the email html contains `http://<slug>.localhost:3000/offers/<43-char token>`, and not `/me/offers`. The token's SHA-256 equals `seat_offers.token_hash`, and no `notifications` column contains the token.
  - **`deliver` integration case 2:** the offer's notification after the offer was declined → the row is `skipped` and nothing is sent.
- [ ] **Step 2: Run** `pnpm --filter web test -- notifications-render && pnpm test:integration -- deliver`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): open-play notification copy and offer emails with one-time links`.

### Task 6: Tick steps

**Files:**
- Modify: `apps/web/lib/jobs/tick.ts`, `apps/web/app/api/jobs/tick/route.ts`, `apps/web/test/integration/tick.test.ts`

**Interfaces:**
- **`runTick(deps: { db: SupabaseClient; createSender: () => EmailSender; now?: Date }): Promise<TickReport>`.** The B1 deferred minor: the sender is created **inside** the email step, so missing `EMAIL_*` variables fail only that step.
- **`TickReport = { offers: { expired: number; offered: number }; matched: string[]; closed: number; emails: { sent; skipped; failed } | { error: string } }`.**
- **Steps, in order, each in its own `try`** (one failing step doesn't stop the others; errors are logged):
  1. `expire_offers()`, then `offerNext` per freed seat (max 50).
  2. Match due sessions: `open`, `starts_at > now`, and `starts_at − match_cutoff_minutes <= now` (max 10 per tick); `matched` collects their ids.
  3. `close_started_sessions()`.
  4. Emails.
- **The route** passes `createSender: () => createEmailSender(process.env)`.

- [ ] **Step 1: Write the failing tests** (`tick.test.ts`, recording sender):
  - **Matching:** a session inside its cut-off with 10 requests is matched by one `runTick`, and its players' `seat_confirmed` emails go out the same tick.
  - **Expiry:** a past-due offer is expired and the seat offered to the next waiting player within the same tick.
  - **Closing:** a session whose start passed is closed.
  - **Email failure is contained:** with `createSender` throwing, the report's `emails` is `{ error }` while matching still ran.
- [ ] **Step 2: Run** `pnpm test:integration -- tick`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test:integration && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): tick matches, refills offers and closes sessions`.

### Task 7: Player screens

**Files:**
- Create:
  - `apps/web/app/t/[slug]/sessions/[id]/{page.tsx,actions.ts}`
  - `apps/web/app/t/[slug]/offers/[token]/{page.tsx,actions.ts}`
  - `apps/web/app/t/[slug]/me/offers/[id]/{page.tsx,actions.ts}`
  - `apps/web/components/open-play/offer-card.tsx`
- Modify: `apps/web/app/t/[slug]/page.tsx`, `apps/web/app/t/[slug]/me/bookings/{page.tsx,actions.ts}`, `messages/en.ts`

**Interfaces:**
- **Public page:** each session row links to `/sessions/<id>` and shows `seatsLeft` ("4 seats left" / "Full — join the waitlist").
- **`/sessions/[id]`:** details; seats left; and for the signed-in player with a profile, `playerSessionView` drives the action:
  - **none:** **Request a seat**. Signed out → **Sign in to join**; no profile → a link to `/me`.
  - **requested:** "You've asked for a seat. We'll match players …" plus **Withdraw**.
  - **waitlisted:** "You're #n on the waitlist" plus **Withdraw**.
  - **offered:** a link to `/me/offers/<id>`.
  - **seated:** table/team and both teams' display names, plus **Cancel my seat** while `cancellable`, else "Contact the venue to cancel".
  - Actions: `requestSeatAction`, `withdrawAction`, `cancelSeatAction`.
- **`/offers/[token]`** (no sign-in) and **`/me/offers/[id]`** (signed in; own offer only) render **`OfferCard`**:
  - session, space, team, price and a countdown to `expiresAt` (minutes);
  - **Take the seat** / **No thanks** as POST forms → `respondToOffer`;
  - a non-pending, expired or unknown offer → "This offer is no longer available."
- **`/me/bookings`** gains a **Seats** section from `listMySeats`, with **Cancel** via `cancelSeatAction`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `pnpm --filter web lint && pnpm typecheck && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 3: Browser check:**
  1. A player opens a session from the public page and requests; the page shows "asked for a seat".
  2. After **Match now** (Task 8) the page shows their team and the 10 names.
  3. A cancel by another player produces an offer email in Mailpit. Opening `/offers/<token>` shows the card and does **not** accept. **Take the seat** books it, and a second click says "no longer available".
  4. `/offers/garbage` shows the friendly page.
- [ ] **Step 4: Commit** `feat(web): open-play pages and seat offers`.

### Task 8: Staff session view

**Files:**
- Create: `apps/web/app/(root)/manage/[slug]/sessions/[id]/{page.tsx,actions.ts}`
- Modify: `apps/web/app/(root)/manage/[slug]/schedule/page.tsx` (each row links to its session page), `messages/en.ts`

**Interfaces:**
- **Page** (staff or above), from `staffSessionView`:
  - requests (name, skill) with **Match now** while `open`;
  - "Not enough players yet (7 of 10)" when `notEnoughPlayers`;
  - groups with resource, activity, and for each team the names, skills and skill total;
  - the waitlist with positions;
  - pending offers with the expiry time;
  - per-booking **Cancel seat** (staff);
  - **Cancel session**.
- **Actions:** `matchNowAction(slug, sessionId)`, `staffCancelSeatAction(slug, bookingId)`, `cancelSessionAction(slug, sessionId)`. The last reuses the existing cancel, now notifying.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `pnpm --filter web lint && pnpm typecheck && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 3: Browser check:**
  - with 12 requests, **Match now** shows two teams with near-equal skill totals and 2 waitlisted;
  - staff **Cancel seat** creates an offer to #1;
  - a 7-request session shows "Not enough players yet".
- [ ] **Step 4: Commit** `feat(web): staff session view with match now`.

### Task 9: B2 wrap-up

- [ ] **Step 1: Run** `pnpm typecheck && pnpm test && pnpm --filter web lint && pnpm --filter web build && pnpm db:test && pnpm db:lint && pnpm test:race && pnpm test:integration`, then the `db diff` check. Expected: all exit 0, and `No schema changes found`.
- [ ] **Step 2: Browser journey** (spec §1 Done-when, items 2–4), with the dev server on a clean `.next`:
  1. **Matching:** twelve players request a 5-a-side; at the cut-off or on Match now, ten get two balanced teams and two are waitlisted; everyone gets the bell and a Mailpit email.
  2. **Refill:** a seated player cancels; #1 gets the email, clicks **Take the seat** and lands on the vacated team. If they ignore it, after the TTL the offer passes to #2.
  3. **Closing:** when the session starts, everything closes and the player left waiting is told "no seat this time".

  Set the TTL low (60 s) and the start near (via SQL on the test session) to observe items 2 and 3 in minutes. Record that in the ledger.
- [ ] **Step 3: Docs.** README: open play, Match now, offers, test counts. memory.md: B2 decisions (token storage, seat numbering, lock order), gotchas, change log.
- [ ] **Step 4: Commit** `docs: Stage B2 notes`.
