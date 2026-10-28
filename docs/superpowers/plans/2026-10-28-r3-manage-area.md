# R3 Manage Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/manage` for one brand and one front desk: a Today screen (timeline, book for a customer, check-in, cash), Takings, per-section setup with website editing, staff sections, and brand settings, in the R2 look.

**Architecture:** One migration adds `payments` (RLS by section, filled from the booking by trigger), section website fields, the early-arrival status rules and payment voiding on cancel. Pure helpers (`lib/manage/*`) place bookings on the desk timeline, work out business days, map old paths and check colours; loaders read the day and the takings. Pages move from `app/(root)/manage/[slug]/…` to slug-free routes under one manage layout; owner pages are gated by role, section data by `allowedSectionIds`.

**Tech Stack:** Next.js 16.4 (`cacheComponents`), React 19, Tailwind 4 + the R2 tokens, Supabase (Postgres 17, RLS, Storage), Vitest 5, pgTAP, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-28-r3-manage-area-design.md`

## Global Constraints

- Work on branch `r3-manage-area`; check `git branch --show-current` before every commit; end commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Next.js 16 with `cacheComponents: true`: request data (cookies, `searchParams`, `new Date()` before dynamic data) only inside `<Suspense>`; read `apps/web/node_modules/next/dist/docs` before using an unfamiliar API.
- Schema changes are new migration files only. A migration that changes an existing function copies its **current** definition (`select pg_get_functiondef('public.<fn>'::regprocedure)` on the local DB) and edits that.
- No `security definer` in `public`; explicit grants; `pnpm db:lint` (advisors) stays clean.
- **Writes to `payments` use the signed-in person's client** (`createClient()` from `@/lib/supabase/server`) so RLS decides; every other staff write keeps the existing pattern: app check (`requireManager` / `requireManagedSection`), then `createServiceClient()`.
- Look: R2 tokens (`#0f1115` background, `#171a21` card, `#1d2129` raised, `#2b313b` border, `#eef0f3` text, `#aab2bb` muted), Anton headings (`font-display`, uppercase), Inter text, section colour through `sectionStyle(accent)` / `--section`. All text ≥ 4.5:1 (large ≥ 3:1).
- All copy in `apps/web/messages/en.ts` under `m.manage` (sub-groups `nav`, `today`, `desk`, `takings`, `website`, `team`, `brandPage`). Sentence case; kind words from `kindWords()`.
- Exact copy from the spec: "Your site isn't live yet" · "Paid. Contact the venue to cancel" · "Paid ৳X in cash. Give it back before cancelling" · "Text in this colour would be hard to read (R:1, needs 4.5:1)" (R to one decimal).
- Values from the spec: payment amount 1 … 10,000,000 poisha; method `'cash'`; arrival allowed from **30 minutes** before the start, no-show from the start; description ≤ **300** characters; section photo JPG/PNG/WebP ≤ **5 MB**; logo PNG/JPG/WebP ≤ **2 MB** (no SVG); `org-assets` bucket limit **5 MB**; Today refresh **30 s**; colour checks **4.5:1** for the colour on `#171a21` and `#0f1115` on the colour.
- Never write files inside the repo while `next dev` runs (its log, screenshots, Playwright output go to the OS temp folder).

## Review Focus

