> **Superseded (2026-10-20):** the project pivoted from a portfolio demo to a real multi-tenant platform. See `docs/superpowers/specs/2026-10-20-booking-platform-design.md`. Kept for history; M1 work described here is merged and still in use.

# Booking & Matchmaking Platform: Design + Build Plan

## Context

This is project #5 from `Agency_Portfolio_Projects.pdf` (Console Log Studio, 14 Oct 2026). It is a **portfolio showcase**, not a SaaS. Its job is to win client work for booking systems: restaurants, gyms, clinics, coworking spaces. The PDF brief:

- Players set availability, favourite games and skill level.
- An algorithm forms balanced groups, books tables and manages the waitlist.
- SMS reminders fill cancelled seats from the waitlist.
- An owner dashboard shows which nights and games earn the most.
- **Demo moment:** simulate 40 players, cancel one, and watch the waitlist fill the seat over SMS.
- **Timebox:** 3–4 weeks, 1–2 developers.

**Success means:**
1. A public live demo that impresses within 30 seconds and needs no real customers or sign-up.
2. An engine that can be re-skinned for a client by changing config.
3. A case study page with an architecture diagram and hard numbers (match latency, time-to-refill, Lighthouse).

**Decisions made with the user:**
- Matching engine: **TypeScript**, as a pure package in the monorepo. No separate service.
- SMS: messages go through a **provider interface**. By default they appear in on-screen **simulated phones** (via Realtime). A **Twilio adapter** can text real verified phones during sales calls.
- Scope: a **board-game café** skin, with domain words and branding kept in config so it can be re-skinned. A second skin is a stretch goal.

**Defaults I picked (easy to change):**
- No payment checkout. Each booking stores a seat price, and revenue = attended seats × price. Project #9 already covers Stripe.
- Deploy to Vercel and Supabase cloud.
- The folder is empty except for the PDF, so this is a fresh repo.

## Architecture

```
pnpm monorepo
├─ apps/web                  Next.js (App Router) + Tailwind + shadcn/ui
│  ├─ app/(site)/            landing + case-study page
│  ├─ app/demo/              sandbox: floor plan, waitlist, phones, timeline, controls
│  ├─ app/play/              player: profile, skill, favourite games, availability, request seat
│  ├─ app/owner/             owner: sessions, run matching, analytics dashboard
│  ├─ app/api/sms/inbound    Twilio webhook (signature-validated)
│  ├─ app/api/jobs/*         expire-offers, send-reminders (called by pg_cron via pg_net + secret)
│  ├─ lib/booking/           orchestration: runMatching, cancelBooking, offerNextSeat, handleReply
│  ├─ lib/notify/            Notifier interface → simulatedAdapter | twilioAdapter
│  └─ skins/boardgame.ts     labels ("table", "night", "game"), palette, copy, seed catalogue
├─ packages/engine           pure TS, no I/O: formGroups(), rankWaitlist(), explainScore()
├─ packages/sim              seeded fake players, 12 weeks of history, scripted demo scenario
└─ supabase/
   ├─ migrations/            schema, RLS, RPCs, analytics views, pg_cron jobs
   └─ tests/                 pgTAP: RLS isolation, offer-acceptance race
```

**Why this layout:** The engine is pure and deterministic (a seeded RNG), so it can be unit and property tested on its own, and later ported or reused for client work. All I/O lives in `lib/booking`. The database enforces correctness for concurrency (seat capacity, single acceptance), so there's no double-booking even with duplicate SMS replies.

### Data model (all venue-scoped, so multi-tenant from day one)
- `venues`: name, timezone, `skin`, `offer_ttl_seconds`, `owner_id`, `is_demo`, `expires_at`
- `tables`: capacity, floor-plan x/y
- `games`: min/max players, duration
- `players`: name, phone, skill (1–5), `user_id` (null for simulated players), sms_opt_in
- `player_games`: favourite games, ranked
- `availability`: weekly recurring windows
- `sessions`: a night at the venue, with start/end, seat price, and status open→matched→closed
- `seat_requests`: a player asks for a seat on a session
- `groups`: session + table + game
- `bookings`: group, player, seat, status confirmed/cancelled/attended/no_show, price, source matched/waitlist. Unique (session, player); a capacity check is enforced in the RPC.
- `waitlist_entries`: priority, status waiting/offered/promoted/expired
- `seat_offers`: group, waitlist entry, `expires_at`, status pending/accepted/declined/expired
- `messages`: outbox and log (direction, body, provider, status). This table **drives the simulated phones via Realtime**.
- `events`: timeline and audit (cancelled, offered, accepted, filled + timings). It feeds the demo timeline and the time-to-refill metric.

**RPCs (plpgsql, transactional):**
- `accept_offer(offer_id)`: `FOR UPDATE` lock, check the seat is still open, insert the booking, mark the offer and waitlist entry. It is idempotent.
- `cancel_booking(booking_id)`
- `expire_offers()`

**RLS:** The owner (`venues.owner_id = auth.uid()`) has full access to their venue. Players can read and write only their own rows.

