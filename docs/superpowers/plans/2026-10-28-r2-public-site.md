# R2 Public Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public site as the brand's own one-host site (home, a page per section, booking, games, profile) in the approved A1 "matte night" look.

**Architecture:** The proxy stops routing venue subdomains; public pages move from `app/t/[slug]` to a root route group `app/(site)` that reads the brand from `getBrand()` (`BRAND_SLUG`). Pure helpers (`lib/site/*`) carry the logic that tests pin (hours, day window, seats level, routing, contrast); presentational components live in `components/site/*`; page data reuses the existing `lib/` functions plus two loaders (`seatCounts`, `loadComingUp`). Dark design tokens replace the light ones in `globals.css`, so the manage area follows without its own redesign (R3).

**Tech Stack:** Next.js 16.4.2 (App Router, `next/font`, `next/image`), React 19.3, Tailwind 4 + shadcn tokens, Supabase (local stack for tests), Vitest 5, pgTAP, Playwright (new dev dependency, end-to-end only).

**Spec:** `docs/superpowers/specs/2026-10-28-r2-public-site-design.md` (builds on `2026-10-25-one-brand-sections-design.md` §5).

## Global Constraints

- Branch `r2-public-site`; run `git branch --show-current` before every commit (another session may share this folder).
- Dark only. Tokens: background `#0f1115`, card `#171a21`, raised `#1d2129`, border `#2b313b`, foreground `#eef0f3`, muted-foreground `#aab2bb`, warning `#e0a43a`; text on a section colour is `#0f1115`.
- Section colours: turf `#43a66b`, café `#2e9e93`, lounge `#8a78e6`; a page/card sets `--section` from `sections.accent`.
- Fonts: Anton (headlines, uppercase) and Inter (everything else) via `next/font/google` only.
- WCAG AA: every text/background pair ≥ 4.5:1; visible focus rings; `prefers-reduced-motion` disables animation (not the 30 s refresh).
- Kind wording (exact): join "Join match" / "Grab a seat" / "Squad up"; book "Book pitch" / "Book table" / "Book a PC"; games "open matches" / "game nights" / "squad sessions".
- All user-facing copy in `apps/web/messages/en.ts`.
- No new runtime dependencies. Dev dependency `@playwright/test` only, pinned to the newest release that is at least 14 days old (`npm view @playwright/test time`).
- Photos: `public/sections/{turf,cafe,lounge}.jpg`, ≤ 250 KB, ~1600 px wide, Unsplash or Pexels licence, recorded in `public/sections/CREDITS.md`.
- Migrations are new files; a recreated function copies its latest definition (generated, asserted substitutions).
- Server actions establish who is asking before using the service client; no new data access is opened to anon.
- Never drive pages with Claude Code's Playwright MCP browser (its `.playwright-mcp/` logs make `next dev` reload forever); use scripts or the e2e suite, whose output goes to the OS temp dir.

## Review Focus

1. **Old venue links** (emails sent before R2, bookmarks such as `http://chattoturf.localhost:3000/me/bookings?x=1`) should land on the same page of the one site, not a 404. Pinned in Task 5 (`routeRequest` redirect test).
2. **A section with nothing on** (no games coming up, closed today) should show "No games yet" / "Closed today", not an empty or broken card. Pinned in Task 3 (`statusNow` closed) and Task 4 (`loadComingUp` returns `[]`).
3. **Overnight hours after midnight** (lounge 14:00–02:00, now 01:00) should read "Open till 2 AM", not "Closed". Pinned in Task 3.
4. **A second section of one kind** (`/turf-2`) should open its own page; a reserved word (`/me`) is never a section. Pinned in Task 4 (`findSection`).
5. **A full game** (0 seats left) should say so and offer the waitlist instead of a dead Join button. Pinned in Task 3 (`seatsLevel(0) === 'full'`) and rendered in Task 7 (`GameCard` copy `m.site.full`).

---

### Task 1: Dark tokens, fonts and contrast

