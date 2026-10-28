# R3: The Manage Area — Design

**Date:** 2026-10-28 · **Builds on:** `2026-10-25-one-brand-sections-design.md` (§5 Owner and staff, §7 stage R3) and `2026-10-28-r2-public-site-design.md` (the A1 look)
**Status:** approved in conversation (parts 1–6); this document is for review.

## 1. Goal and decisions

The manage area still has the multi-venue layout and the old plain look. R3 rebuilds it for one brand
with one front desk: a **Today** screen the desk works from all day, per-section setup for the owner,
cash payments and a daily takings summary, staff whose sections can be changed, and owner control over
what the public site shows.

| Topic | Decision (user, 2026-10-28) |
|---|---|
| Main use | **Both**: staff at the desk on a phone or tablet, the owner setting up on a laptop. |
| Front desk | **One desk for everything**: the same people check in turf, café and lounge customers. |
| Desk jobs | See the day at a glance · book for a customer · check in and no-shows · **record cash paid** (new). |
| Owner jobs | Edit a staff member's sections · daily takings summary · edit what the website says (section text and photo, brand logo) · section colours. |
| Structure | **A · Today first**: `/manage` opens on Today across all allowed sections; setup lives per section. This replaces the one-brand spec's "section switcher" (§5), which suited a desk per section. |
| Size | **One R3**, not split. |

**Done when** (from the one-brand spec, extended): the owner books a walk-in on Today, marks them arrived
and paid, and sees the cash in Takings; a turf-only staff member sees and changes only turf rows on every
manage page and gets "not found" for café pages; the owner manages all three sections.

## 2. Structure and navigation

The brand slug leaves the URL (one brand, `BRAND_SLUG`).

| Path | Who | What |
|---|---|---|
| `/manage` | staff + owner | **Today** (§3) |
| `/manage/bookings` | staff + owner | Any day's bookings in allowed sections; search by name or phone |
| `/manage/schedule` | staff + owner | Create and cancel open games (as today) |
| `/manage/games/<id>` | staff + owner | One game: requests, teams with skill totals, waitlist, offers, **Match now**, desk actions per player (§3) |
| `/manage/takings` | owner | Daily summary (§4) |
| `/manage/sections` | owner | The sections, add, remove (§5) |
| `/manage/sections/<slug>` | owner | Tabs: Spaces · Games · Hours & rules · Website (§5) |
| `/manage/staff` | owner | Team, invites, sections per person (§6) |
| `/manage/brand` | owner | Name, address, logo, Publish (§6) |

- **Access.** A staff member sees Today, Bookings, Schedule and game pages, limited to their sections; any
  owner page, or a game in another section, renders "not found". The database already refuses their reads
  and writes outside their sections (R1); every new write in R3 is checked the same way (§7).
- **Not on the team** (a player, or a staff member removed from the brand): `/manage` shows "You don't run
  this venue" (today's message); deeper paths render "not found".
- **Navigation.** Laptop: a left sidebar with the brand's logo and name, the pages above (owner pages only
  for owners), and a link to the public site. Phone: a bottom bar with **Today · Bookings · Schedule ·
  More**; More opens the owner pages (owners) or the public-site link and Sign out (staff).
- **Old links.** `/manage/<BRAND_SLUG>/…` redirects (308) to the new path of the same page:
  `…/sessions/<id>` → `/manage/games/<id>`, `…/resources` and `…/activities` → `/manage/sections`,
  `…/settings` → `/manage/brand`, `…/sections` → `/manage/sections`, `…/bookings|schedule|staff` → same name,
  `/manage/<BRAND_SLUG>` → `/manage`. Query strings are kept where the page still reads them.
- **Brand not live.** Today shows a banner "Your site isn't live yet" linking to Brand → **Publish** (owner);
  staff see the banner without the link.

## 3. Today (the desk)

The business day: after midnight, Today keeps showing the night until the last allowed section closes
(the rule `currentBusinessDate` already applies on the booking page), using the latest closing time among
the sections shown.

**Header.** The date; section filter chips (only the sections you may see; none when you have one); a
**Book for a customer** button; a one-line count: bookings today, arrived, no-shows, and cash taken today
in the shown sections.