1. **Two people at the desk on one booking** — one cancels while the other records cash: the cash is refused with "This booking was cancelled", never a payment on a cancelled booking. Pinned in Task 1 (pgTAP) and Task 2 (`recordPayment` → `not_payable`).
2. **A switched-off space, or a section closed today, that still has bookings today** — they still appear on Today so the desk can check those people in. Pinned in Task 6 (`loadDeskDay` integration).
3. **A crafted photo path from another folder** — saving a section's website refuses any `photo_path` outside `<org id>/sections/<section id>/`; removing the photo falls back to the stock photo. Pinned in Task 12.
4. **A staff member whose sections change while Today is open** — their next action on a removed section is refused with a message, not an error page. Pinned in Task 13 (integration through that user's client).
5. **A wrong amount voided and recorded again** — Takings counts only the new amount. Pinned in Task 4.

---

### Task 1: Database — payments, website fields, desk statuses

**Files:**
- Create: `supabase/migrations/20261028020000_r3_desk_and_payments.sql`
- Test: `supabase/tests/database/19_payments.test.sql`, `supabase/tests/database/20_desk_status.test.sql`

**Interfaces:**
- Produces: table `public.payments` (`id, organization_id, section_id, resource_booking_id, seat_booking_id, amount_poisha int, method text, taken_by, taken_at, voided_by, voided_at`); `sections.description`, `sections.photo_path`; `public.set_resource_booking_status(p_booking_id uuid, p_status public.resource_booking_status) → text` (`updated | not_started | invalid | not_found`); `public.set_seat_booking_status(p_booking_id uuid, p_status public.booking_status) → text` (same outcomes); `cancel_resource_booking` and `cancel_booking` void a live payment.

- [ ] **Step 1: Write the failing pgTAP tests.** Follow `16_section_staff.test.sql` (fixed uuids, `pg_temp.act_as`, an org with Turf and Café, owner O, turf-only staff T, a player). `19_payments` asserts:
  - T inserts a payment for a turf booking → ok, and `section_id`/`organization_id` were filled from the booking even when the insert sent the café's ids;
  - T inserts for a café booking (also when sending `section_id` = turf) → `throws_ok` (RLS / not found);
  - O inserts for a café booking → ok; a second live payment on the same booking → `23505`;
  - amount 0 and 10,000,001 → `23514`; method `'bkash'` → `23514`;
  - T voids its payment (`update … set voided_at = now()`) → ok, `voided_by` = T; voiding again or changing `amount_poisha` → throws; `delete` → no rows deleted (no policy);
  - payment on a **cancelled** booking → throws `booking_not_payable` (Review Focus 1);
  - `cancel_resource_booking` and `cancel_booking(…, true)` on a paid booking → its payment now has `voided_at`;
  - a player reads no `payments` rows; `sections.description` of 301 characters → `23514`;
  - `storage.buckets` `org-assets` `file_size_limit` = 5242880.
  `20_desk_status` asserts for spaces **and** seats: `attended` 31 minutes before the start → `not_started`, 29 minutes before → `updated`; `no_show` 1 minute before → `not_started`; `attended` → `confirmed` → `updated`; `no_show` → `confirmed` → `updated`; on a cancelled booking → `invalid`.
- [ ] **Step 2: Run** `pnpm db:test` — Expected: FAIL (`payments` missing, new statuses refused).
- [ ] **Step 3: Write the migration** per spec §7:
  - `payments` with the checks (`num_nonnulls(resource_booking_id, seat_booking_id) = 1`; amount range; `method in ('cash')`; `(voided_by is null) = (voided_at is null)`), FK indexes, partial unique indexes on each booking column `where voided_at is null`, index `(organization_id, taken_at)`; `taken_by`/`voided_by` reference `auth.users on delete set null`.
  - Trigger function `private.payments_fill()` (`security invoker`, `set search_path = ''`), before insert: read the booking (`resource_bookings` → `resources.section_id`; `bookings` → its session's `section_id`), raise `'booking_not_payable'` when missing or `cancelled`, set `organization_id`, `section_id`, `taken_by := coalesce(auth.uid(), new.taken_by)`, `taken_at := now()`.
  - Trigger function `private.payments_void_only()`, before update: allow only `voided_at`/`voided_by` going from null to set (`voided_by := coalesce(auth.uid(), new.voided_by)`); anything else raises.
  - RLS: select / insert / update for `authenticated` using / with check `(select private.is_section_staff(section_id))`; no delete policy; `grant select, insert, update (voided_by, voided_at) on public.payments to authenticated`.
  - `alter table public.sections add column description text check (char_length(description) <= 300), add column photo_path text;` `update storage.buckets set file_size_limit = 5242880 where id = 'org-assets';`
  - `set_resource_booking_status` (copy current) with the new rules; new `set_seat_booking_status` on `bookings` with the session's `starts_at` as the start; both `security invoker`; grant execute to `service_role` like the original.
  - `cancel_resource_booking` and `cancel_booking` (copy current): after cancelling, `update public.payments set voided_at = now(), voided_by = <canceller> where <booking col> = p_booking_id and voided_at is null` (`cancel_booking` uses `auth.uid()`).
- [ ] **Step 4: Run** `pnpm db:test && pnpm db:lint` — Expected: PASS, advisors clean.
- [ ] **Step 5: Commit** `feat(db): payments, desk statuses and section website fields`

### Task 2: Library — record and void cash, desk statuses, paid bookings

**Files:**
- Create: `apps/web/lib/payments/payments.ts`
- Modify: `apps/web/lib/bookings/bookings.ts` (`setSpaceBookingStatus`, `cancelSpaceBooking`, `listMyBookings`), `apps/web/lib/open-play/open-play.ts` (`cancelSeat`, `listMySeats`, new `setSeatStatus`)
- Test: `apps/web/test/integration/payments.test.ts`; extend `bookings.test.ts`, `open-play.test.ts`

**Interfaces:**
- Consumes: Task 1 tables and functions.
- Produces:
  - `type PaymentKind = 'space' | 'seat'`
  - `recordPayment(db, input: { kind: PaymentKind; bookingId: string; amountPoisha: number }): Promise<'recorded' | 'already_paid' | 'not_payable' | 'invalid_amount' | 'not_found'>` — `db` is the person's client; maps `23505` → `already_paid`, `booking_not_payable` → `not_payable`, `23514` → `invalid_amount`, RLS refusal → `not_found`.
  - `voidPayment(db, input: { paymentId: string }): Promise<'voided' | 'already_voided' | 'not_found'>`
  - `livePayments(db, input: { spaceBookingIds: string[]; seatBookingIds: string[] }): Promise<Map<string, { id: string; amountPoisha: number }>>` keyed by booking id.
  - `setSpaceBookingStatus(db, { organizationId, bookingId, status: 'attended' | 'no_show' | 'confirmed' })` → `'updated' | 'not_started' | 'invalid' | 'not_found'`; `setSeatStatus(db, { organizationId, bookingId, status })` same.
  - `cancelSpaceBooking` / `cancelSeat` with a player actor return `'paid'` when a live payment exists (checked before the cut-off).
  - `MyBooking.paid: boolean`, `MySeat.paid: boolean`.

- [ ] **Step 1: Write the failing tests** in `payments.test.ts` (a brand from `setupBrand` with turf + café, an owner, a turf-only staff user signed in through `createTestUser` + a user client): `recordPayment` by turf staff on a turf walk-in → `'recorded'`; again → `'already_paid'`; on a café booking → `'not_found'`; amount 0 → `'invalid_amount'`; a café table booking priced at the venue (price 0) with a typed 50000 → `'recorded'` (spec edge 8); after cancelling the booking → `'not_payable'` (Review Focus 1); `voidPayment` → `'voided'`, again → `'already_voided'`; `livePayments` returns only live rows. In `bookings.test.ts`: player `cancelSpaceBooking` on a paid booking → `'paid'`; staff cancel → `'cancelled'` and the payment is voided; `listMyBookings` row `paid: true`; `setSpaceBookingStatus(… 'confirmed')` after `attended` → `'updated'`. In `open-play.test.ts`: the same for seats (`setSeatStatus`, `cancelSeat` player → `'paid'`, `listMySeats` `paid`).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run --config vitest.integration.config.ts payments bookings open-play` — Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): record and void cash, desk statuses, paid bookings`

### Task 3: Pure desk helpers

**Files:**
- Create: `apps/web/lib/manage/today.ts`, `apps/web/lib/manage/paths.ts`, `apps/web/lib/manage/colour.ts`
- Test: `apps/web/test/manage-helpers.test.ts`

**Interfaces:**
- Produces:
  - `brandBusinessDate(sections: Pick<Section, 'openingHours'>[], now: Date, timeZone: string): string` — the **earliest** of each section's `currentBusinessDate`.
  - `deskWindow(sections: Pick<Section, 'openingHours'>[], date: string, timeZone: string): { start: Date; end: Date } | null` — earliest opening to latest closing of the sections open that business day (`businessDayWindow`); null when all are closed.
  - `placeOnTimeline(window: { start: Date; end: Date }, start: Date, end: Date): { leftPct: number; widthPct: number } | null` — clipped to the window; null when outside.
  - `freeGaps(slots: Array<{ start: Date; end: Date; state: SlotState }>): Array<{ start: Date; end: Date }>` — consecutive `free` slots merged.
  - `oldManagePath(pathname: string, brandSlug: string): string | null` — spec §2 mapping; null when the path isn't under `/manage/<brandSlug>`.
  - `accentReadability(hex: string): { onCard: number; onColour: number; ok: boolean }` — `contrastRatio(hex, '#171a21')`, `contrastRatio('#0f1115', hex)`, ok when both ≥ 4.5.

- [ ] **Step 1: Write the failing tests:**
  - `brandBusinessDate` — turf 10:00–23:00 + lounge 14:00–02:00, Asia/Dhaka: at 01:00 on 2026-10-29 → `'2026-10-28'`; at 11:00 → `'2026-10-29'`; turf only at 01:00 → `'2026-10-29'`.
  - `deskWindow` — the same two sections on 2026-10-28 → 10:00 on the 28th to 02:00 on the 29th (Dhaka); all closed → `null`.
  - `placeOnTimeline` — a booking 10:00–11:00 in a 10:00–02:00 window → `{ leftPct: 0, widthPct: 6.25 }`; one starting before the window is clipped; one after → `null`.
  - `freeGaps` — free, free, taken, free → two gaps, the first two hours long.
  - `oldManagePath('/manage/demo-brand/sessions/abc', 'demo-brand')` → `'/manage/games/abc'`; `…/resources`, `…/activities`, `…/sections` → `'/manage/sections'`; `…/settings` → `'/manage/brand'`; `…/bookings` → `'/manage/bookings'`; `'/manage/demo-brand'` → `'/manage'`; `…/unknown` → `'/manage'`; `'/manage/bookings'` → `null`.
  - `accentReadability` — `#43a66b`, `#2e9e93`, `#8a78e6` → `ok: true`; `#2b313b` → `ok: false`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/manage-helpers.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): desk timeline, business day, old paths and colour checks`

### Task 4: Takings

**Files:**
- Create: `apps/web/lib/payments/takings.ts`
- Test: `apps/web/test/integration/takings.test.ts`

**Interfaces:**
- Consumes: Task 1 `payments`; `currentBusinessDate`, `loadSections`.
- Produces:
  - `interface TakingsRow { sectionId: string; bookings: number; seats: number; arrived: number; noShows: number; cashPoisha: number }`
  - `takingsDay(db, input: { organizationId: string; date: string; timeZone: string }): Promise<{ rows: TakingsRow[]; total: Omit<TakingsRow, 'sectionId'> }>` — one row per section; bookings/seats starting on that business day (not cancelled); arrived/no-shows across both; cash = live payments whose `taken_at` falls on that business day **by the payment's section's hours**.
  - `takingsWeek(db, input: { organizationId: string; endDate: string; timeZone: string }): Promise<Array<{ date: string; cashPoisha: number }>>` — 7 days ending `endDate`, newest first.

- [ ] **Step 1: Write the failing tests:** a turf booking paid ৳600 and a café seat paid ৳200 today → turf row `cashPoisha: 60000`, total `80000`; a lounge (14:00–02:00) payment taken 01:00 the next morning counts toward today (spec edge 4); a payment voided and re-recorded at ৳500 counts `50000` only (Review Focus 5); a cancelled booking is not counted in `bookings`; `takingsWeek` has 7 entries with today's total first.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run --config vitest.integration.config.ts takings` — Expected: FAIL.
- [ ] **Step 3: Implement** with the service client (owner-only page).
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): daily takings by section and business day`

### Task 5: Manage shell and the Bookings page

**Files:**
- Create: `apps/web/lib/tenancy/manager.ts`, `apps/web/app/(root)/manage/layout.tsx`, `apps/web/components/manage/manage-nav.tsx`, `apps/web/components/manage/not-live-banner.tsx`, `apps/web/app/(root)/manage/bookings/{page.tsx,actions.ts}`, `apps/web/app/(root)/manage/desk-actions.ts`
- Delete: `apps/web/app/(root)/manage/[slug]/bookings/` (moved)
- Modify: `apps/web/app/(root)/manage/page.tsx` (Today placeholder until Task 6: the not-live banner and a link to Bookings)

**Interfaces:**
- Consumes: `requireOrgRole`, `allowedSectionIds`, `canManageSection`; Task 2 status functions.
- Produces:
  - `interface Manager { user: SessionUser; org: ManagedOrganization; role: OrgRole; sectionIds: string[] }`
  - `getManager(): Promise<Manager | null>` (cached; signed out → `requireUser('/manage')`; not a member of `BRAND_SLUG`'s org → null)
  - `requireManager(minRole: OrgRole): Promise<Manager>` (null or lower role → `notFound()`)
  - `requireManagedSection(sectionId: string): Promise<Manager>` (not in `sectionIds` → `notFound()`)
  - `setDeskStatusAction(kind: PaymentKind, bookingId: string, status: 'attended' | 'no_show' | 'confirmed', _s: FormState, _f: FormData): Promise<FormState>` in `desk-actions.ts` (section check, then service client; `not_started` → "Too early to mark this").
  - `ManageNav({ role, brandName, logoUrl })`: laptop sidebar + phone bar (spec §2).

- [ ] **Step 1: Write the check** — smoke (`node apps/web/scripts/smoke-site.mjs --as owner@demo-arena.test "/manage/bookings|Bookings;Turf;Board-game café" "/manage|Today"`) and, as a demo player, `"/manage|You don't run any venues yet."`.
- [ ] **Step 2: Run** — Expected: FAIL (`/manage/bookings` missing).
- [ ] **Step 3: Implement** the shell (`layout.tsx` renders the not-member message when `getManager()` is null; otherwise `ManageNav` + children inside `Suspense`) and move the Bookings page: day picker (prev/next, date), a search box (`?q=` matches name or phone, case-insensitive), rows grouped by section in their colours, status buttons using `setDeskStatusAction` with undo, cancel (existing staff cancel), walk-in form kept. Staff see only `sectionIds`.
- [ ] **Step 4: Run** the smoke, `pnpm typecheck`, `pnpm --filter web lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): manage shell and the bookings page`

### Task 6: Today — timeline, now and next, booking panel

**Files:**
- Create: `apps/web/lib/manage/desk-day.ts`, `apps/web/components/manage/today/{timeline.tsx,now-next.tsx,booking-panel.tsx,day-counts.tsx}`
- Modify: `apps/web/app/(root)/manage/page.tsx` (Today)
- Test: `apps/web/test/integration/desk-day.test.ts`

**Interfaces:**
- Consumes: Task 2 `livePayments`; Task 3 `brandBusinessDate`, `deskWindow`, `placeOnTimeline`, `freeGaps`; Task 4 `takingsDay` (for cash today); `sectionDay`; `resource_reservations` (`source = 'open_play_session'`, `source_id`).
- Produces:
  - `interface DeskBooking { kind: 'space'; id: string; resourceId: string; name: string; phone: string | null; status: string; start: Date; end: Date; pricePoisha: number; payment: { id: string; amountPoisha: number } | null }`
  - `interface DeskGame { sessionId: string; sectionId: string; name: string; start: Date; end: Date; resourceIds: string[]; seats: { left: number; total: number } }`
  - `interface DeskSpace { id: string; name: string; active: boolean; bookings: DeskBooking[]; gaps: Array<{ start: Date; end: Date }> }`
  - `loadDeskDay(db, input: { organizationId: string; sectionIds: string[]; date: string; now: Date }): Promise<{ window: { start: Date; end: Date } | null; sections: Array<{ section: Section; spaces: DeskSpace[] }>; games: DeskGame[]; counts: { bookings: number; arrived: number; noShows: number; cashPoisha: number } }>`

- [ ] **Step 1: Write the failing test** `desk-day.test.ts`: a game reserving two pitches appears once with both `resourceIds`; a switched-off space with a booking today is listed, and a closed section's booking today is listed (Review Focus 2); `sectionIds` = turf only → no café spaces; a paid booking carries its `payment`; counts match.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run --config vitest.integration.config.ts desk-day` — Expected: FAIL.
- [ ] **Step 3: Implement** `loadDeskDay`, then the page: header (date, section chips when more than one section, counts, Book for a customer button placeholder for Task 7), `Timeline` on `md+` (rows by section with colour stripe; blocks placed with `placeOnTimeline`; a now line; game blocks link to `/manage/games/<id>`), `NowNext` below `md` (free chips, list by start, "Earlier today" collapsed), `BookingPanel` (a dialog: Arrived / No-show / undo, Cancel with confirmation), `AutoRefresh`. `?section=<slug>` filters.
- [ ] **Step 4: Run** the test, smoke `"/manage|Today;Pitch 1;PC Zone A"` as the owner, `pnpm typecheck`, lint — Expected: PASS. Take phone and laptop screenshots (scratchpad) and look at them.
- [ ] **Step 5: Commit** `feat(web): the Today desk screen`