**Files:**
- Create: `apps/web/lib/site/tokens.ts`, `apps/web/lib/site/contrast.ts`, `apps/web/test/site-tokens.test.ts`
- Modify: `apps/web/app/globals.css` (`:root` values; drop the `.dark` block), `apps/web/app/layout.tsx` (fonts; no `PLATFORM_PALETTE` style)

**Interfaces:**
- Produces: `TOKENS: { background, card, raised, border, foreground, mutedForeground, warning, onSection }` (hex strings, values from Global Constraints); `SECTION_COLOURS: Record<BusinessType, string>`; `contrastRatio(a: string, b: string): number` (WCAG 2.x relative luminance).
- CSS variables: shadcn names map to tokens — `--background`, `--foreground`, `--card`/`--popover` = card, `--card-foreground`/`--popover-foreground` = foreground, `--primary` = foreground, `--primary-foreground` = `#0f1115`, `--secondary`/`--muted`/`--accent` = raised, `--muted-foreground`, `--border`/`--input` = border, `--ring` = muted-foreground; new `--raised`, `--warning`, `--section` (default turf). `--font-sans` = Inter, new `--font-display` = Anton (Tailwind `font-display`).

- [ ] **Step 1: Write the failing test** `test/site-tokens.test.ts`
  - `contrastRatio('#000000', '#ffffff')` → `toBeCloseTo(21, 1)`.
  - "every text colour reads on every surface": foreground and mutedForeground on background, card and raised ≥ 4.5; warning on card ≥ 4.5.
  - "section colours read both ways": for each `SECTION_COLOURS` value, `contrastRatio(TOKENS.onSection, c) ≥ 4.5` and `contrastRatio(c, TOKENS.card) ≥ 4.5`.
  - "globals.css uses the same values": read `app/globals.css`; for each of `--background --card --raised --border --foreground --muted-foreground --warning` the declared hex equals the token (case-insensitive).
- [ ] **Step 2: Run** `pnpm --filter web test -- site-tokens` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `tokens.ts`, `contrast.ts`, the `globals.css` `:root` values (hex) and `layout.tsx` fonts (`Anton({ weight: '400', subsets: ['latin'], variable: '--font-display' })`, `Inter({ subsets: ['latin'], variable: '--font-sans' })`; remove Geist and the `style={brandingToCssVars(...)}` on `<html>`).
- [ ] **Step 4: Run** `pnpm --filter web test -- site-tokens && pnpm typecheck && pnpm --filter web build` — Expected: PASS, build compiles.
- [ ] **Step 5: Commit** `feat(web): dark design tokens, Anton and Inter`

### Task 2: Matte section colours in the database

**Files:**
- Create: `supabase/migrations/20261028010000_matte_section_colours.sql`, `supabase/tests/database/18_matte_colours.test.sql`
- Modify: `supabase/tests/database/14_sections.test.sql` (accent expectations), `apps/web/test/integration/{sections,organizations,brand}.test.ts` (accent expectations)

**Interfaces:**
- Produces: `private.kind_accent(kind)` returns `#43a66b` / `#2e9e93` / `#8a78e6` (turf / café / lounge).

