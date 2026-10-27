# R2: The Public Site, Live and Energetic — Design

**Date:** 2026-10-28 · **Builds on:** `2026-10-25-one-brand-sections-design.md` (§5 The website, §7 stage R2)
**Status:** approved in conversation (look, pages, motion, routing, testing); this document is for review.

## 1. Goal and decisions

The public site is plain. R2 rebuilds it as the brand's own site (one host, a page per section) with a
look that feels live and energetic, true to one place that runs a turf, a board-game café and a gaming lounge.

| Topic | Decision (user, 2026-10-28) |
|---|---|
| Scope | **Public site first**, built as R2. The manage area keeps working and is restyled in R3. |
| Direction | **A · Floodlight night**, toned down to **A1 · Matte colour**: dark arena, tall uppercase headlines, each section a soft flat colour (side line, name, main button). No glow, no neon, no stripes. |
| Imagery | **Photos**, one per section kind, from free-licence sources (Unsplash / Pexels). The client has no photos yet; swapping a file replaces one. |
| Approach | Build R2 per the one-brand spec with the A1 look; design tokens and shared components first. |
| Audience | Players, on phones first (Bangladesh is mobile-first); desktop gets the same pages, wider. |

## 2. The look

**Dark only.** Tokens (CSS variables in `app/globals.css`, mapped onto the existing shadcn names so every
component, including the manage area, picks them up):

| Token | Value | Use |
|---|---|---|
| background | `#0f1115` | page |
| card | `#171a21` | cards, inputs |
| raised | `#1d2129` | sticky bars, pills |
| border | `#2b313b` | outlines, dividers |
| foreground | `#eef0f3` | text |
| muted-foreground | `#aab2bb` | secondary text |
| warning | `#e0a43a` | "almost full" |

**Section colours (matte):** turf `#43a66b`, café `#2e9e93`, lounge `#8a78e6`. A page or card sets
`--section` from `sections.accent`; everything section-coloured reads it (side line, name, main button,
"seats left", focus ring). Buttons in a section colour carry dark text (`#0f1115`).

**Type:** headlines in **Anton** (uppercase, tight), everything else in **Inter**, both via `next/font/google`
(served with the site).

**Photos:** `apps/web/public/sections/{turf,cafe,lounge}.jpg` (≤ 250 KB each, ~1600 px wide), shown through
`next/image` behind a dark gradient overlay. Their source and licence go in `public/sections/CREDITS.md`.
Photos are chosen by section **kind**; per-section uploads are R3.

**Accessibility:** WCAG AA (4.5:1) for every text/background pair and for dark text on each section colour;
visible focus rings; `prefers-reduced-motion` turns animation off.

### Shared components (`components/site/`)

| Component | What it shows |
|---|---|
| `SectionCard` | Side line, name, today's hours, next game with seats left, main + secondary buttons (wording per kind). |
| `GameCard` | Time, game (or "Pick at the table"), section colour, `SeatsBar`, Join. |
| `SeatsBar` | Filled share of seats; amber at **2 seats or fewer**; "7 of 10 in · 3 seats left". |
| `StatusPill` | e.g. "Open till 11 PM" / "Closed today", with a soft blinking dot when open. |
| `SectionHeader` | Photo + overlay, name, today's hours, status pill, quick actions. |
| `SlotChip` | A time slot: free, taken (struck out), open play, selected (filled + ✓). |
| `Button` variants | Solid section colour; outline (ghost). |
| `SiteNav` | Phone: bottom tab bar Home · Turf · Café · Lounge · Me (section tabs tinted). Desktop: top bar with brand, the three sections in their colours, My bookings, bell, Profile / Sign in. |

**Kind wording** (one map, in `messages/en.ts`): main action "Join match" / "Grab a seat" / "Squad up";
secondary "Book pitch" / "Book table" / "Book a PC"; games called "open matches" / "game nights" / "squad sessions".

## 3. Pages

All on one host; section addresses are the section slugs (`/turf`, `/cafe`, `/lounge`; reserved words are
already refused by the slug check).