### Task 7: Book for a customer

**Files:**
- Create: `apps/web/components/manage/today/book-for-customer.tsx`
- Modify: `apps/web/app/(root)/manage/desk-actions.ts`, Today page and timeline (free gaps open the panel pre-filled)

**Interfaces:**
- Consumes: `bookSpace` (guest path), `parseWalkInForm` (`lib/forms/walk-in.ts`), `spaceDay` for free slots.
- Produces: `deskBookAction(_s: FormState, form: FormData): Promise<FormState>` — fields `resourceId`, `startsAt` (ISO), `slots` (1–4), `guestName`, `guestPhone`; `requireManagedSection` on the space's section; results map to the existing walk-in messages (`m.staffBookings`).

- [ ] **Step 1: Write the check** — smoke as the owner that `/manage?book=<resourceId>&at=<ISO>` renders the panel with that space selected (`"Book for a customer;Pitch 2"`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the panel (section → space → day → free start → length → name, phone → Book) and `deskBookAction`; a free gap links to `?book=…&at=…`.
- [ ] **Step 4: Run** the smoke, typecheck, lint, and a browser round trip (book a walk-in at a free gap, see it on the timeline; book a taken time → the "taken" message) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): book for a customer from Today`

### Task 8: Cash at the desk, and Paid for players

**Files:**
- Modify: `apps/web/components/manage/today/booking-panel.tsx`, `now-next.tsx`, `desk-actions.ts`, `apps/web/app/(site)/me/bookings/page.tsx`, `apps/web/app/(site)/me/bookings/actions.ts`
- Test: extend `apps/web/test/integration/payments.test.ts` only if an action-level mapping is added

**Interfaces:**
- Consumes: Task 2 `recordPayment`, `voidPayment`, `cancelSpaceBooking` / `cancelSeat` `'paid'`.
- Produces: `recordPaymentAction(kind: PaymentKind, bookingId: string, _s: FormState, form: FormData): Promise<FormState>` (field `amount` in taka via `bdtToPoisha`; uses `createClient()`); `voidPaymentAction(paymentId: string, _s, _f): Promise<FormState>`; messages: `already_paid` → "Already paid", `not_payable` → "This booking was cancelled", `invalid_amount` → "Enter an amount from ৳1 to ৳100,000".

- [ ] **Step 1: Write the check** — a browser round trip script (scratchpad): owner marks a walk-in Paid ৳600 → the block shows paid and the counts' cash rises by ৳600; Undo → cash back; cancelling a paid booking shows "Paid ৳600 in cash. Give it back before cancelling". Smoke as a demo player with a paid booking: `"/me/bookings|Paid;Contact the venue to cancel"`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the Paid control (amount defaults to `pricePoisha`, empty when 0), Undo, the cancel warning, Paid tags and "Paid. Contact the venue to cancel" in My bookings (bookings and seats).
- [ ] **Step 4: Run** the check, typecheck, lint, `pnpm --filter web exec vitest run --config vitest.integration.config.ts payments bookings open-play` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): cash at the desk and Paid for players`

