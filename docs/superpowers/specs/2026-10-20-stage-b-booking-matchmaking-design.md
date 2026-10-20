# Stage B — Booking & Matchmaking: Design

**Status:** Draft for review (2026-10-20).
**Parent spec:** `2026-10-20-booking-platform-design.md` (§8 Stage B). Where this document is more specific, it wins.
**Builds on:** Stage A (merged): tenancy, venues, spaces, activities, open-play schedule, player profiles, composite tenant foreign keys. M1 seat/offer RPCs and the engine (`formGroups`, `rankWaitlist`, `splitTeams`).

## 1. Goal and decisions

**Goal:** players can actually book at a venue.
- Teams and groups book a **whole space** (a pitch, a table, a PC zone) for a time slot.
- Individuals **request a seat** in a scheduled open-play session. The engine forms fair groups or two balanced teams.
- Cancelled seats are **refilled from the waitlist** through offers sent in-app and by email.

Payment stays "pay at venue" until Stage C. There is no SMS.

**Decisions made with the user (2026-10-20):**

| Topic | Decision |
|---|---|
| Walk-ins | Owners and staff can book a space for anyone with a **name + phone**; players with accounts book themselves online |
| Booking time | **Venue-set slots**: each space has a slot length; slots run on a grid from opening time; a player books 1–4 back-to-back slots |
| Matching | **Automatic at a cut-off** before start, plus a **Match now** button for staff |
| Cancelling | Players cancel online until a **venue-set cut-off**; after it, they contact the venue (staff can always cancel) |
| Timed work | **`pg_cron` → `pg_net` → a secret-protected Next.js route**, every 10 seconds. The engine stays in TypeScript; seat changes go through atomic SQL functions |
| Build order | **B1** (history protection, notifications/email/jobs, whole-space bookings) and **B2** (open play, matching, waitlist offers), each planned, reviewed and merged on its own |

**Two rules settled while writing this spec** (the user can change them):
1. **Default cut-offs: matching 6 hours before start, cancelling 2 hours before.** If both were 3 hours, nobody could cancel online after matching, and the waitlist would never be used. The database requires the matching cut-off to be later than the cancel cut-off.
2. **Not enough players yet.** If a session doesn't have enough requests to form any group at its cut-off, it **stays open**. Matching retries on every tick until the session starts. Staff see "not enough players yet", and players keep requesting. If it never fills, everyone is told "the match didn't fill" when it closes.

## 2. Data model (new migrations only)

### 2.1 Protect booking history (B1, first migration)
These references change from `on delete cascade` to **`on delete no action`**, so deleting one row with history behind it is refused:
- `groups` → session, resource, activity;
- `bookings` → session, group, profile;
- `waitlist_entries` → session, profile;
- `seat_offers` → group, waitlist entry;
- `events` → session.

`no action` is checked at the end of the statement, so deleting a whole organization still cascades cleanly. Keep the Stage A rule: references between tenant tables are composite `(x_id, organization_id)`, with an index leading on `x_id`.

The admin UI already turns 23503 into a friendly message for activities. Do the same for resources ("has bookings — deactivate it instead"), and for branches as well.

### 2.2 Venue booking settings (B1), columns on `organizations`

| Column | Type / default | Check |
|---|---|---|
| `booking_horizon_days` | `smallint` 14 | 1–90 |
| `cancel_cutoff_minutes` | `int` 120 | 0–10080 |
| `match_cutoff_minutes` | `int` 360 | 0–10080, and `> cancel_cutoff_minutes` |
| `max_upcoming_bookings` | `smallint` 3 | 1–20 |

Owners edit these in Settings. Add them to the owner's column-level update grant.

### 2.3 Slot length (B1)
- `resources.slot_minutes smallint not null default 60`, with `check (slot_minutes between 15 and 240 and slot_minutes % 15 = 0)`.
- Presets: pitch, court, zone and pod 60; table 120. The migration sets existing tables to 120.
- The manage Resources form edits it.

### 2.4 `resource_bookings` (B1)

| Column | Notes |
|---|---|
| `id`, `organization_id` | |
| `resource_id` | composite FK, `no action` |
| `profile_id` | nullable; composite FK, `no action` |
| `guest_name`, `guest_phone` | nullable text; phone normalised like profiles (`+880…`) |
| `period` | `tstzrange`, `[)` |
| `price_poisha` | `int ≥ 0`. A snapshot: `round(price_per_hour_poisha × minutes / 60)` to the nearest poisha, or 0 when the space has no price ("price at venue") |
| `status` | `resource_booking_status`: `confirmed`, `cancelled`, `attended`, `no_show` |
| `created_by`, `cancelled_by` | `uuid` → `auth.users`, `on delete set null` |
| `created_at`, `cancelled_at` | |