- [ ] **Step 1: Write the failing test** `18_matte_colours.test.sql` (plan 5): `kind_accent` returns the three new values; `add_section` on a fresh test org gives the new turf colour; "no section keeps an old default": `count(*) from sections where upper(accent) in ('#15803D','#0F766E','#7C3AED')` is 0. Update the other expectations to the new values.
- [ ] **Step 2: Run** `pnpm db:test` — Expected: FAIL on 18 and the updated 14.
- [ ] **Step 3: Implement the migration**: `create or replace function private.kind_accent` with the new values; `update public.sections set accent = <new> where kind = <kind> and upper(accent) = <old default>` for each kind (a hand-changed colour stays).
- [ ] **Step 4: Verify the "hand-changed stays" rule** before applying: `update sections set accent = '#123456' where slug = 'cafe'` on the local Demo Arena; `pnpm exec supabase migration up --local`; expect café still `#123456`, turf `#43a66b`, lounge `#8a78e6`; then set café back with `update … set accent = '#2e9e93'`.
- [ ] **Step 5: Run** `pnpm db:test && pnpm db:lint && pnpm --filter web exec vitest run --config vitest.integration.config.ts sections organizations brand` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(db): matte section colours`

### Task 3: Site helpers (pure)

**Files:**
- Create: `apps/web/lib/site/hours.ts`, `lib/site/days.ts`, `lib/site/seats.ts`, `lib/site/paths.ts`, `lib/site/kinds.ts`, `apps/web/test/site-helpers.test.ts`
- Modify: `apps/web/messages/en.ts` (new `m.site`)

**Interfaces:**
- `statusNow(hours: OpeningHours[], timeZone: string, now: Date): { state: 'open'; until: string } | { state: 'later'; opens: string } | { state: 'closed' }` — `until`/`opens` are local `HH:MM`; with several sections: open if any is open now (until = the latest close among those open, overnight closes count as later than same-day ones); else the earliest opening later today; else closed. Overnight hours of yesterday still open after midnight count.
- `dayWindow(today: string, horizonDays: number, start?: string): { days: string[]; prev: string | null; next: string | null }` — up to 7 dates from `start` (a `start` before today or past the last day is treated as today), last day = today + horizonDays; `prev` = start − 7 clamped to today (null when start is today); `next` = start + 7 (null when past the last day).
- `seatsLevel(left: number): 'plenty' | 'low' | 'full'` — 0 → full, 1–2 → low, else plenty.
- `sectionPath(slug: string): string`; `bookPath(slug: string, q?: { resource?: string; date?: string }): string`.
- `kindWords(kind: BusinessType): { join: string; book: string; games: string; noGames: string }`; `sectionPhoto(kind: BusinessType): '/sections/turf.jpg' | '/sections/cafe.jpg' | '/sections/lounge.jpg'`.
- `m.site`: `kinds` (the exact wording in Global Constraints; `noGames`: "No open matches yet" / "No game nights yet" / "No squad sessions yet"), `openUntil(time)`, `opensAt(time)`, `closedToday` "Closed today", `seats(taken, total)` "7 of 10 in", `left(n)` "3 seats left", `full` "Full · join the waitlist", `comingUp` "Coming up", `bookSpace` "Book a space", `whatYouCanPlay` "What you can play", `hoursThisWeek` "Hours this week", `notOpen` "Not open yet", `nav` (`home` "Home", `me` "Me").

- [ ] **Step 1: Write the failing tests** (`Asia/Dhaka`; Friday 2026-10-30):
  - `statusNow([10–23], tz, 14:00)` → `{ state: 'open', until: '23:00' }`; at 09:00 → `{ state: 'later', opens: '10:00' }`; at 23:30 → `{ state: 'closed' }`; a null day → closed.
  - **RF3** `statusNow([14:00–02:00], tz, Sat 2026-10-31 01:00)` → `{ state: 'open', until: '02:00' }`; `statusNow([10–23, 14–02], tz, Fri 22:30)` → `until: '02:00'`.
  - `dayWindow('2026-10-28', 14)` → days `2026-10-28 … 2026-11-03`, `prev: null`, `next: '2026-11-04'`; with start `'2026-11-04'` → days `11-04 … 11-10`, `prev: '2026-10-28'`, `next: '2026-11-11'`; start `'2026-11-11'` → days `['2026-11-11']`, `next: null`; `dayWindow('2026-10-28', 3)` → 4 days ending `2026-10-31`, `next: null`; start `'2026-10-01'` → same as today.
  - **RF5** `seatsLevel(0) === 'full'`, `seatsLevel(1)`/`(2) === 'low'`, `seatsLevel(3) === 'plenty'`.
  - `bookPath('turf', { resource: 'r1', date: '2026-10-30' }) === '/turf/book?resource=r1&date=2026-10-30'`; `sectionPath('turf-2') === '/turf-2'`.
  - `kindWords('gaming_lounge')` equals `{ join: 'Squad up', book: 'Book a PC', games: 'squad sessions', noGames: 'No squad sessions yet' }`; `sectionPhoto('boardgame_cafe') === '/sections/cafe.jpg'`.
- [ ] **Step 2: Run** `pnpm --filter web test -- site-helpers` — Expected: FAIL.
- [ ] **Step 3: Implement** the five modules and `m.site` (hours via `Intl.DateTimeFormat` in the given zone, like `lib/bookings/slots.ts`).
- [ ] **Step 4: Run** `pnpm --filter web test -- site-helpers` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): site helpers for hours, days, seats and paths`