### Task 9: Takings page

**Files:**
- Create: `apps/web/app/(root)/manage/takings/page.tsx`

**Interfaces:**
- Consumes: Task 4 `takingsDay`, `takingsWeek`; `requireManager('owner')`; `brandBusinessDate`.

- [ ] **Step 1: Write the check** — smoke as the owner `"/manage/takings|Takings;Cash taken;Last 7 days"`; as a turf-only staff member the page renders "not found" (`name="robots" content="noindex"`). Make that member in the step: a fresh user (sign in once by Mailpit, or `auth.admin.createUser` from a scratchpad script), an `organization_members` row with role `staff` and a `section_staff` row for turf; remove them afterwards.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the day picker (`?date=`, prev/next, default `brandBusinessDate`), the section table with a total row, and the 7-day list linking to `?date=`.
- [ ] **Step 4: Run** the smoke, typecheck, lint — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): takings page`

### Task 10: Schedule and the game page

**Files:**
- Create (moved from `[slug]/schedule`, `[slug]/sessions/[id]`, rewritten without slug): `apps/web/app/(root)/manage/schedule/{page.tsx,actions.ts}`, `apps/web/app/(root)/manage/games/[id]/{page.tsx,actions.ts}`
- Delete: the `[slug]` versions

**Interfaces:**
- Consumes: `scheduleOpenPlay`, `cancelOpenPlay`, `staffSessionView`, `matchSession`, `cancelSeat`; Task 2 `setSeatStatus`, `livePayments`; Task 5 `setDeskStatusAction`; Task 8 `recordPaymentAction`, `voidPaymentAction`.

- [ ] **Step 1: Write the check** — smoke as the owner `"/manage/schedule|Schedule open play"` and `"/manage/games/<first game id>|Match now;Arrived"` (the game id from `/cafe` as in R2's smoke).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the moved pages in the R3 look; each seated player row gets Arrived / No-show / undo and Paid in cash; a game outside the manager's sections → `notFound()`.
- [ ] **Step 4: Run** the smoke, typecheck, lint, `pnpm --filter web exec vitest run --config vitest.integration.config.ts open-play schedule` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): schedule and game pages with desk actions`