- **Check:** `(profile_id is not null) <> (guest_name is not null and guest_phone is not null)`. Exactly one of a player or a walk-in.
- A confirmed booking owns one `resource_reservations` row (`source = 'booking'`, `source_id = id`). The existing exclusion constraint therefore refuses any overlap with another booking or with an open-play session. Cancelling deletes that row.
- **RLS:** a player selects their own rows; members select their venue's rows. There are **no direct writes** (no insert/update/delete grants); every write goes through §3 functions.

### 2.5 Open play (B2)
- `open_play_sessions.matched_at timestamptz`. Lifecycle: `open → matched → closed`, or `→ cancelled` from `open` or `matched`.
- `bookings.team smallint check (team in (1, 2))`: null for free-for-all activities.
- `booking_source` gains `direct` (a late request that took a free seat).
- `seat_offers.token_hash text not null unique`: SHA-256 of a 32-byte random token. The token itself is never stored.
- `seat_requests`: **revoke player `insert` and `delete`.** Requests and withdrawals go through server actions (§3) so their rules can't be bypassed.

### 2.6 `notifications` (B1; replaces M1's `messages`)
Drop `messages` and `message_direction`. The `06_tenant_refs` test that used `messages` moves to `notifications`.

| Column | Notes |
|---|---|
| `id`, `organization_id`, `profile_id` | composite FK to the profile, `on delete cascade`. Walk-ins get no notifications |
| `kind` | `notification_kind`. B1: `booking_confirmed`, `booking_cancelled`. B2: `seat_confirmed`, `waitlisted`, `offer`, `offer_expired`, `seat_cancelled`, `session_cancelled`, `no_seat` |
| `payload` | `jsonb`: ids and times only. The app renders the text from the messages file, so a Bangla file can come later |
| `link` | path on the venue site, e.g. `/me/bookings` |
| `read_at` | |
| `email_status` | `email_status`: `pending`, `sending`, `sent`, `failed`, `skipped` |
| `email_attempts`, `email_claimed_at`, `emailed_at`, `created_at` | |

- Indexes: `(profile_id, created_at desc)`, and a partial index on `email_status = 'pending'`.
- **RLS:** the player selects their own rows and may update **only `read_at`** (column grant). No insert.
- Added to the `supabase_realtime` publication.
- **Notifications are written inside the same SQL function as the state change** (the outbox), so a booking can't exist without its notification.

## 3. Database functions (all `service_role` only; server actions check the caller first)

Statuses are returned as text, as in M1. The plan fixes exact signatures.

**Split between TypeScript and SQL:**
- **TypeScript** (the server action, using the slot-grid module) checks the rules that need the venue's clock and calendar: opening hours, grid alignment, the booking horizon, the player's cancel cut-off, and that the venue is live.
- **SQL functions** do everything that must hold under concurrency: overlaps, the booking limit, seat and offer state.
- Staff actions skip the horizon, the limit and the cancel cut-off, but never opening hours or overlaps.

**B1**
- `book_resource(resource, starts_at, slots, profile | guest name + phone, created_by)` → `booked` (with id), `taken`, `limit_reached` or `invalid`.
  - `slots` is 1–4.
  - For a player booking, it locks the profile row, then counts that player's confirmed bookings that haven't ended. At `max_upcoming_bookings` it returns `limit_reached`, so two tabs can't beat the limit.
  - It writes the booking, the reservation and a `booking_confirmed` notification (players only).
  - An exclusion violation returns `taken`.
- `cancel_resource_booking(id, by)` → `cancelled`, `not_cancellable` (not confirmed) or `not_found`. It deletes the reservation and notifies the player.
- `set_resource_booking_status(id, 'attended' | 'no_show')`.
- `claim_pending_emails(limit)` → rows. Uses `for update skip locked`; sets `sending`, increments attempts and stamps `email_claimed_at`. Rows stuck in `sending` for more than 5 minutes are claimable again.
- `finish_email(id, 'sent' | 'failed' | 'skipped')`. `failed` is final after 3 attempts; before that the row goes back to `pending`.