### Matching engine (`packages/engine`)
`formGroups({requests, players, games, tables, config, seed})` returns `{groups, waitlist, score, diagnostics}`:
1. Score game demand from ranked favourites. Allocate tables to games greedily, respecting `min_players ≤ size ≤ min(game.max, table.capacity)`.
2. Assign players to games, maximising their preference rank. Players who were waitlisted last time get priority (fairness).
3. Within each game, sort by skill and split into tables in contiguous chunks, so players at a table have similar skill.
4. Run a seeded local search (move/swap) on the objective: preference + λ·(−within-table skill spread) + μ·(filled seats), with a penalty for under-min groups.
5. Leftover players go to the waitlist, ordered by fairness priority.

`rankWaitlist(openSeat, waitlist, config)`: candidates must want that game and be available. They are ranked by skill fit with the table, then priority.

`explainScore()` gives the "why am I at this table" breakdown shown in the UI.

### Waitlist and SMS flow
1. A reminder goes out ("Reply C to cancel"), or the player cancels in the app.
2. `cancel_booking` frees the seat. `offerNextSeat` then picks the top candidate, creates a `seat_offer` (the demo venue's TTL is about 20s) and sends "Seat open at Table 3 for Catan, 7pm. Reply YES".
3. A YES goes to `accept_offer`. Replies come from the Twilio inbound webhook or the simulated-phone reply button; both go through the same `handleReply(phone, body)`.
4. A NO or an expiry (pg_cron runs every 10s and calls `expire_offers`) moves the offer to the next candidate.
5. A confirmation SMS goes out, and the `events` table records time-to-refill.

**Notifier:** Every send writes a `messages` row. The simulated adapter stops there. The Twilio adapter also calls the Twilio API. **Twilio is only enabled for the agency's presenter mode, with verified numbers set in env. Public sandboxes can never send real SMS**, which keeps out abuse and cost.

### Demo experience (`/demo`)
- Each visitor gets an anonymous Supabase sign-in, which creates their own **sandbox venue**. It is cloned from the skin seed and expires after 24h; pg_cron cleans it up. Visitors never collide with each other.
- **Layout:**
  - An SVG floor plan of tables with seats, coloured by skill, with animated fills.
  - A waitlist column and an event timeline.
  - Three phone mockups: the player who cancels, offer #1 and offer #2.
- **Controls:** "Simulate 40 players", "Run matching", "Cancel a random seat", "Reset", and a **"Play the demo"** button. That button runs the scripted scenario: cancel → offer to #1 → #1 says NO → offer to #2 → YES → seat filled, with "refilled in 14s" shown.
- A view-as switcher lets the visitor act as any simulated player (the `/play` flows) or as the owner (`/owner`).

### Owner dashboard (`/owner`)
- Revenue by weekday and by game.
- Fill rate, cancellation and no-show rate.
- Waitlist conversion and median time-to-refill.

These come from SQL views over 12 weeks of seeded history (`packages/sim`). Charts use shadcn charts (Recharts).

## Build milestones (about 1 week each)

**M1 – Foundation and engine**
- git init.
- Scaffold the pnpm monorepo, Next.js, Tailwind/shadcn, and local Supabase.
- Write migrations: schema, RLS, RPCs.
- Build `packages/engine` with Vitest and fast-check property tests.
- Build the `packages/sim` generator.

**M2 – Booking flows**
- Player pages: profile, skill, favourites, availability, request seat.
- Owner: sessions and run matching.
- Bookings, cancellation, waitlist and offers.
- Notifier with the simulated adapter.
- `handleReply` and the `expire_offers` cron.

**M3 – Demo experience**
- Sandbox venues via anonymous auth.
- Floor plan, phones and timeline over Realtime.
- The scripted "Play the demo" scenario.
- Twilio adapter, presenter mode and reminders.

**M4 – Analytics, polish and ship**
- Owner dashboard and views.
- Playwright e2e tests and a Lighthouse pass.
- A benchmark script for match latency.
- Deploy to Vercel and Supabase.
- The case-study page: architecture diagram, hard numbers, a 60s video.

**Stretch:** a second skin (padel courts or gym classes) to prove re-skinning works.

**Status:** Design approved 2026-10-20. Each milestone gets its own step-by-step implementation plan in `docs/superpowers/plans/`, and the build follows TDD.

**Dev prerequisites:** Node 24, pnpm, Supabase CLI, and Docker Desktop (for `supabase start` and pgTAP tests).

## Verification
- **Engine** (`pnpm --filter engine test`), property tests covering:
  - no player is double-booked;
  - group sizes stay within game and table limits;
  - players only get games they favourited;
  - seated + waitlisted = all requesters;
  - output is deterministic for a given seed;
  - it is fast enough: 500 players in under 100ms.
- **Database** (`supabase test db`, pgTAP):
  - one venue can't read another's rows;
  - two concurrent `accept_offer` calls for the same seat give exactly one booking;
  - a duplicate YES is a no-op.
- **E2E** (Playwright against `supabase start` + `next dev`): the "Play the demo" scenario finishes with the cancelled seat refilled, and the expected messages appear in the phone panels.
- **Manual:**
  - presenter mode sends a real SMS to a verified phone through a Twilio trial;
  - a YES reply via the inbound webhook (ngrok locally) fills the seat;
  - Lighthouse scores ≥ 90 on `/demo` and the landing page.