### Task 11: Sections and their setup tabs

**Files:**
- Create: `apps/web/app/(root)/manage/sections/page.tsx`, `apps/web/app/(root)/manage/sections/[section]/{layout.tsx,page.tsx,games/page.tsx,hours/page.tsx}`, `apps/web/app/(root)/manage/sections/actions.ts`
- Delete: `[slug]/sections`, `[slug]/resources`, `[slug]/activities` and the owner actions they used from `[slug]/actions.ts`

**Interfaces:**
- Consumes: the existing `saveSectionAction`, `addSectionAction`, `deleteSectionAction`, `saveResourceAction`, `setResourceActiveAction`, `saveActivityAction`, `setActivityActiveAction`, `deleteActivityAction` logic (rewritten without `slug`, `requireManager('owner')`); `components/manage/{section-fields,opening-hours-editor,activity-fields}.tsx`.
- Produces: routes `/manage/sections`, `/manage/sections/<slug>` (Spaces), `/games`, `/hours`; the `[section]/layout.tsx` renders the tab bar (Spaces · Games · Hours & rules · Website) and 404s an unknown slug.

- [ ] **Step 1: Write the check** — smoke as the owner `"/manage/sections|Add a section;Turf;Board-game café;Gaming lounge"`, `"/manage/sections/turf|Pitch 1;Badminton Court 1"`, `"/manage/sections/cafe/games|Catan"`, `"/manage/sections/turf/hours|Opening hours"`; `/manage/sections/nope` → noindex.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the pages in the R3 look with the moved actions.
- [ ] **Step 4: Run** the smoke, typecheck, lint, `pnpm --filter web exec vitest run --config vitest.integration.config.ts sections organizations` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): per-section setup pages`

### Task 12: Website tab — description, photo, colour

**Files:**
- Create: `apps/web/app/(root)/manage/sections/[section]/website/page.tsx`, `apps/web/components/manage/photo-uploader.tsx`, `apps/web/lib/sections/website.ts`
- Modify: `apps/web/lib/sections/sections.ts` (`Section.description: string | null`, `Section.photoPath: string | null`; `SECTION_COLUMNS`), `apps/web/lib/site/kinds.ts` (`sectionPhotoUrl(section)`), `apps/web/components/site/landing/{hero,service-row}.tsx`, `apps/web/components/site/section-header.tsx`
- Test: `apps/web/test/integration/section-website.test.ts`; extend `test/site-helpers.test.ts`

**Interfaces:**
- Consumes: Task 3 `accentReadability`; `logoUrl`-style public URL building.
- Produces:
  - `saveSectionWebsite(db, input: { organizationId: string; sectionId: string; name: string; description: string; accent: string; photoPath: string | null }): Promise<{ status: 'saved' } | { status: 'unreadable'; ratio: number } | { status: 'invalid_photo' } | { status: 'invalid'; field: 'name' | 'description' }>` — photo path must start with `<organizationId>/sections/<sectionId>/`.
  - `sectionPhotoUrl(section: Pick<Section, 'kind' | 'photoPath'>): string` — the uploaded photo's public URL, else `sectionPhoto(kind)`.
  - `sectionBlurb(section: Pick<Section, 'kind' | 'description'>): string` — description, else `m.site.landing.blurb[kind]`.

- [ ] **Step 1: Write the failing tests:** `saveSectionWebsite` saves name, description and a readable colour; `#2b313b` → `{ status: 'unreadable' }` with the measured ratio; a `photoPath` under another section's or org's folder → `'invalid_photo'` (Review Focus 3); 301 characters → `invalid` `description`. Unit: `sectionPhotoUrl` with `photoPath: null` → the stock photo path; `sectionBlurb` with `description: null` → the kind's text.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run --config vitest.integration.config.ts section-website` and `pnpm --filter web exec vitest run test/site-helpers.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the lib, the Website tab (name, description with a counter, photo uploader with "Use the default photo", colour picker with a live preview and the readability message), and switch the landing page and section header to `sectionPhotoUrl` / `sectionBlurb`. `next.config.ts` `images.remotePatterns` must allow the Supabase storage host for `next/image`.
- [ ] **Step 4: Run** the tests, smoke `"/|<a saved description>"` after saving one in the browser, typecheck, lint — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): edit what the website shows for each section`

### Task 13: Staff and their sections

**Files:**
- Create: `apps/web/app/(root)/manage/staff/{page.tsx,actions.ts}`
- Modify: `apps/web/lib/orgs/members.ts` (add `setStaffSections`)
- Delete: `[slug]/staff` and its actions in `[slug]/actions.ts`
- Test: extend `apps/web/test/integration/members.test.ts`

**Interfaces:**
- Produces: `setStaffSections(db, input: { organizationId: string; userId: string; sectionIds: string[] }): Promise<'saved' | 'none_selected' | 'not_staff' | 'invalid_section'>` (replaces the member's `section_staff` rows; owners → `'not_staff'`).
- Consumes: `listMembers`, `changeRole`, `removeMember`, `inviteMember`, `cancelInvite`.

- [ ] **Step 1: Write the failing tests:** `setStaffSections` turf + café → both rows; `[]` → `'none_selected'`; a section of another org → `'invalid_section'`; an owner → `'not_staff'`; after narrowing a staff member to turf, `recordPayment` through **that user's client** on a café booking → `'not_found'` (Review Focus 4); `changeRole` of the last owner → `'last_owner'` (existing).
- [ ] **Step 2: Run** the integration file — Expected: FAIL.
- [ ] **Step 3: Implement** `setStaffSections` and the Staff page (team list with section chips, Edit sections, Change role — owner → staff asks for sections, Remove with confirmation, Invite with sections, pending invites with Cancel).
- [ ] **Step 4: Run** the tests, smoke `"/manage/staff|Invite;All sections"`, typecheck, lint — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): staff and the sections they run`