**B2**
- `request_seat(session, profile)` → `requested`, `seated`, `waitlisted`, `already` or `closed`.
  - **Before matching:** inserts a `seat_request`. Priority is 1 if the player's previous open-play request at this venue ended on the waitlist without a seat.
  - **After matching:** takes a free seat directly (`direct`) only if nobody is `waiting` and the activity fits (fixed activity, or among the player's favourites). Otherwise it appends to the waitlist.
- `withdraw_request(session, profile)` → `withdrawn` or `not_found`. Before matching it deletes the request; after matching, a waiting entry becomes `withdrawn`. A seated player uses `cancel_booking` instead.
- `apply_match(session, groups jsonb, waitlist jsonb)` → `matched`, `already_matched`, `not_open` or `no_groups`.
  - It locks the session and writes groups, bookings (with `team`) and waitlist entries in queue order. It sets `matched` and `matched_at`, and writes `seat_confirmed` and `waitlisted` notifications.
  - `no_groups` writes nothing and leaves the session open (§1 rule 2).
- `create_offer(group, seat, entry, token_hash)`: the M1 function plus the hash. Sets `expires_at = least(now() + branch ttl, session starts_at)` and writes an `offer` notification.
- `accept_offer`, `decline_offer`, `expire_offers`, `cancel_booking`: the M1 behaviour and lock order (offer → group → waitlist entry). They add notifications (`seat_confirmed`, `offer_expired`, `seat_cancelled`). A booking created from an offer takes the vacated seat's `team`.
- `close_started_sessions()` → session ids. Sets `closed`, expires pending offers, marks remaining `waiting` entries `expired`, and notifies them `no_seat`. Sessions that never matched also notify their requesters `no_seat`.
- `cancel_open_play_session`: extended to cancel live bookings, expire pending offers, withdraw waiting entries and notify everyone `session_cancelled`.

## 4. Matching (B2, TypeScript: `lib/open-play/`)

- **Input from the database:**
  - requests, joined to profiles: skill, favourites in rank order, priority, `created_at`;
  - the session's resources (the tables);
  - the activities (the games).
- **Fixed-activity session:** `games` = that activity, and every player's favourites = `[activity]`. **Activity left to players** (null): `games` = the venue's active activities.
- **Team activities** become `EngineGame { minPlayers = maxPlayers = 2 × team_size }`. Each formed group then goes through `splitTeams`.
- **Seed:** derived from the session id, so a re-run gives the same answer.
- **Refilling a seat:** `rankWaitlist` with the seat's activity and the group's current skills. The candidates are the session's `waiting` entries.

## 5. Jobs (B1 infrastructure; B2 adds steps)

- **Trigger:** `cron.schedule('tick', '10 seconds', 'select private.trigger_tick()')`. `private.trigger_tick()` reads `app_url` and `job_secret` from `vault.decrypted_secrets`; without them it returns and does nothing. Otherwise it calls `net.http_post(app_url || '/api/jobs/tick', headers: Authorization: Bearer <secret>)`.
- **Local setup:** `pnpm env:local` also writes `JOB_SECRET` to `.env.local` and upserts both Vault secrets. Locally `app_url` is `http://host.docker.internal:3000`.
- **Routing:** `proxy.ts` passes `/api/jobs/*` through untouched for any host. The DB calls in as `host.docker.internal`, which isn't a venue host.
- **Route** `app/api/jobs/tick/route.ts` (Node runtime): compares the bearer secret with `timingSafeEqual` and returns 401 if it doesn't match. It then runs, in order, each step capped per tick:
  1. **B2:** `expire_offers()`, then offer each freed seat to the next person (max 50 per tick).
  2. **B2:** match due sessions, `open` with `starts_at − match_cutoff ≤ now` (max 10 per tick).
  3. **B2:** `close_started_sessions()`.
  4. **B1:** deliver emails: `claim_pending_emails(50)`, then send each one.
- Every step is idempotent, so overlapping ticks are harmless. If the app is down, the next tick catches up.
- "Match now" calls the same matching code directly from the server action.

## 6. Email (B1)

- **`EmailSender` interface** `send({ to, subject, html, text })`, chosen by `EMAIL_TRANSPORT`:
  - `smtp`: nodemailer. Locally this is Mailpit; turn on `smtp_port = 54325` under `[inbucket]` in `config.toml`.
  - `resend`: the adapter is written now and configured in Stage E.
  - `EMAIL_FROM` sets the sender.
- **Sending a notification:**
  - The address comes from Auth (service client) at send time.
  - If the player has `email_opt_in = false` or no email, the row becomes `skipped`; it still shows in-app.
  - Each email carries the venue name and colour, a button to the venue-site link and a footer pointing to `/me` for email settings.
- **Opt-in copy** broadens to "Email me about my bookings and seats".
- **Offer emails** carry `https://<slug>.<root>/offers/<token>`. The token exists only in that email and the sending code path. Notification rows store `/me/offers/<id>` instead.

## 7. Screens

**Venue site (players)**
- **Public page** `/`:
  - each session shows **"N seats left"** (B2), computed on the server with the service client, scoped to the venue, counts only;
  - **Request a seat** (B2);
  - **Book a space** (B1).
- **`/book` (B1):** branch (if more than one) → space → date (today … horizon) → slot grid.
  - A slot's state is **free**, **taken** or **open play**; no names are shown.
  - The player picks a start and 1–4 slots, then confirms.
  - The grid starts at opening time and steps by `slot_minutes`. A slot must end by closing time. Overnight hours (e.g. 14:00–02:00) continue past midnight on the same business day. Slots that have already started aren't offered.
- **`/sessions/[id]` (B2):** details and seats left; Request / Withdraw. After matching: your table or team, with the **display names** of your own group (no phones).
- **`/me`** (profile, existing), plus:
  - **`/me/bookings`:** upcoming and past spaces and seats. Cancel until the cut-off; after it: "Contact the venue to cancel".
  - **`/me/offers/[id]`.**
  - **Bell:** unread count via Realtime, with a list at `/me/notifications`.
- **`/offers/[token]` (B2):** no sign-in. Shows the session, seat and countdown, with **Take the seat** / **No thanks** (POST). An expired, used or unknown token shows "This offer is no longer available".

**Owner and staff (root, `/manage/[slug]`)**
- **Bookings (B1):** a day view per branch; spaces are columns on the slot grid.
  - It shows bookings (player name or walk-in name + phone) and open-play sessions.
  - Click a free slot → name + phone → booked. Staff skip the horizon and the limit, but not opening hours.
  - Cancel at any time; mark attended or no-show.
- **Session detail (B2)** `/manage/[slug]/sessions/[id]`:
  - requests with skill;
  - **Match now** and "not enough players yet";
  - groups and teams with skill totals;
  - waitlist and live offers;
  - cancel a seat.
- **Settings (B1):** the four booking settings. Resources: slot length.

## 8. Build order

**B1 — Bookings, notifications, jobs**
1. History protection (§2.1) plus friendly delete messages.
2. Settings and slot length (§2.2–2.3), with the forms.
3. `notifications` + Realtime + bell + `/me/notifications`.
4. Email: `EmailSender`, outbox functions, the Mailpit SMTP port.
5. Jobs: cron/Vault trigger, the tick route, the proxy pass-through, `env:local` secrets.
6. `resource_bookings` and the B1 functions.
7. Slot-grid logic (pure TypeScript: hours, grid, overnight, taken and open-play cells).
8. `/book`, `/me/bookings` (cancel), and the staff Bookings day view with walk-ins.

**B2 — Open play**
1. Session/booking/offer columns (§2.5) and the B2 functions.
2. The matching adapter (§4), "Match now", and the tick steps.
3. Request/withdraw UI, seats left, `/sessions/[id]`.
4. Offers: tokens, `/offers/[token]`, `/me/offers/[id]`, offer emails.
5. Closing and cancelling sessions, and the staff session detail.

## 9. Edge cases the tests must cover
- **Slots:** the first slot at opening time; the last slot ending exactly at closing; a slot that would cross closing is refused; overnight hours; a closed day; a date beyond the horizon; a slot already started.
- **Overlaps:** the same slot booked twice at the same moment gives one `booked` and one `taken` (race test); a booking overlapping an open-play session is refused; back-to-back bookings are allowed; cancelling frees the slot.
- **Limits:** the 3-booking limit can't be beaten with two parallel requests; walk-ins don't count.
- **Walk-ins:** both name and phone are required; a walk-in with a profile is refused.
- **History:** deleting a profile, resource or activity with bookings is refused with a friendly message; deleting a whole venue still works.
- **Matching:** 12 requests for 5-a-side give 10 seated (two teams of 5, smallest skill gap) and 2 waitlisted; 7 requests give `no_groups` and the session stays open; running matching twice gives `already_matched`; a free-for-all café session seats by favourites.
- **Late requests:** these take a free seat only when nobody is waiting.
- **Offers:** an expiry never passes session start; `Take the seat` twice gives `already_accepted` (race test); a token for someone else's offer still gives the seat to the offered player; an expired, used or unknown token shows the friendly page; opening the link (GET) never accepts.
- **Jobs:** a wrong or missing secret gets 401; overlapping ticks send each email once; with no Vault secrets the trigger does nothing.
- **Email:** opted-out players get `skipped`; a failure is retried, then `failed` after 3 attempts.
- **Privacy:** players never see another player's phone; group display names appear only to members of that group; a venue's notifications are invisible to other venues.

## 10. Not in Stage B
- Payments, payment holds and refunds (Stage C).
- **Recurring weekly bookings** for a regular team (later).
- Re-matching a session after it's matched, e.g. forming a second group from a long waitlist (later).
- Check-in, analytics, CSV (Stage D).
- Rate limits and Turnstile (Stage E).
- SMS.
- Chat between players.
