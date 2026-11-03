# Paying for Online Bookings by bKash or Nagad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player's online booking of a priced space is held 15 minutes as `pending` while they Send Money by bKash/Nagad and enter the transaction ID; the team confirms (booked, payment recorded) or rejects (slot freed); walk-in cash at the desk is unchanged.

**Architecture:** A `pending` status on `resource_bookings` (the slot is held by its existing `resource_reservations` row), a `hold_until` column, a new `payment_claims` table, and the brand's `bkash_number`/`nagad_number`. All writes go through `security invoker` service-role functions (`book_resource` gains `p_by_player`; new `submit_payment_claim`, `decide_payment_claim`, `expire_payment_holds`, `set_payment_numbers`); the app adds a pay page, a Manage "Payments to check" page, a Brand "Payments" box, Today/Bookings/Takings changes and a tick step.

**Tech Stack:** Next.js 16 App Router (cacheComponents, server actions + `refresh()`), React 19, Supabase Postgres (RLS, pgTAP), Vitest (unit/integration/race), Playwright e2e on the local stack.

**Spec:** `docs/superpowers/specs/2026-11-04-mobile-money-booking-design.md`

## Global Constraints

- Branch `mobile-money-booking`; run `git branch --show-current` before every commit. **No AI attribution** in commits (no `Co-Authored-By` line).
- Functions in `public` are `language plpgsql|sql security invoker set search_path = ''`, `revoke … from public, anon, authenticated; grant … to service_role`. Definer helpers only in `private`. Composite FKs `(x_id, organization_id)`.
- Adding an enum value lives in its own migration (it can't be used in the transaction that adds it).
- Hold length **15 minutes**. Phone format **`^01[3-9][0-9]{8}$`**. TrxID: trimmed, spaces removed, upper-cased, **`^[A-Z0-9]{6,20}$`**. Reject reason ≤ **200** characters.
- `book_resource(…, p_by_player boolean default false)`: only `true` with a price above ৳0 makes a booking `pending`; every existing caller (staff, walk-in, pgTAP, race, e2e seeds) keeps `confirmed`.
- Copy (exact): button **"Request booking"**; line **"You'll pay {price} by bKash or Nagad to confirm."**; paused **"Online booking opens soon — call or visit us."**; **"Use Send Money. Then fill this in:"**; **"Slot held for {mm:ss}"**; **"I've sent it"**; **"Cancel this request"**; **"Payment sent — waiting for the venue to confirm"**; **"Not confirmed — we couldn't find your payment"**; **"If you did send money, contact us"**; **"Paid — contact the venue to cancel"** (existing `m.bookings.paidContact` reads "Paid. Contact the venue to cancel" — keep the existing string); Manage menu **"Payments (n)"**; team email subject **"Payment to check: {player}, {space}, {day time}, {price} by {bKash|Nagad} (TrxID {id})"**; hold-ended notice **"Your hold on {space}, {day time} ended — book again if you still want it."**; **"That transaction ID has already been used."**; **"Your hold ended. Book again."**
- Tests run on the LOCAL stack (`pnpm env:local`); afterwards `pnpm env:hosted` and restart the dev server. Kill stray `next dev` before `pnpm build`.

## Review Focus

1. **A player who sends details after their hold ended while someone else already took the slot** — refused with "Your hold ended. Book again."; their claim is never attached to the other booking (Task 2 pgTAP: expire, rebook by another player, then submit → `hold_over`).
2. **The same TrxID typed with spaces or lower case** ("9jk7 abc123") — treated as the same ID, refused as used (Task 2 pgTAP + Task 4 unit test of `normaliseTrxId`).
3. **Staff of the café trying to confirm a turf payment** — `not_allowed`, and the turf request isn't on their Payments page (Task 3 pgTAP + Task 7 e2e as `turf-staff`).
4. **A request whose time has started while still unchecked** — not expired by the job, still confirmable, shown "Started" (Task 2 pgTAP: expire with `p_now` past the start leaves a submitted claim alone; Task 7 e2e label).
5. **Online booking with no numbers set after deploy** — paid spaces say "Online booking opens soon — call or visit us." and nothing is held; ৳0 café tables still book instantly (Task 2 pgTAP `payment_closed`; Task 6 e2e).

---

### Task 1: Schema — pending status, numbers, payment claims

**Files:**
- Create: `supabase/migrations/20261104010000_mobile_money_kinds.sql`, `supabase/migrations/20261104010100_mobile_money_schema.sql`
- Test: `supabase/tests/database/36_mobile_money_schema.test.sql`

**Interfaces:**
- Produces: enum values `resource_booking_status.pending`, `notification_kind.booking_hold_expired`, `notification_kind.booking_payment_rejected`; columns `resource_bookings.hold_until timestamptz`, `organizations.bkash_number text`, `organizations.nagad_number text`, `payments.reference text`, `payments.method in ('cash','bkash','nagad')`; table `public.payment_claims (id, organization_id, booking_id, method text check in ('bkash','nagad'), sender_phone, trx_id, amount_poisha int > 0, submitted_at, status text check in ('submitted','confirmed','rejected') default 'submitted', decided_by uuid → auth.users on delete set null, decided_at, reason ≤ 200)`, unique `(organization_id, trx_id)`, unique `booking_id`, FK `(booking_id, organization_id) → resource_bookings (id, organization_id)`.

- [ ] **Step 1: Write the failing pgTAP test** `36_mobile_money_schema.test.sql` (org `…36a0`): `has_column` for the four new columns; `col_is_null` for `hold_until`, numbers; `throws_ok` inserting a `payments` row with `method = 'card'` (23514); `throws_ok` `bkash_number = '12345'` (23514); two `payment_claims` with the same `trx_id` in one org → 23505, same `trx_id` in another org → lives; RLS: as the booking's player (`private.is_own_profile`) `select count(*) from payment_claims` = 1; as an owner = 1; as staff of the booking's section = 1; as staff of another section = 0; as another player = 0; `authenticated` cannot insert (42501).
- [ ] **Step 2: Run** `pnpm exec supabase test db supabase/tests/database/36_mobile_money_schema.test.sql` → FAIL (columns missing).
- [ ] **Step 3: Write the two migrations.** Kinds file: three `alter type … add value if not exists`. Schema file: columns with checks (`^01[3-9][0-9]{8}$` on both numbers and `sender_phone`; `trx_id ~ '^[A-Z0-9]{6,20}$'`; `payments.reference` only when method ≠ cash: `check ((method = 'cash') = (reference is null))`), replace the `payments.method` check, the table, indexes on every FK column, RLS `select to authenticated using (private.is_own_profile(b.profile_id, …) or private.is_org_owner(organization_id) or private.is_section_staff(<booking's section>))` via a `private.can_see_payment_claim(booking uuid)` definer helper (stable, `set search_path = ''`, granted to authenticated), no insert/update/delete grants.
- [ ] **Step 4: Run** the test → PASS; `pnpm db:test` → all pass; `pnpm exec supabase db lint` clean.
- [ ] **Step 5: Commit** `feat(db): pending bookings, payment numbers and payment claims`.

### Task 2: Booking, sending details, holds ending

**Files:**
- Create: `supabase/migrations/20261104010200_mobile_money_booking_fns.sql`
- Test: `supabase/tests/database/37_mobile_money_booking.test.sql`

**Interfaces:**
- Consumes: Task 1 schema.
- Produces:
  - `public.book_resource(p_organization_id uuid, p_resource_id uuid, p_starts_at timestamptz, p_slots int, p_profile_id uuid, p_guest_name text, p_guest_phone text, p_created_by uuid, p_by_player boolean default false) returns table (status text, booking_id uuid)` — statuses `booked` | `pending` | `payment_closed` | `taken` | `limit_reached` | `invalid`. Drop the 8-argument version first; same grants.
  - `public.submit_payment_claim(p_booking_id uuid, p_user_id uuid, p_method text, p_sender_phone text, p_trx_id text) returns text` — `submitted` | `not_yours` | `hold_over` | `not_pending` | `trx_used` | `method_closed` | `invalid`.
  - `public.expire_payment_holds(p_now timestamptz default now()) returns int` (bookings cancelled).

- [ ] **Step 1: Write the failing pgTAP test** `37_mobile_money_booking.test.sql` (org `…37a0`, turf section with Pitch 1 at ৳2,500/h and a ৳0 table, players A/B, staff of turf, `bkash_number` set):
  - player A with `p_by_player` on Pitch 1 → `pending`; row has `status = 'pending'`, `hold_until` ≈ now + 15 min, a reservation; **no** `booking_confirmed` notification;
  - B on the overlapping slot → `taken`; A's pending counts toward the limit (set limit 1 → second → `limit_reached`);
  - `p_by_player` on the ৳0 table → `booked`; staff (`p_by_player` false) on Pitch 1 → `booked`;
  - with both numbers null → `payment_closed` and no booking row;
  - submit: B for A's booking → `not_yours`; A with `nagad` while only bKash is set → `method_closed`; bad phone → `invalid`; A valid (`'9jk7 abc123'`) → `submitted`, `hold_until` null, claim `trx_id = '9JK7ABC123'`, amount = booking price; submit again → `not_pending`;
  - another booking, submit with `'9JK7ABC123'` → `trx_used`;
  - expiry: a pending booking with `hold_until` in the past and no claim → `expire_payment_holds()` = 1, it is `cancelled`, its reservation gone, one `booking_hold_expired` notification; the submitted one untouched even with `p_now` after its start (Review Focus 4);
  - Review Focus 1: A books, `expire_payment_holds(now() + interval '16 minutes')`, B books the same slot (pending), A submits for their expired booking → `hold_over` and no claim row;
  - `authenticated` cannot execute any of the three (42501).
- [ ] **Step 2: Run** it → FAIL.
- [ ] **Step 3: Write the migration.** `book_resource`: copy the current body (`20261025010000_sections.sql`), count `status in ('confirmed','pending')` toward the limit; when `p_by_player and p_profile_id is not null and v_price > 0`: refuse `payment_closed` unless the org has a number, insert with `status = 'pending', hold_until = now() + interval '15 minutes'`, skip the notification, return `pending`. `submit_payment_claim`: take `pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0))` (the lock cancel and payments use), lock the booking, check ownership through `player_profiles.user_id`, `status = 'pending'` and `hold_until is not null` (else `not_pending`), `hold_until > now()` (else `hold_over`), method has a number, normalise and check phone/TrxID, insert the claim (`unique_violation` → `trx_used`), clear `hold_until`. `expire_payment_holds`: update pending bookings with `hold_until < p_now` to `cancelled` (`cancelled_at = p_now`, `cancelled_by` null), delete their reservations, insert one `booking_hold_expired` notification each (payload like `booking_cancelled`'s), cap 200 per run.
- [ ] **Step 4: Run** → PASS; `pnpm db:test` all pass (11, 14, 16 unchanged); `pnpm test:race` passes.
- [ ] **Step 5: Commit** `feat(db): online bookings wait for payment details, and holds end after 15 minutes`.

### Task 3: Deciding, cancelling and the numbers

**Files:**
- Modify: `supabase/migrations/20261104010200_mobile_money_booking_fns.sql` (same file, appended)
- Test: `supabase/tests/database/38_mobile_money_decide.test.sql`, `supabase/tests/race/payment-decide-race.test.ts`

**Interfaces:**
- Produces:
  - `public.decide_payment_claim(p_booking_id uuid, p_user_id uuid, p_decision text, p_reason text default null) returns text` — `confirmed` | `rejected` | `not_allowed` | `not_pending` | `nothing_sent` | `invalid`.
  - `public.cancel_resource_booking(p_booking_id uuid, p_cancelled_by uuid)` (changed) — also cancels `pending`: the booking's own player only while `hold_until` is set (`not_cancellable` once details are sent); anyone else (the app has checked staff) always; a submitted claim becomes `rejected` with `reason = 'cancelled'`.
  - `public.set_payment_numbers(p_organization_id uuid, p_user_id uuid, p_bkash text, p_nagad text) returns table (status text, old_bkash text, old_nagad text)` — `saved` | `not_allowed` | `invalid`.

- [ ] **Step 1: Write the failing pgTAP test** `38_mobile_money_decide.test.sql` (org `…38a0`, turf + café sections, owner, turf staff, café staff, player with a submitted claim on a turf pitch):
  - café staff → `not_allowed` (Review Focus 3); a player → `not_allowed`; `p_decision = 'maybe'` → `invalid`;
  - a pending booking with no claim → `nothing_sent`;
  - turf staff `confirm` → `confirmed`; booking `confirmed`; one live `payments` row `method = 'bkash'`, `reference = trx_id`, `amount_poisha = price`, `taken_by` = staff; claim `confirmed`, `decided_by`; one `booking_confirmed` notification; deciding again → `not_pending`;
  - another claim, owner `reject` with reason → `rejected`; booking `cancelled`, reservation gone, claim `rejected` + reason, one `booking_payment_rejected` notification with `reason` in its payload; a 201-character reason → `invalid`;
  - `set_resource_booking_status(<pending>, 'attended')` → `invalid`;
  - cancel: the player on their own pending booking during the hold → `cancelled`; after submitting → `not_cancellable`; staff on a submitted one → `cancelled` and its claim `rejected`/`cancelled`;
  - `set_payment_numbers`: staff → `not_allowed`; owner `'01712345678', null` → `saved` with the old values returned; `'0171'` → `invalid`;
  - none executable by `authenticated`.
- [ ] **Step 2: Write the failing race test** `payment-decide-race.test.ts` (pattern of `pay-vs-cancel.test.ts`): one submitted claim; `confirm`, `reject` and `cancel_resource_booking` fired together 20 times on fresh bookings; each round ends with exactly one of {booking confirmed with one live payment, booking cancelled with no live payment} and never both a live payment and `cancelled`.
- [ ] **Step 3: Run** both → FAIL.
- [ ] **Step 4: Implement** the three functions in the migration. `decide_payment_claim`: the advisory lock first; permission = owner (`organization_members.role = 'owner'`) or `section_staff` row for the booking's resource's section; confirm inserts `payments (resource_booking_id, amount_poisha, method, reference, taken_by)` and the `booking_confirmed` notification (same payload as `book_resource`'s); reject cancels like `cancel_resource_booking` (reservation deleted) and notifies. `cancel_resource_booking`: copy the current body (`20261028030000_r3_review_fixes.sql`) and allow `pending` as above.
- [ ] **Step 5: Run** → PASS; `pnpm db:test`, `pnpm test:race` all pass.
- [ ] **Step 6: Commit** `feat(db): the team confirms or rejects a payment; cancelling and the venue's numbers`.

### Task 4: The app library — booking, claims, numbers, takings

**Files:**
- Create: `apps/web/lib/payments/claims.ts`, `apps/web/lib/payments/numbers.ts`, `apps/web/lib/forms/payment-claim.ts`
- Modify: `apps/web/lib/bookings/bookings.ts`, `apps/web/lib/payments/takings.ts`, `apps/web/lib/manage/desk-day.ts`
- Test: `apps/web/test/payment-claim-form.test.ts`; `apps/web/test/integration/payment-claims.test.ts`; update `apps/web/test/integration/bookings.test.ts`, `takings.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3 functions.
- Produces:
  - `BookSpaceResult` gains `{ status: 'pending'; bookingId: string }` and `{ status: 'payment_closed' }`; `bookSpace` passes `p_by_player: input.actor === 'player'`; the "already yours" check counts `pending`.
  - `MyBooking` gains `payment: 'hold' | 'sent' | 'rejected' | null`, `holdUntil: string | null`, `rejectReason: string | null`; `listMyBookings` puts `pending` in `upcoming`; `cancellable` is true for a hold.
  - `parsePaymentClaimForm(form: FormData): { ok: true; value: { method: 'bkash' | 'nagad'; senderPhone: string; trxId: string } } | { ok: false; errors: Partial<Record<'method' | 'senderPhone' | 'trxId', string>> }`; `normaliseTrxId(raw: string): string`.
  - `submitClaim(db, { bookingId, userId, method, senderPhone, trxId }): Promise<'submitted' | 'not_yours' | 'hold_over' | 'not_pending' | 'trx_used' | 'method_closed' | 'invalid'>`.
  - `decideClaim(db, { bookingId, userId, decision: 'confirm' | 'reject', reason: string | null }): Promise<'confirmed' | 'rejected' | 'not_allowed' | 'not_pending' | 'nothing_sent' | 'invalid'>`.
  - `claimsToCheck(db, { organizationId, sectionIds: string[] }): Promise<ClaimToCheck[]>` — `ClaimToCheck { bookingId, playerName, playerPhone: string | null, resourceName, sectionName, start: Date, end: Date, amountPoisha, method, senderPhone, trxId, submittedAt: Date, started: boolean }`, oldest first; `holdsWaiting(db, { organizationId, sectionIds }): Promise<Array<{ bookingId, playerName, resourceName, start: Date, holdUntil: Date }>>`; `claimsToCheckCount(db, { organizationId, sectionIds }): Promise<number>`.
  - `payBooking(db, { bookingId, profileId }): Promise<PayView | null>` — `PayView { bookingId, resourceName, sectionName, start: Date, end: Date, amountPoisha, holdUntil: Date | null, status: 'hold' | 'sent' | 'confirmed' | 'rejected' | 'ended', numbers: PaymentNumbers }`.
  - `paymentNumbers(db, organizationId): Promise<PaymentNumbers>` (`{ bkash: string | null; nagad: string | null }`); `setPaymentNumbers(db, { organizationId, userId, bkash, nagad }): Promise<{ status: 'saved' | 'not_allowed' | 'invalid'; old: PaymentNumbers }>`.
  - `TakingsRow` gains `bkashPoisha`, `nagadPoisha` (cash stays `cashPoisha`); pending bookings don't count as bookings.
  - `DeskBooking` gains `claim: { method: 'bkash' | 'nagad'; senderPhone: string; trxId: string } | null` (status `pending` passes through).

- [ ] **Step 1: Write the failing unit test** `payment-claim-form.test.ts`: `normaliseTrxId(' 9jk7 abc123 ')` = `'9JK7ABC123'`; a missing method, `'0171234567'` (10 digits), `'02123456789'`, a 5-character and a 21-character TrxID each give that field's error; a valid form gives the normalised value.
- [ ] **Step 2: Write the failing integration tests.** `payment-claims.test.ts`: book as a player → `pending`; `payBooking` shows `hold` with the numbers; `submitClaim` → `submitted`, then `payBooking` `sent`; `claimsToCheck` for the turf section lists it with every field, for the café section doesn't; `claimsToCheckCount` = 1; `decideClaim` confirm → `listMyBookings` shows it `confirmed` with `paid: true`; `takingsDay` shows it under `bkashPoisha`. Update `bookings.test.ts`: player bookings on the priced pitch now expect `{ status: 'pending', bookingId: expect.any(String) }` (set the test org's `bkash_number` in `beforeAll`), add one `payment_closed` case with the number cleared, `already_yours` still detected for a pending booking.
- [ ] **Step 3: Run** `pnpm exec vitest run test/payment-claim-form.test.ts` and `pnpm test:integration` → FAIL.
- [ ] **Step 4: Implement** the files and changes listed in Interfaces (`claims.ts` and `numbers.ts` call the RPCs with the service client the actions pass; reads use the same client with explicit `organization_id` and section filters).
- [ ] **Step 5: Run** unit + integration → PASS (all 166+ integration).
- [ ] **Step 6: Commit** `feat(payments): the booking, claims and numbers library`.

### Task 5: Notices and team emails

**Files:**
- Create: `apps/web/lib/email/payment-check-email.ts`, `apps/web/lib/email/payment-numbers-email.ts`, `apps/web/lib/payments/team-emails.ts`
- Modify: `apps/web/lib/notifications/render.ts`, `apps/web/messages/en.ts`
- Test: `apps/web/test/notification-render.test.ts` (extend), `apps/web/test/payment-emails.test.ts`; `apps/web/test/integration/payment-claims.test.ts` (extend)

**Interfaces:**
- Produces: `NotificationKind` gains `'booking_hold_expired' | 'booking_payment_rejected'`; `paymentCheckEmail({ venueName, primaryColour, playerName, resourceName, when: string, amount: string, method: 'bkash' | 'nagad', trxId, link }): { subject, html, text }`; `paymentNumbersEmail({ venueName, primaryColour, changedBy, before: PaymentNumbers, after: PaymentNumbers }): { subject, html, text }`; `teamForSection(db, { organizationId, sectionId }): Promise<string[]>` (owner emails + that section's staff emails, via `auth.admin.getUserById`), `ownerEmails(db, organizationId): Promise<string[]>`.

- [ ] **Step 1: Write the failing tests.** Render: `booking_hold_expired` → title "Your hold ended", body "Your hold on Pitch 1 (Turf), Fri 6 Nov, 8pm ended — book again if you still want it."; `booking_payment_rejected` with `reason: 'Payment not found'` → title "Not confirmed — we couldn't find your payment", body containing the reason and "If you did send money, contact us". Emails: subject exactly "Payment to check: Sami, Pitch 1, Fri 6 Nov, 8pm, ৳2,500 by bKash (TrxID 9JK7ABC123)"; the numbers email's text names the old and new bKash number and who changed it; HTML escapes a name with `<b>`. Integration: `teamForSection` for the turf section returns the owner's and the turf staff's addresses, not the café staff's.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with `brandEmail` (`lib/email/layout.ts`) like `teamInviteEmail`; words in `m.payments` (new block) and `m.notifications`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(payments): notices for players and emails for the team`.

### Task 6: The player's side — Request booking, the pay page, My bookings

**Files:**
- Create: `apps/web/app/(site)/me/bookings/[id]/pay/page.tsx`, `apps/web/app/(site)/me/bookings/[id]/pay/actions.ts`, `apps/web/components/bookings/pay-form.tsx`, `apps/web/components/bookings/hold-countdown.tsx`
- Modify: `apps/web/app/(site)/[section]/book/actions.ts`, `apps/web/app/(site)/[section]/book/page.tsx`, `apps/web/components/bookings/slot-picker.tsx`, `apps/web/app/(site)/me/bookings/page.tsx`, `apps/web/app/(site)/me/bookings/actions.ts`, `apps/web/messages/en.ts`
- Test: `apps/web/e2e/p1-pay-booking.spec.ts`; `apps/web/e2e/helpers.ts` (add `setPaymentNumbers(db, organizationId, numbers: { bkash: string | null; nagad: string | null })`)

**Interfaces:**
- Consumes: Task 4 (`bookSpace`, `payBooking`, `submitClaim`, `listMyBookings`), Task 5 (`paymentCheckEmail`, `teamForSection`).
- Produces: route `/me/bookings/<id>/pay`; `submitClaimAction(bookingId: string, state: FormState, form: FormData): Promise<FormState>` (on `submitted` emails the team — failures logged, never shown — and `refresh()`); `cancelHoldAction(bookingId)`.

- [ ] **Step 1: Write the failing e2e** `p1-pay-booking.spec.ts` (Demo Arena; `setPaymentNumbers` bKash `01712345678`, Nagad null in `beforeAll`, restored after):
  - "a player requests a pitch, pays and waits": the turf book page shows "Request booking" and "You'll pay ৳2,500 by bKash or Nagad to confirm."; requesting lands on `/me/bookings/<id>/pay` showing "৳2,500", "01712345678", "Use Send Money. Then fill this in:", "Slot held for 1" (minutes 14/15); the Nagad choice is absent; a bad TrxID shows its field error; a valid one → "Payment sent — waiting for the venue to confirm"; My bookings shows the same status and no Cancel; the turf grid shows that slot Taken to another player; Mailpit has the "Payment to check: …" email to the owner;
  - "a hold can be cancelled before paying": Cancel this request → the slot is Free again;
  - "with no numbers, paid spaces pause and the café still books": numbers null → turf page shows "Online booking opens soon — call or visit us." and no Request button; café books instantly ("Booked! See My bookings.").
- [ ] **Step 2: Run** `pnpm exec playwright test e2e/p1-pay-booking.spec.ts` → FAIL.
- [ ] **Step 3: Implement.** Book action: `pending` → `redirect('/me/bookings/' + id + '/pay')`; `payment_closed` → the paused message. Book page/slot picker: label and price line when the space has a price and the brand has a number; the paused message when it has a price and no number. Pay page (Suspense'd, `requirePlayer`): amount, numbers with Copy (`navigator.clipboard`), countdown (client component, ticks each second, at 0 shows "Your hold ended. Book again." with a link to the section's book page), the form (radio only for set numbers), Cancel this request; `sent`/`confirmed`/`rejected` states show their status line instead. My bookings: statuses "Pay to confirm — {mm:ss} left" (links to the pay page), "Payment sent — waiting for the venue to confirm", "Not confirmed — we couldn't find your payment" + reason.
- [ ] **Step 4: Run** the spec → PASS; `pnpm exec tsc --noEmit -p .`, `pnpm exec eslint .`.
- [ ] **Step 5: Commit** `feat(bookings): request a booking and pay by bKash or Nagad`.

### Task 7: The team's side — numbers, Payments to check, Today, Bookings, Takings

**Files:**
- Create: `apps/web/app/(root)/manage/payments/page.tsx`, `apps/web/app/(root)/manage/payments/actions.ts`, `apps/web/components/manage/payment-numbers-form.tsx`
- Modify: `apps/web/app/(root)/manage/brand/page.tsx`, `apps/web/app/(root)/manage/brand/actions.ts`, `apps/web/components/manage/manage-nav.tsx`, `apps/web/app/(root)/manage/layout.tsx`, `apps/web/components/manage/today/booking-panel.tsx`, `apps/web/components/manage/today/timeline.tsx`, `apps/web/app/(root)/manage/desk-actions.ts`, `apps/web/app/(root)/manage/bookings/page.tsx`, `apps/web/app/(root)/manage/takings/page.tsx`, `apps/web/messages/en.ts`
- Test: `apps/web/e2e/p2-check-payments.spec.ts`

**Interfaces:**
- Consumes: Task 4 (`claimsToCheck`, `holdsWaiting`, `claimsToCheckCount`, `decideClaim`, `paymentNumbers`, `setPaymentNumbers`, `DeskBooking.claim`, `TakingsRow` methods), Task 5 (`paymentNumbersEmail`, `ownerEmails`).
- Produces: route `/manage/payments`; `decideClaimAction(bookingId: string, decision: 'confirm' | 'reject', state: FormState, form: FormData)`; `savePaymentNumbersAction(state, form)` (owner only, emails all owners when a number changed); `ManageNav` prop `paymentsToCheck?: number` → item "Payments (n)".

- [ ] **Step 1: Write the failing e2e** `p2-check-payments.spec.ts` (Demo Arena, numbers set; a player request with details sent, made through the UI or the RPCs):
  - "the owner sets the numbers": Brand → Payments box saves bKash `01712345678` and Nagad `01812345678`; Mailpit has the numbers-changed email to the owner; `turf-staff@demo-arena.test` sees no Payments box on Brand (owner-only page) ;
  - "the team confirms a payment": the menu shows "Payments (1)"; the page lists the player, Pitch, amount, bKash, sender, TrxID; Confirm → the row leaves, the player's My bookings shows the booking upcoming without a status line; Today shows it; Takings shows "bKash ৳2,500";
  - "the team rejects one": Reject asks first; with "Payment not found" → the player's My bookings shows "Not confirmed — we couldn't find your payment" and the reason; the slot is Free on the grid;
  - "café staff don't see turf payments" (Review Focus 3) and "a started request is labelled Started" (move its `period` into the past with the service client);
  - "Today handles a pending booking": its panel shows "Payment to check" with Confirm and Reject, and no Arrived.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the page (Suspense'd; `requireManager('staff')`; owners pass every section id), the actions (`requireManager('staff')`, service client, `refresh()`), the Reject confirmation with `ConfirmAction` (`components/manage/confirm-action.tsx`) and a reason input, the nav count (layout passes `claimsToCheckCount` for the manager's sections), the Brand box (owner only), Today/Bookings labels for `pending` ("Waiting for payment" while `hold_until` is set, else "Payment to check"), Takings "Cash ৳X · bKash ৳Y · Nagad ৳Z".
- [ ] **Step 4: Run** the spec → PASS; typecheck, lint.
- [ ] **Step 5: Commit** `feat(manage): payments to check, the venue's numbers, and pending bookings at the desk`.

### Task 8: The job, existing tests, privacy and terms

**Files:**
- Modify: `apps/web/lib/jobs/tick.ts`, `apps/web/test/integration/tick.test.ts`, `apps/web/e2e/r2-journey.spec.ts`, `apps/web/e2e/helpers.ts`, `apps/web/messages/en.ts` (`m.legal`), `memory.md`
- Test: `apps/web/test/integration/tick.test.ts`; `apps/web/e2e/p1-pay-booking.spec.ts` (add a hold-ending case)

**Interfaces:**
- Consumes: `expire_payment_holds` (Task 2).
- Produces: tick step `'payment holds'` calling `db.rpc('expire_payment_holds', { p_now: now.toISOString() })` before `'emails'`; `TickReport` gains `paymentHoldsEnded: number`.

- [ ] **Step 1: Write the failing tests.** `tick.test.ts`: a pending booking with `hold_until` in the past → after `runTick` it is `cancelled` and the report says `paymentHoldsEnded: 1`. e2e: a hold whose `hold_until` is moved into the past and the RPC run → the pay page shows "Your hold ended. Book again." and the bell has "Your hold ended".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the step. Update `r2-journey.spec.ts`: `SECTIONS` gets `paid: boolean` (turf and lounge `true`, café `false`); paid sections click "Request booking" and assert the pay page, then continue; set numbers with `setPaymentNumbers` in `beforeAll`. Add the privacy lines (sender number and transaction ID, seen by the player and the team, kept with the payment record) and terms lines (confirmed only after the venue sees the payment; holds last 15 minutes; after paying, cancellations and refunds go through the venue) to `m.legal`, and extend `e2e/r2-legal.spec.ts` to find "transaction ID" on `/privacy` and "15 minutes" on `/terms`.
- [ ] **Step 4: Run the whole suite:** `pnpm db:test`, `pnpm test:race`, `pnpm --filter web test`, `pnpm test:integration`, `pnpm --filter web test:e2e`, typecheck, lint, `pnpm build`, `pnpm exec supabase db diff` (empty), advisors.
- [ ] **Step 5: Update `memory.md`** (change log, §4 architecture: statuses, claims, numbers; the rollout order) and **commit** `feat(jobs): payment holds end on time; tests, privacy and terms for paying online`.

### Rollout (after the whole-branch review and merge — each step needs the user)

1. The user runs `! pnpm exec supabase db push --yes` (three migrations).
2. Push `main`; Vercel deploys; paid online bookings pause.
3. The owner sets the numbers in Manage → Brand.
4. Optional: one small real booking, rejected and refunded by the venue.