### Task 14: Brand page, logo on the site, old routes gone

**Files:**
- Create: `apps/web/app/(root)/manage/brand/{page.tsx,actions.ts}`
- Modify: `apps/web/components/manage/logo-uploader.tsx` (2 MB), `apps/web/components/site/site-nav.tsx` and `site-footer.tsx` and `site-chrome.tsx` (logo), `apps/web/proxy.ts` (old-path 308 via `oldManagePath`), `apps/web/app/(root)/manage/page.tsx` (the not-live banner links to Brand)
- Delete: the rest of `apps/web/app/(root)/manage/[slug]/` (layout, overview, settings, `actions.ts`)
- Test: extend `apps/web/test/route.test.ts` if the proxy's matching is extracted; smoke for redirects

**Interfaces:**
- Consumes: Task 3 `oldManagePath`; `publishOrganization`; `logoUrl`.
- Produces: `saveBrandAction(_s, form)` (name, address, `logo_path` under `<org id>/`), `publishBrandAction`.

- [ ] **Step 1: Write the check** — `curl -s -o /dev/null -w "%{http_code} %{redirect_url}"` on `/manage/demo-brand/sessions/<id>` → `308 …/manage/games/<id>` and `/manage/demo-brand/settings` → `308 …/manage/brand`; smoke as the owner `"/manage/brand|Logo;Address"`; after uploading a logo in the browser, `/` HTML contains the logo URL.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the Brand page (name, address, logo, Publish when not live; no primary/accent fields), the logo in the site header beside the name, the footer and the manage sidebar, the proxy redirect, and delete the old tree.
- [ ] **Step 4: Run** the checks, `pnpm typecheck`, lint, `pnpm --filter web test` — Expected: PASS; `grep -rn "manage/\[slug\]" apps/web --include=*.ts --include=*.tsx` prints nothing.
- [ ] **Step 5: Commit** `feat(web): brand page, logo on the site, old manage routes redirected`