**Laptop and tablet: a timeline.** Rows are spaces, grouped by section with the section's colour stripe and
name; columns are hours from the earliest opening to the latest close of the shown sections; a line marks
now. Blocks:
- a **booking** shows the name (player display name, or the walk-in's name) and its state: arrived ✓,
  no-show, paid;
- a **game** spans the spaces it reserves and shows its name and seats filled (`6/10`); tapping opens
  `/manage/games/<id>`;
- a **free gap** inside opening hours is tappable and opens Book for a customer pre-filled with that space
  and start time.

**Phone: "Now and next".** Free spaces for the current hour as chips at the top, then a list by start time
(from the current hour on, with "Earlier today" collapsed): time, space in its section colour, name,
tap-to-call phone, and one-tap **Arrived · No-show · Paid**.

**Booking panel** (tap a booking): name, phone, space, time, price; **Arrived** (from 30 minutes before
the start) and **No-show** (from the start), either undoable back to booked; **Paid in cash** with the amount
(defaults to the booking's price, editable; §4); **Cancel** with a confirmation (a paid booking warns first; §4).
Today's rule allows neither before the start (it stopped "no-show" being set on next week's booking by
mistake); R3 keeps that for no-show and opens a 30-minute early window for arrivals, because people check in
before their slot.

**Book for a customer** (a panel): section → space → day (defaults to today) → start time from that space's
free slots → length (1–4 slots) → name and phone → **Book**. It uses the existing walk-in booking path, so
the section's opening hours, slot length, clashes and booking window apply exactly as today.

**Games on the game page** get the same desk actions per seated player: Arrived, No-show, Paid in cash.

**Freshness.** The page refreshes after every action and every 30 seconds while visible (the existing
`AutoRefresh`), so two people at the desk see each other's changes.

## 4. Cash payments and Takings

**`payments` (new table).** One row is one payment:

| Column | Notes |
|---|---|
| `id`, `organization_id`, `section_id` | `section_id` is the booking's section, for access and takings |
| `resource_booking_id` / `seat_booking_id` | references `resource_bookings` / `bookings`; **exactly one** is set |
| `amount_poisha` | > 0 and ≤ 10,000,000 (৳100,000) |
| `method` | `'cash'` (Stage C adds `'bkash'`) |
| `taken_by`, `taken_at` | the staff member or owner, and when |
| `voided_by`, `voided_at` | set when undone; a voided payment never counts |

- A booking has **at most one live** (not voided) payment (a partial unique index per booking column).
- **Undo** voids; nothing is deleted.
- **Access:** staff of the payment's section and owners may insert and void; no one updates amounts or
  deletes rows; players can't write. Reads: staff of the section and owners. Enforced by RLS with the R1
  section helpers, not only in the app.
- **Amount:** defaults to the booking's `price_poisha` (seats: the seat price). A booking priced at the venue
  (price 0) has no default; the desk types the amount.
- **Cancelling a paid booking at the desk:** the panel says "Paid ৳X in cash. Give it back before
  cancelling"; cancelling voids the live payment in the same step.
- **Players** see a **Paid** tag on a booking or seat in My bookings once a live payment exists, and can no
  longer cancel it themselves ("Paid. Contact the venue to cancel"), so the cash record never outlives its
  booking without the desk knowing.

**Takings (`/manage/takings`, owner).**
- A day picker (previous / next; defaults to the current business day).
- A table: one row per section and a total row. Columns: **bookings** (space bookings starting that day, not
  cancelled), **game seats** (seats in games starting that day, not cancelled), **arrived**, **no-shows**,
  **cash taken** (sum of live payments taken during that business day).
- The **last 7 days** below: date and total cash, each opening that day.
- A payment taken after midnight counts toward the night it belongs to (business day by its section's hours).
- Out of scope: exports, charts and trends (Stage D).

## 5. Sections and what the website shows

**`/manage/sections`** — the sections as rows in their colours: name, number of spaces and games, today's
hours; **Add a section** (pick a kind; as today); **Remove** (refused while the section has spaces in use,
bookings or games; as today).

**`/manage/sections/<slug>`** — four tabs:
1. **Spaces:** name, type, capacity, price per hour (or "priced at the venue"), slot length, on/off; add and
   edit (today's resource actions).
2. **Games:** name, players or team size, length, on/off; add, edit, remove (today's activity actions).
3. **Hours & rules:** opening hours per weekday (closed days and past-midnight hours allowed) and the booking
   rules: how far ahead (`booking_horizon_days`), cancel cut-off (`cancel_cutoff_minutes`), matching cut-off
   (`match_cutoff_minutes`), most upcoming bookings per player (`max_upcoming_bookings`), how long a seat offer
   lasts (`offer_ttl_seconds`, shown in minutes). Today's section action.
4. **Website:**
   - **Name.** The address (`/turf`) stays fixed so links don't break.
   - **Description,** up to 300 characters; empty uses the kind's general text (`m.site.landing.blurb`).
   - **Photo:** JPG, PNG or WebP up to 5 MB replaces the stock photo on the landing page (hero and services)
     and the section page; **Use the default photo** switches back.
   - **Colour:** a picker with a live preview (the section's name, its buttons and a card). Saved only when
     both readability checks pass — the colour as text on cards (`#171a21`) and `#0f1115` text on the colour —
     at **4.5:1** each, the same checks the built-in colours pass (`contrastRatio`). Otherwise: "Text in this
     colour would be hard to read (3.2:1, needs 4.5:1)".

**Data:** `sections.description text` (≤ 300 characters) and `sections.photo_path text`. Photos go in the
existing public `org-assets` bucket under the brand's folder (`<org id>/sections/<section id>/<random>.<ext>`);
only owners write there (today's storage policy). The bucket's size limit rises from 1 MB to 5 MB; its types
stay PNG, JPEG and WebP.

## 6. Staff and brand

**`/manage/staff` (owner).**
- The team: name and email, role, sections as coloured chips (owners: "All sections"), "You" on your row.
- **Edit sections** for a staff member: tick sections and save; at least one is required. Takes effect on
  their next page load (it replaces their `section_staff` rows).
- **Change role:** staff → owner gives every section; owner → staff asks which sections to keep (all ticked).
- **Remove** with a confirmation.
- The **last owner** can't be removed or made staff (the existing `members.ts` guard).
- **Invite:** email, role, sections (all ticked by default; stored in `organization_invites.section_ids`);
  pending invites listed with their sections and **Cancel**.

**`/manage/brand` (owner).**
- **Name** and **address** (the address feeds the landing page, the footer and the Google Maps link).
- **Logo:** PNG, JPG or WebP up to 2 MB, or remove it. Shown in the site header beside the name, in the footer
  and at the top of the manage sidebar. SVG is not accepted (a public SVG can carry script).
- **Publish** when the brand isn't live yet (moved from the old Overview).
- The old **primary** and **accent** brand colour fields are removed from the UI; the section colours replaced
  them on the site. Emails keep a stored primary colour, else the default.
- The old **Overview** page (four counts) is removed; Today replaces it.

## 7. Data changes (one migration)

1. `public.payments` as in §4: foreign keys to `organizations`, `sections`, `resource_bookings`, `bookings`,
   `auth.users` (`taken_by`, `voided_by`), each indexed; `check (num_nonnulls(resource_booking_id,
   seat_booking_id) = 1)`; `check (amount_poisha > 0 and amount_poisha <= 10000000)`; `method` check
   `in ('cash')`; partial unique indexes on each booking column `where voided_at is null`. A trigger sets
   `organization_id` and `section_id` **from the booking** on insert (whatever the caller sent), so the RLS
   check below always sees the booking's real section — otherwise a turf staff member could label a café
   payment "turf".
2. RLS on `payments`: select / insert for staff of `section_id` or owners; update allowed only to set
   `voided_by`/`voided_at` once (a trigger rejects any other change); no delete. Explicit grants as in R1.
3. `sections.description` (`check (char_length(description) <= 300)`) and `sections.photo_path`.
4. `storage.buckets` `org-assets`: `file_size_limit` 5 MB.
5. Arrival and no-show: `set_resource_booking_status` allows `attended` from 30 minutes before the start,
   `no_show` from the start, and back to `confirmed` from either; a matching function does the same for seats
   in games (`bookings`). Both refuse a booking that is cancelled, and stay `security invoker` with the R1
   section checks.
6. Player cancellation (`cancel_booking` paths used by My bookings) refuses a booking with a live payment.

No `security definer` functions in `public`; advisors stay clean.

## 8. Look and words

The R2 tokens and type (dark matte, Anton headings, Inter text, section colours; §2 of the R2 spec). Every
section-specific element carries its colour (row stripe, chip, name). Words follow the R2 rules: plain,
sentence case, each section's kind words where they apply ("Book pitch", "Join match"). All copy goes in
`messages/en.ts`.

## 9. Edge cases the tests must cover

1. A turf-only staff member: Today, Bookings and Schedule contain no café or lounge rows; Takings, café game
   pages and section pages render "not found"; recording or voiding a café payment fails at the database, also
   when the request claims the turf section.
2. One live payment per booking; a voided payment doesn't count in Today's or Takings' totals; voiding twice
   is refused.
3. Cancelling a paid booking voids its payment in the same step.
4. After midnight (lounge open 14:00–02:00, now 01:00): Today still shows the night, and a payment taken at
   01:00 counts toward the previous business day in Takings.
5. A section colour that fails either readability check is refused; the built-in colours pass.
6. Editing a staff member to zero sections is refused; the last owner can't be removed or made staff.
7. Old `/manage/<BRAND_SLUG>/sessions/<id>` (and the other old paths) redirect to the new page.
8. A booking priced at the venue (price 0) can be marked paid with a typed amount; amounts ≤ 0 are refused.
9. Arrived works from 30 minutes before the start and not earlier; no-show not before the start; both undo.
10. A player can't cancel a paid booking or seat from My bookings; the desk can (and the payment is voided).

## 10. Testing

- **pgTAP:** `payments` access by section and role (including a mislabelled section), the one-live-payment rule,
  void-once, no delete, amount and method checks; the arrival/no-show timing and undo for spaces and seats; the
  player-cancel refusal for paid bookings; the description length check; the bucket limit.
- **Unit:** the timeline layout (which spaces and blocks sit where, a game spanning several spaces, a night
  past midnight), takings by business day, the colour readability check, the staff-sections rule, the old-path
  redirect map.
- **Integration:** recording, voiding and summing payments; cancel-voids-payment; Book for a customer through
  the walk-in path; editing staff sections; website fields saved and read by the landing page.
- **End-to-end (Playwright):** the owner books a walk-in from Today, marks them arrived and paid, and sees the
  cash in Takings; a turf-only staff member sees only turf on Today and gets "not found" on a café page.
- **In a real browser:** the contrast audit over every manage page; phone and laptop screenshots of each screen.

## 11. Out of scope

Online payments (Stage C: bKash), exports and charts (Stage D), staff shift scheduling, customer accounts
created by the desk (walk-ins stay name + phone), per-staff permissions finer than sections, notifications to
staff.
