# Paying for online bookings by bKash or Nagad — Design

Date: 2026-11-04 · Status: approved in conversation (four parts), written for review · Branch `mobile-money-booking`

## 1. Goal and decisions

A player who books a space online pays first, by bKash or Nagad **Send Money** to Chattoturf's booking number, and the
booking is **pending** until someone on the team sees the money and **confirms** it; then it is **booked**. Walk-in
bookings at the desk, paid in cash, are a different scenario and stay exactly as they are.

Decisions (the user's answers):

| Question | Decision |
| --- | --- |
| Which online bookings need it | **Every online space booking**, in every section (open-play game seats don't) |
| How much | **The full price** (nothing left to pay at the venue) |
| How they pay | **Send Money** to the venue's bKash and/or Nagad number |
| Time to pay | The slot is **held 15 minutes** while they send money and type in the transaction ID |
| What they type | bKash or Nagad, the number they sent from, the **transaction ID** (TrxID) |
| How the team hears | A **"Payments to check"** list in Manage with a count on the menu, **plus an email** to the owners and the staff who run that section |
| Reject | The team can reject ("payment not found", optional reason): the slot frees and the player is told |
| Cancelling after paying | **Contact the venue** (as cash-paid bookings today); the venue refunds by bKash/Nagad itself |
| Who sets the numbers | **Owners only** (trusted managers are given the Owner role); every change is emailed to all owners |
| No number set | **Online booking pauses** ("opens soon — call or visit us") until at least one number is set |
| Technical approach | **A: a `pending` status on the booking itself** (not a separate request list, not "booked but unpaid") |

## 2. What the player sees

### 2.1 Booking

On `/<section>/book` the player picks a space, start and length as today. For a space with an online price above ৳0
the button reads **Request booking**, with the line *"You'll pay ৳1,200 by bKash or Nagad to confirm."* A space
priced at the venue (৳0, "Price at venue") is booked instantly as today — there is nothing to send.

If no bKash or Nagad number is set, a paid space can't be requested online: the page says *"Online booking opens
soon — call or visit us."* (with the venue's address).

### 2.2 The payment page — `/me/bookings/<id>/pay`

Requesting creates the booking as **pending** with a **15-minute hold** and goes straight to its payment page:

- the amount: **৳1,200**;
- where to send it: **bKash 01XXXXXXXXX** and/or **Nagad 01XXXXXXXXX** (whichever are set), each with **Copy**;
- *"Use Send Money. Then fill this in:"*;
- a countdown, **"Slot held for 14:32"**;
- the form: **bKash / Nagad** (only the ones set), **the number you sent from** (01XXXXXXXXX), **transaction ID**;
- **I've sent it**, and **Cancel this request** (frees the slot; only before sending).

My bookings links to this page while the hold runs ("Pay to confirm — 14:32 left").

If the 15 minutes end first, the booking is cancelled, the slot frees, and the bell (and email) says *"Your hold on
Pitch 1, Fri 8pm ended — book again if you still want it."* The page then says the hold ended, with a link back to
the booking page.

### 2.3 Waiting, booked, not confirmed

- After **I've sent it**: My bookings shows **"Payment sent — waiting for the venue to confirm"**, and the slot stays
  held until the team decides (even past the 15 minutes). Everyone else sees **Taken**. The player can't cancel online:
  **"Paid — contact the venue to cancel."**
- **Confirmed**: **Booked**; the player gets the usual booking-confirmed email and bell notice (sent now, not when
  they requested).
- **Rejected**: **"Not confirmed — we couldn't find your payment"** plus the team's reason if given; email and bell
  notice; *"If you did send money, contact us"* with the venue's number. The slot is free again.

### 2.4 Small rules

- A transaction ID can be used once in the whole brand (case and spaces ignored).
- A pending booking counts toward the section's limit of upcoming bookings.
- The number a player sent from and the transaction ID are seen only by them and the team.

## 3. The team's side

### 3.1 The numbers — Manage → Brand

A **Payments** box with **bKash number** and **Nagad number** (each optional; 11-digit Bangladeshi mobile numbers,
`01[3-9]XXXXXXXX`). Only **owners** can change them. Every change emails all owners: *"The bKash number for online
bookings was changed from … to … by Name."* They are shown on the payment page and as the contact number in the
"not confirmed" message.

### 3.2 Payments to check — `/manage/payments`

A new page, and a menu item with a count, **Payments (3)** (like **Chat (n)**). Each request, oldest first:

- player name and phone, space, day, time and length;
- **amount**, **bKash/Nagad**, **sent from**, **transaction ID**, when they said they sent it; **Started** if its time
  has begun;
- **Confirm** — the booking becomes booked and a bKash/Nagad payment of that amount is recorded (who confirmed, when);
- **Reject** — asks first, with an optional reason (*"Payment not found"*, up to 200 characters); the booking is
  cancelled, the slot freed, the player told.

Underneath, a small grey list: holds still waiting for the player to pay (with minutes left), so staff know why a slot
is taken.

Owners see every section; staff see the sections they run (the rule the rest of Manage uses).

### 3.3 Email to the team

When a player taps **I've sent it**, the owners and the staff of that section get one email: *"Payment to check:
Sami, Pitch 1, Fri 8pm, ৳1,200 by bKash (TrxID 9JK7ABC123)"* with a link to `/manage/payments`. It goes through the
Gmail sender the staff-invite emails use. The list is the source of truth; a lost email loses nothing.

### 3.4 Today, Bookings, Takings

- **Today**: a pending booking is on the timeline marked **Payment to check** (or **Waiting for payment** during the
  hold); its panel has **Confirm** and **Reject**, so the desk can settle it when the player turns up. **Arrived** and
  **No-show** wait until it is confirmed.
- **Bookings**: the new statuses — *Waiting for payment*, *Payment to check*, *Booked*, *Not confirmed*.
- **Takings**: confirmed bKash/Nagad payments count, split by method: **Cash ৳X · bKash ৳Y · Nagad ৳Z**.
- **Walk-in "Book for a customer"** and **cash** payments: unchanged. Staff bookings are never pending.
- Cancelling a paid booking (staff) voids its payment as today; the refund itself is sent by the venue.

### 3.5 Nobody checked in time

A request still unchecked when its time starts is **not** cancelled (the player may well have paid). It stays on
Payments to check marked **Started**, and on Today, until someone confirms or rejects it.

## 4. How it's built

### 4.1 Data (one migration plus its review fixes; every table carries `organization_id`, composite keys as elsewhere)

- `resource_booking_status` gains **`pending`**.
- `resource_bookings` gains **`hold_until timestamptz`** — set (now + 15 min) while a pending booking waits for the
  player's details, cleared when they send them; null for every other booking.
- New **`payment_claims`** — one per pending/paid online booking:
  `booking_id` (→ `resource_bookings (id, organization_id)`), `method` (`bkash` | `nagad`), `sender_phone`
  (`01[3-9]\d{8}`), `trx_id` (stored upper-case, 6–20 letters/digits), `amount_poisha`, `submitted_at`,
  `status` (`submitted` | `confirmed` | `rejected`), `decided_by`, `decided_at`, `reason` (≤ 200).
  Unique `(organization_id, trx_id)`; unique `booking_id`.
- `organizations` gains **`bkash_number`**, **`nagad_number`** (nullable, same phone check).
- `payments.method` allows **`bkash`**, **`nagad`** besides `cash`; `payments` gains **`reference`** (the TrxID; only
  for those two).
- New notification kinds: **`booking_hold_expired`**, **`booking_payment_rejected`** (booking confirmed reuses
  `booking_confirmed`).

### 4.2 Who can read (row-level security)

- `payment_claims`: the booking's own player, owners, and staff of the booking's section (`private.is_org_owner`,
  `private.is_section_staff`). No writes from the browser.
- `organizations.bkash_number` / `nagad_number`: readable like the brand (they're shown to players); written only
  through the owner-only function.

### 4.3 Who writes (all `security invoker`, `set search_path = ''`, service role only, like the rest)

- **`book_resource`** (changed): a player booking online with a price above ৳0 → `pending` with `hold_until`; refuses
  `payment_closed` when the brand has no number. Staff and walk-in bookings, and ৳0 spaces, are unchanged
  (`confirmed`). Pending counts toward the limit. A pending booking sends **no** "booking confirmed" notice — that
  comes with the team's Confirm.
- **`submit_payment_claim(booking, user, method, sender, trx)`** → `submitted` | `not_yours` | `hold_over` |
  `not_pending` | `trx_used` | `method_closed` (that service has no number) | `invalid`. Clears `hold_until`;
  amount = the booking's price.
- **`decide_payment_claim(booking, user, decision, reason)`** → `confirmed` | `rejected` | `not_allowed` |
  `not_pending` | `nothing_sent`. Takes the booking's advisory lock (the one `cancel_resource_booking` and payments
  take). Confirm: status `confirmed`, a `payments` row (method, amount, `reference`, `taken_by`), the player's
  `booking_confirmed` notification. Reject: cancel (reservation deleted), claim `rejected`, `booking_payment_rejected`
  notification.
- **`cancel_resource_booking`** (changed): the player may cancel their own **pending** booking only while the hold runs
  (no claim yet); staff may cancel any (a claim is kept, marked rejected with reason "cancelled").
- **`set_resource_booking_status`** (changed): refuses `pending` bookings (`not_confirmed`).
- **`set_payment_numbers(org, user, bkash, nagad)`** — owners only; returns the old values so the app can email the
  owners.
- **`expire_payment_holds(p_now)`** — the every-minute job: pending bookings with `hold_until < p_now` are cancelled
  with a `booking_hold_expired` notification. A new step in `lib/jobs/tick.ts`.

### 4.4 The app

- `lib/bookings/bookings.ts` — `bookSpace` returns `pending` (with the booking id) or `payment_closed`.
- `lib/payments/claims.ts` — submit, decide, list to check, list holds; `lib/payments/numbers.ts` — read/set numbers.
- `lib/forms/payment-claim.ts` — parse and check the form (phone format, TrxID shape).
- Pages: `app/(site)/me/bookings/[id]/pay/page.tsx` (+ actions); `app/(root)/manage/payments/page.tsx` (+ actions);
  the Brand page's Payments box; Today's panel and timeline; Bookings list; Takings by method; My bookings statuses.
- `components/manage/manage-nav.tsx` — **Payments (n)**.
- Email: `lib/email/payment-check-email.ts` (team) and `lib/email/payment-numbers-email.ts` (owners); player notices
  through the existing outbox (`lib/notifications/render.ts` gains the two kinds).
- Words in `messages/en.ts`.

## 5. Privacy policy and terms

Privacy: online bookings now record the number a payment was sent from and its transaction ID, seen only by the
player and the venue team, kept with the booking's payment record. Terms: online bookings are confirmed only after the
venue sees the payment; holds last 15 minutes; after paying, cancellations and refunds go through the venue.

## 6. Errors and edge cases

| Case | What happens |
| --- | --- |
| Slot taken between page load and Request | "That time was just taken" (as today) |
| Details sent after the 15 minutes | Refused: "Your hold ended. Book again." (the slot may already be someone else's) |
| TrxID already used | "That transaction ID has already been used." |
| Bad phone or TrxID shape | Field errors |
| Two staff confirm/reject at once | One wins (lock); the other sees "Already decided" |
| Staff cancel while a player sends details | Lock: one wins; a late send gets `not_pending` |
| Number removed while holds run | Existing holds can still send details for the other service if set; if none is left, the page says to contact the venue |
| Player removes their account | As today (booking history protected) |
| Price changes after requesting | The booking keeps the price it was requested at |

## 7. Testing

- **pgTAP**: pending holds the slot (an overlapping booking is refused); `hold_until` set and cleared; expiry cancels
  and notifies (and leaves submitted ones alone); only the booking's player submits, only within the hold; TrxID
  unique per brand; only owners and that section's staff decide; confirm writes the payment with method and
  reference; reject frees the slot; staff and ৳0 bookings stay instant; no number → `payment_closed`; only owners set
  numbers; Arrived refused while pending; row rules on `payment_claims`.
- **Race**: confirm vs reject vs cancel on one booking → exactly one outcome.
- **Integration**: `bookSpace`, the claims library, numbers, takings by method.
- **Browser (e2e)**: book → pay page → send details → team confirms (booked; in Takings as bKash); reject (player
  told, slot free); a hold ending (job run); online booking paused without numbers; walk-in cash unchanged; the team
  email reaches Mailpit.
- Then the full suite, build, and a fresh independent review before merging.

## 8. Rollout

1. The user runs the hosted database update: `! pnpm exec supabase db push --yes`.
2. `main` is pushed; Vercel deploys. Online booking of paid spaces pauses until a number is set.
3. The owner sets the bKash and/or Nagad number in Manage → Brand — online booking reopens with payment.
4. Optional: one small real booking, rejected afterwards (refunded by the venue), to see it end to end.

## 9. Not built (later, if wanted)

Automatic payment checks (needs a merchant account and the bKash/Nagad API); an advance instead of the full price;
paying ahead for open-play seats; online cancellation with a refunds list; a separate Manager role; SMS alerts.