### Task 15: End-to-end desk journey and wrap-up

**Files:**
- Create: `apps/web/e2e/r3-desk.spec.ts`, `apps/web/e2e/helpers.ts` (the local admin client and sign-in by Mailpit, shared with R2's specs)
- Modify: `apps/web/e2e/r2-journey.spec.ts`, `r2-not-live.spec.ts` (use `helpers.ts`), `README.md`, `memory.md`

- [ ] **Step 1: Write the journeys** in `r3-desk.spec.ts`:
  1. "the owner books a walk-in, checks them in, takes cash and sees it in Takings": sign in as `owner@demo-arena.test`; on `/manage`, Book for a customer at the first free start today (else tomorrow) on any turf space, name "E2E Walk-in", phone `01712345678` → the booking appears; **Paid** with the default amount → shown paid and the day's cash rises by that amount; `/manage/takings` (today) includes it. **Arrived:** the server clock can't be moved, so the journey marks Arrived only when that booking starts within 30 minutes; otherwise it records `test.info().annotations.push({ type: 'skipped-step', description: 'Arrived: booking starts later than 30 min' })`. The timing rule itself is pinned by pgTAP `20_desk_status`.
  2. "a turf-only staff member sees only turf": create a staff user with the turf section (`localAdmin`), sign in; Today shows Pitch 1 and no Table 1 / PC Zone A; `/manage/takings`, `/manage/sections/cafe` and a café game page → noindex; `finally` removes that user.
- [ ] **Step 2: Run** `pnpm test:e2e` — Expected: PASS (all specs).
- [ ] **Step 3: Full suite and replay:** `pnpm typecheck && pnpm test && pnpm --filter web lint && pnpm --filter web build && pnpm db:test && pnpm db:lint && pnpm test:race && pnpm test:integration && pnpm test:e2e && pnpm exec supabase db diff --local --schema public,private` — Expected: all pass; "No schema changes found". The contrast audit (R2's script) over every manage page as the owner — nothing below 4.5:1.
- [ ] **Step 4: Docs:** README — the manage area (routes table, Today, cash and takings, sections' Website tab, staff sections, brand), the R3 hosted rollout (`supabase db push` for the new migration), numbers; memory.md — R3 rulings, gotchas, change log.
- [ ] **Step 5: Commit** `test: R3 desk journeys` and `docs: R3 manage area`