### Task 4: Site data — seats, coming up, the signed-in player, root links

**Files:**
- Create: `apps/web/lib/site/home.ts`, `apps/web/test/integration/site.test.ts`
- Modify: `apps/web/lib/open-play/open-play.ts` (`seatCounts`; `seatsLeft` keeps its signature and wraps it), `apps/web/lib/tenancy/player.ts` (`getSitePlayer`), `apps/web/lib/notifications/deliver.ts` (`siteUrl: rootUrl()`), `apps/web/lib/tenancy/urls.ts` (delete `tenantUrl` once unused — callers change in Tasks 7–10; keep it until Task 10), `apps/web/test/integration/deliver.test.ts`, `apps/web/test/notification-email.test.ts` (root URLs)

**Interfaces:**
- `seatCounts(db, { organizationId, sessionIds }): Promise<Map<string, { left: number; total: number }>>` — total = before matching what the spaces could seat (today's rule), after matching the groups' capacity; left as `seatsLeft` today.
- `interface UpcomingGame { id: string; sectionId: string; startsAt: string; endsAt: string; activityName: string | null; pricePoisha: number; left: number; total: number }`
- `loadComingUp(db, { organizationId: string; now?: Date; days?: number /* 14 */ }): Promise<UpcomingGame[]>` — `open`/`matched` sessions starting after `now` and before `now + days`, soonest first.
- `findSection(sections: Section[], slug: string): Section | null`
- `getSitePlayer: () => Promise<{ user: SessionUser; brand: Brand; profileId: string | null } | null>` (React `cache`; null when signed out or no live brand). `getPlayer(slug)` stays until Task 10 removes its callers.

- [ ] **Step 1: Write the failing tests** `site.test.ts` (a fresh brand from `setupBrand(db, { slug, name, presets, demo: true })`, cleanup like `brand.test.ts`):
  - "lists games coming up across sections, soonest first, with seats": three games ordered café (day 2, 19:00), turf (day 2, 20:00), lounge (day 3); counts café `{ left: 2, total: 8 }`, turf `{ left: 0, total: 10 }`, lounge `{ left: 4, total: 10 }`.
  - "leaves out games past the window, started or cancelled": `days: 1` → `[]`; cancel the lounge game (`cancelOpenPlay`) → it is gone.
  - **RF2** a brand with sections but no sessions → `[]`.
  - **RF4** `findSection` finds `turf`, finds `turf-2` after `add_section(org, 'turf', 'Second turf')`, and returns null for `'me'` and `'nope'`.
  - `deliver.test.ts`: emails link to `http://localhost:3000/me/bookings` and `http://localhost:3000/offers/<token>` (no `<slug>.localhost`); `notification-email.test.ts` uses `siteUrl: 'http://localhost:3000'`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run --config vitest.integration.config.ts site deliver && pnpm --filter web test -- notification-email` — Expected: FAIL.
- [ ] **Step 3: Implement** `seatCounts`, `loadComingUp`, `findSection`, `getSitePlayer`, root `siteUrl`.
- [ ] **Step 4: Run** the Step 2 command plus `open-play` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): coming-up games, seat counts and root links`

### Task 5: One host

**Files:**
- Create: `apps/web/lib/site/route.ts`, `apps/web/test/route.test.ts`
- Modify: `apps/web/proxy.ts`, `apps/web/lib/auth/redirect.ts`, `apps/web/app/auth/callback/route.ts`, `apps/web/test/redirect.test.ts`
- Delete: `apps/web/lib/tenancy/host.ts`, `apps/web/test/host.test.ts`

**Interfaces:**
- `routeRequest(host: string | null, url: URL, rootDomain: string): { kind: 'next' } | { kind: 'redirect'; location: string } | { kind: 'not_found' }` — root or `www.<root>` → next; any `<labels>.<root>` → 308 redirect to the same path and query on the root (protocol `http` for `localhost…`, else `https`); `/t` or `/t/…` → not_found; hosts outside the root domain (previews) → next.
- `requestOrigin(host, requestUrl, rootDomain)` trusts the Host header only when it is the root or `www.<root>`; otherwise `requestUrl`'s origin.
- The callback always accepts pending invites after a successful sign-in (one host).

- [ ] **Step 1: Write the failing tests** `route.test.ts`:
  - **RF1** `routeRequest('chattoturf.localhost:3000', new URL('http://localhost:3000/me/bookings?x=1'), 'localhost:3000')` → `{ kind: 'redirect', location: 'http://localhost:3000/me/bookings?x=1' }`; `'a.b.localhost:3000'` redirects too.
  - `'localhost:3000'` with `/turf` → next; `/t/chattoturf` → not_found; `'preview-123.vercel.app'` → next.
  - `redirect.test.ts`: `requestOrigin('chattoturf.localhost:3000', 'http://localhost:3000/auth/callback', 'localhost:3000') === 'http://localhost:3000'`; `requestOrigin('localhost:3000', …)` keeps `localhost:3000`.
- [ ] **Step 2: Run** `pnpm --filter web test -- route redirect` — Expected: FAIL.
- [ ] **Step 3: Implement** `route.ts`; `proxy.ts` refreshes the session, then acts on `routeRequest` (redirect with status 308 carrying the session cookies, `not_found` rewrites to a path with no page); `requestOrigin`; the callback; delete `host.ts` and its test.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): one host; old venue links redirect to the site`

### Task 6: Shared components, motion and photos

**Files:**
- Create: `apps/web/components/site/{site-nav.tsx, section-card.tsx, game-card.tsx, seats-bar.tsx, status-pill.tsx, section-header.tsx, slot-chip.tsx, auto-refresh.tsx, section-style.ts}`, `apps/web/public/sections/{turf,cafe,lounge}.jpg`, `apps/web/public/sections/CREDITS.md`, `apps/web/test/site-photos.test.ts`
- Modify: `apps/web/components/ui/button.tsx` (variants `section` and `ghost`), `apps/web/app/globals.css` (motion)

**Interfaces:**
- `sectionStyle(accent: string): CSSProperties` → `{ '--section': accent }`.
- `SiteNav({ brandName, sections: Pick<Section,'slug'|'name'|'accent'>[], signedIn, profileId, organizationId, unread })` — phone bottom tab bar (Home · each section · Me, active tab tinted) + desktop top bar (brand, sections in their colours, My bookings, bell, Profile / Sign in).
- `SectionCard({ section: Section, status: ReturnType<typeof statusNow>, next: UpcomingGame | null, timeZone })` — side line, Anton name, status, next game or `noGames`, buttons `join` → game page (or section page when none) and `book` → `bookPath`.
- `GameCard({ game: UpcomingGame, sectionName, accent, timeZone, href })`; `SeatsBar({ left, total })` (amber at `seatsLevel` low; full shows `m.site.full`); `StatusPill({ status })`; `SectionHeader({ section, status, kind })` (`next/image` photo + gradient overlay); `SlotChip({ state: SlotState | 'selected', label, ... })`.
- `AutoRefresh({ seconds = 30 })` (client): `router.refresh()` on an interval while `document.visibilityState === 'visible'`.
- Motion CSS (spec §4): `.rise` (12 px, staggered by `--i` × 60 ms), `.blink` (opacity, 2 s), `.fill` (width 1 s ease-out), button press `scale(.96)`; all inside `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 1: Write the failing test** `site-photos.test.ts`: each of `turf.jpg cafe.jpg lounge.jpg` exists in `public/sections`, starts with the JPEG magic bytes `ff d8`, is ≤ 250 KB; `CREDITS.md` names each file with a source URL and the words "Unsplash License" or "Pexels License".
- [ ] **Step 2: Run** `pnpm --filter web test -- site-photos` — Expected: FAIL.
- [ ] **Step 3: Source the photos** (a floodlit football/futsal pitch; a board-game table with players' hands; a gaming PC room) from Unsplash (`https://images.unsplash.com/photo-…?w=1600&q=70&fm=jpg`) or Pexels (`?auto=compress&w=1600`); save, check size, write `CREDITS.md` (file · photographer · source URL · licence).
- [ ] **Step 4: Implement** the components, button variants and motion CSS; all copy from `m.site` / `kindWords`.
- [ ] **Step 5: Run** `pnpm --filter web test -- site-photos && pnpm typecheck && pnpm --filter web lint` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(web): site components, motion and section photos`

### Task 7: Site shell, home and section pages

**Files:**
- Create: `apps/web/app/(site)/layout.tsx`, `apps/web/app/(site)/page.tsx`, `apps/web/app/(site)/[section]/page.tsx`, `apps/web/components/site/not-open.tsx`
- Modify: `apps/web/app/not-found.tsx` (styled 404: `m.site.notFound` "Not on the board" and a link home), `apps/web/app/layout.tsx` (metadata title from the brand: `generateMetadata` → `getBrand()?.name`)
- Delete: `apps/web/app/(root)/page.tsx` (platform landing)

**Interfaces:**
- Consumes: `getBrand`, `getSitePlayer`, `loadSections`/`Brand.sections`, `loadComingUp`, `findSection`, `statusNow`, Task 6 components.
- Layout: `getBrand()` null → `NotOpen`; else `SiteNav` + `children` (+ bottom padding for the phone tab bar).
- Home: brand name (Anton), `StatusPill` from all sections' hours, address, **Coming up** (`GameCard`s from `loadComingUp`, sideways scroll), three `SectionCard`s (next game = first coming-up game of that section), `AutoRefresh`.
- Section page: `findSection` → `notFound()`; `SectionHeader`; open games of that section (`GameCard`s or `noGames`); **Book a space** (`bookPath`); what you can play (active games of the section with `m.manage.players` / `m.manage.versus`); hours this week; `AutoRefresh`.

- [ ] **Step 1: Write the check** (the pages are server components without a DOM test setup, so the check is a scripted request): add `apps/web/scripts/smoke-site.mjs` that GETs paths on `http://localhost:3000` (signed out, following redirects) and asserts that each response contains the given texts, from arguments `path|text1;text2`; it prints `ok` or the first failure and exits non-zero. (Status codes are not asserted: pages render inside Suspense, so a streamed `notFound()` arrives with status 200.)
- [ ] **Step 2: Run it before the pages exist** with the dev server up and Demo Arena loaded:
  `node apps/web/scripts/smoke-site.mjs "/|Coming up;Join match;Grab a seat;Squad up" "/turf|Book a space;5-a-side futsal;Full · join the waitlist" "/turf-9|Not on the board" "/cafe|Pick at the table"` — Expected: FAIL (`/` is still the platform landing). The turf demo game has 11 requests for 10 seats, so its card must read "Full · join the waitlist" (**RF5**).
- [ ] **Step 3: Implement** the layout, home, section page, `NotOpen`, the 404 and the metadata; delete the platform landing.
- [ ] **Step 4: Run** the Step 2 command — Expected: `ok`. Then `pnpm typecheck && pnpm --filter web lint`.
- [ ] **Step 5: Commit** `feat(web): site shell, brand home and section pages`

### Task 8: Booking, game and offer pages

**Files:**
- Create (moved from `app/t/[slug]/…`, rewritten without `slug`): `apps/web/app/(site)/[section]/book/{page.tsx,actions.ts}`, `apps/web/app/(site)/sessions/[id]/{page.tsx,actions.ts}`, `apps/web/app/(site)/offers/[token]/{page.tsx,actions.ts}`, `apps/web/app/(site)/offers/reply.ts`, `apps/web/app/(site)/me/offers/[id]/{page.tsx,actions.ts}`
- Modify: `apps/web/components/bookings/slot-picker.tsx` (`SlotChip`s, sticky bar), `apps/web/components/open-play/offer-card.tsx` (new look)

**Interfaces:**
- Actions take no slug and use `getSitePlayer()`: `bookSpaceAction(resourceId: string, _state, form)`, `requestSeatAction(sessionId: string, _state, _form)`, `withdrawAction(sessionId: string, _state, _form)`, offer replies as today minus `slug`. Outcomes and messages unchanged.
- Booking page: the section from the route (`findSection` → 404); spaces of that section only; `dayWindow(today, section.rules.bookingHorizonDays, ?start)` drives the day strip (`?start=` param), `?resource=` and `?date=` as today; the sticky bar shows the chosen slot, its price and **Book**.
- Game page: header in the session's section colour; `SeatsBar`; one action per state (request · rate your level first → `/me` · withdraw · offer → `/me/offers/<id>` · cancel); your team once seated; `AutoRefresh`.

- [ ] **Step 1: Write the check**: extend the smoke run with `"/turf/book|Pitch 1;Book pitch" "/cafe/book|Table 1"`, `"/lounge/book?date=2099-01-01|PC Zone A"` (a far date falls back to today) and a game page taken from the first game link on `/cafe` (`/sessions/<id>|seats left`).
- [ ] **Step 2: Run** — Expected: FAIL (routes missing).
- [ ] **Step 3: Implement** the pages and actions (logic from the `app/t/[slug]` versions; the old files stay until Task 10).
- [ ] **Step 4: Run** the smoke check, `pnpm typecheck`, `pnpm --filter web lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): booking, game and offer pages on the site`

### Task 9: Profile, My bookings, notifications and sign-in

**Files:**
- Create: `apps/web/app/(site)/me/{page.tsx,actions.ts}`, `apps/web/app/(site)/me/bookings/{page.tsx,actions.ts}`, `apps/web/app/(site)/me/notifications/{page.tsx,actions.ts}`, `apps/web/app/(site)/signin/page.tsx`, `apps/web/components/profile/rating-picker.tsx`
- Delete: `apps/web/app/(root)/signin/page.tsx`

**Interfaces:**
- `RatingPicker({ section: Pick<Section,'id'|'name'|'accent'>, value: number | null })` — a radio group named `rating.<sectionId>` with "Not rated" (`''`) and 1–5 (`m.profile.skillLevels`), selected option filled in the section colour; feeds `parseProfileForm(formData, sectionIds)` unchanged.
- Sign-in: one page for everyone; `next` defaults to `/` (staff invite emails keep `next=/manage`); shows Google when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`.
- My bookings / notifications: rows across sections with the section's colour line and name; cancel actions as today without `slug`.

- [ ] **Step 1: Write the check**: smoke `"/signin|Email me a sign-in link"` (the Google button is off locally); the signed-in pages are covered by Task 11's journey.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the pages, actions and `RatingPicker`; delete the root sign-in page.
- [ ] **Step 4: Run** the smoke check, `pnpm typecheck`, `pnpm --filter web lint`, `pnpm --filter web exec vitest run --config vitest.integration.config.ts profiles` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): profile with ratings per section, my bookings and sign-in`

### Task 10: Remove the old routes; manage on the dark look

**Files:**
- Delete: `apps/web/app/t/` (whole tree), `apps/web/app/(root)/onboarding/`, `apps/web/app/(root)/admin/`, `apps/web/components/tenant/`, `apps/web/components/onboarding/`, `apps/web/components/unavailable.tsx` (if only the old routes use it), `apps/web/lib/admin/platform.ts`, `apps/web/test/integration/platform-admin.test.ts`, `getLiveOrganization`/`getPlayer(slug)` and `tenantUrl` once unused; messages only those pages used (`m.onboarding`, `m.admin`, platform landing copy)
- Modify: `apps/web/app/(root)/manage/page.tsx` (redirect to `/manage/<brand slug>`, or a short message when no brand), `apps/web/app/(root)/manage/[slug]/layout.tsx` ("Public page" → `rootUrl('/')`), `apps/web/app/(root)/manage/[slug]/settings/page.tsx` (web address → `rootUrl()`), any manage component with hard-coded light colours

**Interfaces:**
- Kept on purpose: `lib/orgs/create-organization.ts`, `lib/orgs/publish.ts`, the `platform_admins` table (tests and the database use them).

- [ ] **Step 1: Write the check**: `grep -rn "app/t/\|/t/\[slug\]\|tenantUrl\|getLiveOrganization\|onboarding\|platform-admin" apps/web --include=*.ts --include=*.tsx` (excluding node_modules) must print nothing after the change; smoke `"/onboarding|Not on the board" "/admin|Not on the board"`.
- [ ] **Step 2: Run** — Expected: FAIL (the old routes exist).
- [ ] **Step 3: Delete and modify** as listed; walk the manage pages as the Demo Arena owner (smoke script with a session cookie, as in R1) and fix any text below 4.5:1 (hard-coded `bg-white`, `text-black`, light badges).
- [ ] **Step 4: Run** the grep (empty), the smoke check, `pnpm typecheck && pnpm --filter web lint && pnpm --filter web test && pnpm test:integration` — Expected: PASS.
- [ ] **Step 5: Commit** `refactor(web): remove the venue, onboarding and admin routes`

### Task 11: The end-to-end journey and wrap-up

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/r2-journey.spec.ts`
- Modify: `apps/web/package.json` (`test:e2e`; dev dependency `@playwright/test`), root `package.json` (`test:e2e`), `README.md`, `memory.md`

**Interfaces:**
- Config: `testDir: 'e2e'`, `baseURL: 'http://localhost:3000'`, `outputDir` and the HTML report under `os.tmpdir()` (never inside the repo), `webServer: { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true }`, chromium only, one worker.
- Needs: the local stack, `pnpm env:local`, `pnpm brand:setup --name "Demo Arena" --demo` (three open games).

- [ ] **Step 1: Write the journey** `r2-journey.spec.ts` ("a player signs in once, books a space and joins a game in each section"):
  1. A fresh address `e2e-<random>@example.test`; at `/signin` request the email link; read it from Mailpit (`GET http://127.0.0.1:54324/api/v1/search?query=to:<address>`, then the message's link); open it.
  2. On `/me`: display name, "3" for each of the three sections, save → "Saved".
  3. For each section `turf`, `cafe`, `lounge`: `/<section>/book` → pick tomorrow in the day strip → the first free slot → **Book** → the booked message; then `/<section>` → the first game card → **Request a seat** (or join the waitlist when full) → an outcome message from `m.openPlay.outcome`.
  4. Throughout, the page URL never returns to `/signin` after step 1 (one sign-in).
- [ ] **Step 2: Install and run** `pnpm --filter web add -D @playwright/test@<pinned>`; `pnpm --filter web exec playwright install chromium`; `pnpm test:e2e` — Expected: PASS (if a step fails, the cause is in Tasks 7–9; fix there).
- [ ] **Step 3: Full suite and replay**: `pnpm typecheck && pnpm test && pnpm --filter web lint && pnpm --filter web build && pnpm db:test && pnpm db:lint && pnpm test:race && pnpm test:integration && pnpm exec supabase db diff --local --schema public,private` — Expected: all pass; "No schema changes found". Remove `scripts/smoke-site.mjs` if Task 11's journey covers it, or keep it as `pnpm smoke` (documented).
- [ ] **Step 4: Docs**: README — one host (no subdomains; old venue links redirect), the public pages, `pnpm test:e2e`, photos and `CREDITS.md`, the hosted rollout of the colour migration after merge (`db push`). memory.md — R2 rulings, gotchas, change log.
- [ ] **Step 5: Commit** `docs: R2 public site notes` (and `test: R2 end-to-end journey` for the e2e files if committed separately).