| Address | Content |
|---|---|
| `/` | Brand name, status pill (the brand's hours today: earliest open to latest close across sections), address. **Coming up**: game cards across all sections in the next 14 days (soonest first, sideways scroll). The **three section cards**. |
| `/<section>` | `SectionHeader`; **open games** (game cards); **Book a space**; **what you can play** (game tags with player counts); the week's hours. |
| `/<section>/book` | Space tags (sideways); a day strip showing 7 days at a time from today, with previous/next arrows that stop at the section's booking window; the slot grid; a sticky bottom bar with the selection, price and **Book**. Same booking rules as today. |
| `/sessions/<id>` | Header in the section colour; time, price, `SeatsBar`; one action at a time (request · rate your level first → `/me` · withdraw · answer the offer · cancel your seat); your team once seated. |
| `/me` | Name, phone, email opt-in; **level per section** as a 1–5 selector in each section's colour ("Not rated" allowed); favourites; availability. |
| `/me/bookings`, `/me/notifications` | Rows from every section, each with that section's colour line and name. |
| `/offers/<token>`, `/me/offers/<id>` | Same behaviour, new components. |
| `/signin` | One centred card: Google + email link. |
| unknown section | A styled 404. |

## 4. Motion and the live feel

CSS only (no animation library; `tw-animate-css` is already present).

- Cards fade in and rise ~12 px, **60 ms** apart, on first load.
- The "open" dot and the dot on games that are filling blink softly (opacity, 2 s).
- `SeatsBar` fills on load (≈1 s ease-out).
- Buttons scale to 0.96 when pressed and brighten slightly on hover; a chosen slot fills with the section colour and shows ✓.
- `/`, `/<section>` and `/sessions/<id>` call `router.refresh()` every **30 s** while the tab is visible (a small client component), so seats and games stay current without new data access. The bell stays live (Realtime) as today.
- `prefers-reduced-motion: reduce` turns all of the above off except the refresh.

The motion was shown and approved in the visual companion (`.superpowers/brainstorm/…/motion.html`).

## 5. Routing and removals

- **One host.** `proxy.ts` keeps refreshing the session but stops mapping `<slug>.<root>` to `/t/[slug]`;
  the brand is served at the root from `getBrand()` (`BRAND_SLUG`). One host means one sign-in for the whole site.
  If the brand isn't found or isn't live, every public page shows a plain "Not open yet" page.
- **Public routes move** from `app/t/[slug]/…` to the root (`app/(site)/…`); page logic reuses the existing
  `lib/` functions (bookings, open play, profiles, notifications, sections).
- **Links in emails and notifications** are built against the root URL (`/sessions/<id>`, `/offers/<token>`,
  `/me/bookings`) instead of the venue subdomain.
- **Removed:** the platform landing page, `/onboarding` (wizard and actions), the "Your venues" list,
  `/admin` (UI and its platform-admin checks), `app/t/[slug]`, the unavailable-host page, and UI components used only
  by them. **Kept:** `lib/orgs/create-organization.ts`, `publish.ts` and the `platform_admins` table — integration
  tests build their venues with them, and dropping a table is not worth a migration. `lib/admin/platform.ts` goes
  with `/admin` (its tests too).
- **Manage area:** `/manage` opens the brand (`/manage/<brand slug>`) instead of a venue list; pages keep working
  with the dark tokens, with a pass to fix anything unreadable. Its redesign is R3.

## 6. Data change

One migration: `private.kind_accent` returns the matte colours (turf `#43a66b`, café `#2e9e93`, lounge `#8a78e6`),
and sections whose `accent` is still an old default (`#15803D`, `#0F766E`, `#7C3AED`) are updated to the new one.
A colour an owner changed by hand is left alone. Nothing else in the schema changes.

## 7. Testing and done

- **Unit:** token contrast (every text/background pair and dark text on each section colour ≥ 4.5:1);
  `SeatsBar` level (amber at ≤ 2); the 7-day strip (today … the section's window, nothing past it);
  section and booking link helpers; the proxy no longer rewrites `<slug>.localhost`.
- **Integration (local database):** the home data loader (next games per section with seats left, soonest first);
  notification and email links built on the root URL; an unknown section → 404; existing booking, open-play and
  profile flows unchanged.
- **pgTAP:** `kind_accent` defaults; the migration updates only sections still on an old default.
- **End to end (spec R2 "done when"):** in a real browser a player signs in **once**, then books a space and joins a
  game **in each of the three sections**. Driven by a script (Claude Code's browser tool makes `next dev` reload in a
  loop), then clicked through by the user.
- **Done when:** the end-to-end check passes; the full suite is green (typecheck, lint, build, unit, pgTAP, advisors,
  race, integration, replay diff); pages match A1 at phone and desktop width; removed pages are gone; a fresh
  review finds nothing Critical or Important left open.

## 8. Not in R2

The manage-area redesign and section switcher (R3); owner photo/logo uploads per section (R3); a light theme;
Bangla; payments (Stage C); deployment (Stage E). Hosted rollout of the migration and `BRAND_SLUG` routing
happens after merge, with the user's go-ahead.
