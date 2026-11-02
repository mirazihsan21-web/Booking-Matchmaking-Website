# Team and Player Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner and staff logins become venue-only with a My account page in Manage, and the player Profile becomes a read-only page with its own edit page.

**Architecture:** One sign-in for everyone; `getSitePlayer` already knows whether the account is on the brand's team, and the site, the sign-in landing, the player pages and the player actions branch on that. Team names and mobiles live on `organization_members` (new columns, filled by a `private` trigger). The profile page summarises the lists My bookings already loads through one pure function.

**Tech Stack:** Next.js 16.4.2 (App Router, cacheComponents, server actions), React 19, Supabase (Postgres 17, RLS, pgTAP), Vitest, Playwright. pnpm workspace; app in `apps/web`.

**Spec:** `docs/superpowers/specs/2026-11-02-team-and-player-accounts-design.md`

## Global Constraints

- Branch `team-and-player-accounts`; run `git branch --show-current` before every commit. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before writing Next.js code, read the matching guide in `apps/web/node_modules/next/dist/docs/` (AGENTS.md: this Next.js differs from training data).
- Tests run on the LOCAL stack: `pnpm env:local` (from `apps/web`), local Docker/Supabase up (`pnpm db:start`), dev server restarted. At the very end switch back: `pnpm env:hosted` and restart the dev server.
- Restart the dev server after any `messages/en.ts` change.
- No `security definer` function in `public`. New database functions go in `private`, `set search_path = ''`, with execute revoked from `public, anon, authenticated`.
- Schema changes are a new migration file; never edit an old one. Never run `pnpm db:reset` without need; apply with `pnpm exec supabase migration up --local`.
- Never print or commit secrets. The repo-root PDF and screenshots stay uncommitted.
- Phones use the players' parser `normalizePhone` (`lib/forms/profile.ts`) and its message `m.profile.phoneFormat`; names are 1–60 characters (`m.forms.required`, `m.forms.tooLong`).
- Exact copy (put in `messages/en.ts`):
  - Team note: `You're signed in as ${brand}'s team. Book walk-ins from Today.`; link labels `Open this space on Today`, `Open this game in Manage`, `Go to Today`.
  - Team refusal: `Team accounts can't book, take seats or keep a player profile here. Use Manage.`
  - Manage nav item: `My account`. Name fallback: `Team member`.
  - My account: title `My account`; fields `Name`, `Mobile number (optional)`; `Email` with `This is your sign-in. It can't be changed here.`; `How you sign in`: `Google` / `Email link` / `Google and email link`; `Role`; `Sections`: `All sections` (owner) or chips plus `The owner chooses your sections on the Staff page.` (staff; with none: `No sections yet.`); `On the team since ${date}`; save button `Save`; `Saved.`; `Couldn't save. Try again.`
  - Profile view: `No mobile number yet`, `Playing here since ${monthYear}`, `Edit profile`, `Your levels`, `Not rated: add a level to join its games.`, `Your play`, `Games played`, `Spaces booked`, `Next up`, `Nothing booked yet.`, `Find a game`, `Favourites`, `Usually plays`, `Booking emails: on` / `Booking emails: off`, status `Profile saved.`
  - Profile edit: headings `Edit your profile` / `Set up your player profile`, link `Back`.

## Review Focus

1. A `next` that only looks like a manage page (`/managers`, `/manage-x`) must not count as one: a team account lands on `/manage`. Test in Task 3.
2. A staff member with no sections yet: the team note's links go to Today, and My account says `No sections yet.`. Tests in Tasks 3 and 6.
3. A Google name that is blank or longer than 60 characters: the trigger and backfill fall back to the email prefix or cut to 60, never fail the insert. pgTAP in Task 1.
4. A player who already has a player profile and then joins the team: the site shows Manage (no bell, no Profile) and `/me` goes to My account. e2e in Task 8 (the staff user gets a player profile first).
5. A mobile typed as `017-1234 5678` saves as `+8801712345678` and is shown as `01712345678`. Tests in Tasks 2 and 5.

---

### Task 1: Team member names and mobiles in the database

**Files:**
- Create: `supabase/migrations/20261102010000_team_member_details.sql`
- Create: `supabase/tests/database/23_team_member_details.test.sql`

**Interfaces:**
- Produces: `public.organization_members.display_name text not null` (check `length(trim(display_name)) between 1 and 60`), `public.organization_members.phone text` (check `phone ~ '^\+[1-9][0-9]{6,14}$'`); `private.member_display_name(p_user_id uuid) returns text`; trigger `organization_members_fill_name` (`before insert`, fills `display_name` when null or blank).

- [ ] **Step 1: Write the failing pgTAP test** `23_team_member_details.test.sql` (`begin; … select plan(8); … rollback;`, ids in the `…23xx` range like other files), asserting:
  - `has_column('public','organization_members','display_name')` and `col_not_null(...)`; `has_column(... 'phone')`.
  - A user with `raw_user_meta_data = '{"full_name":"Miraz Ihsan"}'` added as a member gets `display_name = 'Miraz Ihsan'`.
  - `{"name":"Only Name"}` → `'Only Name'`.
  - No metadata, email `desk.person@test.local` → `'desk.person'`.
  - `{"full_name":"   "}` → the email prefix; a 70-character `full_name` → its first 60 characters.
  - An insert with `display_name => 'Chosen'` keeps `'Chosen'`.
  - `throws_ok` updating `phone` to `'01712345678'` (not E.164) with `23514`.
  - `ok(not has_function_privilege('authenticated', 'private.member_display_name(uuid)', 'execute'))`.

- [ ] **Step 2: Run it to see it fail**

Run (repo root): `pnpm exec supabase test db --local supabase/tests/database/23_team_member_details.test.sql`
Expected: FAIL (column `display_name` does not exist).

- [ ] **Step 3: Write the migration**
  - `add column phone text` with the check; `add column display_name text`.
  - `private.member_display_name(p_user_id uuid) returns text`, `language sql stable security definer set search_path = ''`: first non-blank of trimmed `raw_user_meta_data->>'full_name'`, `->>'name'`, `split_part(email,'@',1)`, then `'Team member'`; result `left(…, 60)`. Revoke execute from `public, anon, authenticated`.
  - Backfill `update public.organization_members set display_name = private.member_display_name(user_id)`; then `alter column display_name set not null` and add the length check.
  - Trigger function `private.fill_member_display_name()` (`returns trigger`, `security definer`, empty search_path, revoke as above): when `new.display_name` is null or blank, set it from `private.member_display_name(new.user_id)`. Trigger `organization_members_fill_name before insert … for each row`.
  - Comment the columns ("the team member's own name and mobile, shown on Staff and My account").

- [ ] **Step 4: Apply and run**

Run: `pnpm exec supabase migration up --local`, then the Step 2 command → PASS 8/8; then `pnpm db:test` (all pgTAP green) and `pnpm db:lint`.

- [ ] **Step 5: Check the schema replays clean**

Run: `pnpm exec supabase db diff --local` → "No schema changes found".

- [ ] **Step 6: Commit** — `feat(db): team members have their own name and mobile`

---

### Task 2: Who is signed in — name, photo and sign-in methods

**Files:**
- Modify: `apps/web/lib/auth/dal.ts` (`SessionUser`, `getUser`)
- Create: `apps/web/lib/account/identity.ts`
- Create: `apps/web/components/account/avatar.tsx`
- Modify: `apps/web/lib/forms/profile.ts` (add `displayPhone`)
- Test: `apps/web/test/account-identity.test.ts`, `apps/web/test/profile-form.test.ts`

**Interfaces:**
- Produces:
  - `SessionUser = { id: string; email: string | null; name: string | null; avatarUrl: string | null; providers: string[] }`. `getUser` reads them from the verified claims: `user_metadata.full_name ?? user_metadata.name`, `user_metadata.avatar_url ?? user_metadata.picture`, `app_metadata.providers` (strings only; default `[]`).
  - `initials(name: string): string` — up to two letters, upper case, from the first and last words; `'?'` for a blank name.
  - `signInMethods(providers: string[]): 'Google' | 'Email link' | 'Google and email link'` — `google` and `email` known; an empty list is `'Email link'`.
  - `displayPhone(e164: string): string` — `+880…` shown as local `0…`; others unchanged.
  - `<Avatar name: string; src: string | null; size?: 'sm' | 'lg' />` (client component): `<img referrerPolicy="no-referrer" alt="">` when `src`, falling back to initials in a circle on `onError` or without `src`.

- [ ] **Step 1: Write failing unit tests**
  - `initials('Miraz Ihsan') === 'MI'`, `initials('desk.person') === 'D'`, `initials('  ') === '?'`, `initials('Ana Maria Lopez') === 'AL'`.
  - `signInMethods(['google']) === 'Google'`, `(['email']) === 'Email link'`, `(['email','google']) === 'Google and email link'`, `([]) === 'Email link'`.
  - `displayPhone('+8801712345678') === '01712345678'`, `displayPhone('+447700900123') === '+447700900123'`, and `displayPhone(normalizePhone('017-1234 5678')!) === '01712345678'`.

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/account-identity.test.ts test/profile-form.test.ts` → FAIL (not defined).

- [ ] **Step 3: Implement** the functions, the `SessionUser` fields and the `Avatar` component (Tailwind tokens as `site-nav.tsx` uses; `sm` = `size-8`, `lg` = `size-16`).

- [ ] **Step 4: Run** the Step 2 command → PASS; `pnpm --filter web typecheck` → clean (every `SessionUser` builder compiles).

- [ ] **Step 5: Commit** — `feat(web): the signed-in person's name, photo and sign-in methods`

---

### Task 3: Team accounts land in Manage and the site shows them Manage

**Files:**
- Modify: `apps/web/lib/auth/redirect.ts` (`landingAfterSignIn`)
- Modify: `apps/web/lib/tenancy/player.ts` (`getSitePlayer`, new `requirePlayer`)
- Create: `apps/web/lib/manage/team-links.ts`
- Modify: `apps/web/components/site/site-chrome.tsx`, `apps/web/components/site/site-nav.tsx`
- Modify: `apps/web/app/(site)/me/page.tsx`, `me/bookings/page.tsx`, `me/notifications/page.tsx`, `me/offers/[id]/page.tsx` (guard)
- Test: `apps/web/test/redirect.test.ts`, `apps/web/test/team-links.test.ts`

**Interfaces:**
- Consumes: `SessionUser` (Task 2), `Avatar` (Task 2), `allowedSectionIds` (`lib/tenancy/sections-access.ts`).
- Produces:
  - `landingAfterSignIn(next: string, isTeam: boolean): string` — team: `next` when `next === '/manage'` or starts with `/manage/` or `/manage?`, else `'/manage'`; players: `next`.
  - `SitePlayer = { user; brand; profileId; isTeam: boolean; teamSectionIds: string[] }` (`teamSectionIds` is `[]` for players; for team, `allowedSectionIds` with the service client).
  - `requirePlayer(next: string): Promise<SitePlayer | null>` — `requireUser(next)`; team → `redirect('/manage/account')`; returns `getSitePlayer()` (null when the brand isn't live).
  - `teamDeskHref(target: { kind: 'space'; sectionId: string; resourceId: string } | { kind: 'game'; sectionId: string; sessionId: string }, teamSectionIds: string[]): { href: string; label: 'space' | 'game' | 'today' }` — runs the section → `/manage?book=<resourceId>` (`space`) or `/manage/games/<sessionId>` (`game`); otherwise `/manage` (`today`).
  - `SiteNav` prop `team: { name: string; avatarUrl: string | null } | null` replaces `showManage`.

- [ ] **Step 1: Write failing unit tests**
  - redirect: team with `'/'` → `'/manage'`; `'/manage/bookings'` kept; `'/manage?book=x'` kept; `'/me'` → `'/manage'`; `'/managers'` → `'/manage'`; `'/manage-x'` → `'/manage'`; player with `'/me'` → `'/me'`.
  - team-links: space in a run section → `{ href: '/manage?book=r1', label: 'space' }`; game in a run section → `/manage/games/s1`, `game`; section not run → `{ href: '/manage', label: 'today' }`; `teamSectionIds = []` → today.

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/redirect.test.ts test/team-links.test.ts` → FAIL.

- [ ] **Step 3: Implement** `landingAfterSignIn`, `teamDeskHref`, `getSitePlayer`'s `teamSectionIds`, `requirePlayer`.

- [ ] **Step 4: Site menu for team.** `SiteChrome` passes `team` (from `player.user.name ?? player.user.email ?? ''`, `player.user.avatarUrl`) when `player.isTeam`, and no bell for team. `SiteNav` with `team`: laptop shows a **Manage** link and the `Avatar` (`sm`, linking to `/manage`) and hides My bookings and Profile; phone's last tab is **Manage** (`LayoutDashboard` icon, href `/manage`, active on `/manage`). Without `team`, unchanged.

- [ ] **Step 5: Guard the player pages.** Replace `requireUser(...)` with `requirePlayer(...)` (same `next`) in `/me`, `/me/bookings`, `/me/notifications`, `/me/offers/[id]`.

- [ ] **Step 6: Run** the Step 2 command → PASS; `pnpm --filter web typecheck` and `pnpm --filter web lint` → clean.

- [ ] **Step 7: Commit** — `feat(web): team accounts land in Manage and see Manage on the site`

---

### Task 4: Team accounts can look but not book

**Files:**
- Create: `apps/web/lib/tenancy/team-refusal.ts`
- Modify: `apps/web/app/(site)/[section]/book/actions.ts`, `app/(site)/sessions/[id]/actions.ts` (`requestSeatAction` only), `app/(site)/me/offers/[id]/actions.ts`, `app/(site)/me/actions.ts`
- Create: `apps/web/components/site/team-note.tsx`
- Modify: `apps/web/app/(site)/[section]/book/page.tsx`, `app/(site)/sessions/[id]/page.tsx`
- Modify: `apps/web/messages/en.ts` (`m.team`)
- Test: `apps/web/test/team-links.test.ts`

**Interfaces:**
- Consumes: `SitePlayer.isTeam`, `teamSectionIds`, `teamDeskHref` (Task 3).
- Produces: `teamRefusal(player: { isTeam: boolean } | null): FormState | null` — `{ ok: false, message: m.team.refused }` for team, else `null`; `<TeamNote brandName: string; href: string; label: 'space' | 'game' | 'today' />`; messages `m.team = { note(brand), openSpace, openGame, goToday, refused }` with the Global Constraints copy.

- [ ] **Step 1: Write the failing test** (in `team-links.test.ts`): `teamRefusal({ isTeam: true })` equals `{ ok: false, message: "Team accounts can't book, take seats or keep a player profile here. Use Manage." }`; `teamRefusal({ isTeam: false })` and `teamRefusal(null)` are `null`.

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/team-links.test.ts` → FAIL.

- [ ] **Step 3: Implement** `teamRefusal` and the messages; call it first in `bookSpaceAction`, `requestSeatAction`, `respondMyOfferAction`, `saveProfileAction` (return it when non-null). `withdrawAction` and `respondByTokenAction` unchanged.

- [ ] **Step 4: Notes on the pages.**
  - Book page: after the spaces load and `space` is chosen, a team account gets the page header and a `TeamNote` (from `teamDeskHref({ kind: 'space', sectionId: section.id, resourceId: space.id }, player.teamSectionIds)`) instead of the profile prompt or slot picker.
  - Game page: `Actions` takes `team: { href; label } | null`; when the game is live and `team` is set, it renders `TeamNote` in place of every player action. The page builds it with `kind: 'game'`.
  - The game page's `Rate level` link goes to `/me/edit` (was `/me`).

- [ ] **Step 5: Run** the Step 2 command → PASS; typecheck, lint → clean. Restart the dev server.

- [ ] **Step 6: Commit** — `feat(web): team accounts can look at bookings and games but not book`

---

### Task 5: Saving one's own team details; names on the team list

**Files:**
- Modify: `apps/web/lib/orgs/members.ts` (`Member.name`, `listMembers`, new `updateMyTeamDetails`)
- Create: `apps/web/lib/forms/team-details.ts`
- Modify: `apps/web/lib/tenancy/manager.ts` (`Manager.displayName`, `Manager.phone`, `Manager.memberSince`)
- Test: `apps/web/test/integration/members.test.ts`, `apps/web/test/forms.test.ts`

**Interfaces:**
- Consumes: the Task 1 columns; `normalizePhone`.
- Produces:
  - `Member = { userId; email; role; name: string }` (`display_name`).
  - `updateMyTeamDetails(db: SupabaseClient, input: { organizationId: string; userId: string; displayName: string; phone: string | null }): Promise<{ status: 'saved' | 'not_member' }>` — updates only `display_name` and `phone` of that one row.
  - `parseTeamDetailsForm(form: FormData): FormResult<{ displayName: string; phone: string | null }>` (fields `displayName`, `phone`; phone normalised).
  - `Manager` gains `displayName: string`, `phone: string | null`, `memberSince: string` (ISO `created_at`).

- [ ] **Step 1: Write failing tests**
  - Unit (`forms.test.ts`): `displayName` `''` → error `m.forms.required`; 61 characters → `m.forms.tooLong`; phone `'017-1234 5678'` → value `'+8801712345678'`; phone `''` → `null`; phone `'12'` → error `m.profile.phoneFormat`.
  - Integration (`members.test.ts`): `listMembers` returns each member's `name` (a member inserted without a name gets the email prefix); `updateMyTeamDetails` for member A changes A's name and phone and leaves member B's row and A's `role` unchanged; for a user not in the org it returns `{ status: 'not_member' }` and changes nothing.

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/forms.test.ts` and `pnpm --filter web exec vitest run --config vitest.integration.config.ts test/integration/members.test.ts` → FAIL.

- [ ] **Step 3: Implement** the parser, `listMembers`' `name`, `updateMyTeamDetails` (an update with `.select('user_id')`; no rows → `not_member`), and `getManager` reading `role, display_name, phone, created_at`.

- [ ] **Step 4: Run** the Step 2 commands → PASS; typecheck → clean.

- [ ] **Step 5: Commit** — `feat(web): team members save their own name and mobile`

---

### Task 6: My account page, the sidebar card and names on Staff

**Files:**
- Create: `apps/web/app/(root)/manage/account/page.tsx`, `apps/web/app/(root)/manage/account/actions.ts`
- Modify: `apps/web/components/manage/manage-nav.tsx`, `apps/web/app/(root)/manage/layout.tsx`
- Modify: `apps/web/app/(root)/manage/staff/page.tsx`
- Modify: `apps/web/messages/en.ts` (`m.manage.account`, `m.manage.nav.account`)

**Interfaces:**
- Consumes: `Manager` fields (Task 5), `SessionUser.avatarUrl` / `providers` (Task 2), `Avatar`, `initials`, `signInMethods`, `displayPhone`, `parseTeamDetailsForm`, `updateMyTeamDetails`, `loadSections` (`lib/sections/sections.ts`), the Staff page's `Chips`.
- Produces: route `/manage/account` (any team role); `saveMyDetailsAction(_state: FormState, form: FormData): Promise<FormState>` (`requireManager('staff')`, service client, `{ ok: true, message: 'Saved.' }`, field errors, or `Couldn't save. Try again.` on a thrown error); `ManageNav` prop `me: { name: string; role: OrgRole; avatarUrl: string | null }`.

- [ ] **Step 1: Build the page** with the spec §3 contents and the Global Constraints copy: `Avatar` (`lg`), an `ActionForm` (`saveMyDetailsAction`) with `Field`s `displayName` (default `manager.displayName`) and `phone` (default `displayPhone(manager.phone)` or blank), email read-only with its hint, sign-in methods, role, sections (owner `All sections`; staff chips of `manager.sectionIds` or `No sections yet.`, then the Staff-page hint), `On the team since` (`manager.memberSince` in `manager.org.timezone`, e.g. `2 Nov 2026`), and a Sign out form (`/auth/signout`, POST) as in `manage-nav.tsx`.

- [ ] **Step 2: Sidebar and phone menu.** The layout passes `me`; `ManageNav` ends the laptop sidebar with a card (`Avatar` `sm`, name, `· Owner` / `· Staff`) linking to `/manage/account` above View site and Sign out; on phones `My account` is the first item under More. `aria-current` on `/manage/account` as for other items.

- [ ] **Step 3: Staff page.** Each member shows `name` (bold) with `email` beneath it.

- [ ] **Step 4: Check it in the browser** on the local stack: restart the dev server, sign in as `owner@demo-arena.test` (as the e2e helper `signIn` does), open `/manage/account`, change the name to `Owner Test`, save → `Saved.` and the sidebar shows `Owner Test · Owner`; a typo'd mobile shows the format message. Set the name back.

- [ ] **Step 5: Run** typecheck, lint, `pnpm --filter web test` → clean.

- [ ] **Step 6: Commit** — `feat(web): My account in Manage, with names on the team`

---

### Task 7: Player Profile — view, then edit

**Files:**
- Create: `apps/web/lib/profiles/summary.ts`
- Create: `apps/web/app/(site)/me/edit/page.tsx` (the form moved from `me/page.tsx`)
- Modify: `apps/web/app/(site)/me/page.tsx` (becomes the view), `apps/web/app/(site)/me/actions.ts`, `apps/web/components/site/me-tabs.tsx`
- Modify: `apps/web/messages/en.ts` (`m.profile` view/edit keys)
- Test: `apps/web/test/profile-summary.test.ts`

**Interfaces:**
- Consumes: `listMyBookings`, `listMySeats` and their `MyBooking` / `MySeat` types; `requirePlayer`; `Avatar`; `displayPhone`; `m.profile.skillLevels`; `m.weekdays`.
- Produces:
  - `summariseProfile(bookings: MyBooking[], seats: MySeat[], now: Date): { gamesPlayed: number; spacesBooked: number; nextUp: NextUp | null }` with `NextUp = { kind: 'space' | 'game'; sectionId: string; title: string; startsAt: string }` (`title` = `resourceName` for a space, `activityName` for a game).
    - `gamesPlayed`: seats with status `confirmed` or `attended` and `startsAt <= now`.
    - `spacesBooked`: bookings whose status isn't `cancelled`.
    - `nextUp`: the earliest booking or seat, status not `cancelled` or `no_show`, with `startsAt > now`.
  - `availabilityLine(rows: Array<{ weekday: number; start: string; end: string }>): string` — weekday order Sunday first, `Fri 18:00–22:00 · Sat 10:00–14:00` (three-letter names from `m.weekdays`); `''` for none.
  - `MeTabs` `active="profile"` also on `/me/edit`.

- [ ] **Step 1: Write failing unit tests**
  - `gamesPlayed`: a `confirmed` seat yesterday counts, an `attended` one counts, a `cancelled` one and a `no_show` one don't, a `confirmed` seat tomorrow doesn't.
  - `spacesBooked`: three bookings, one `cancelled` → 2.
  - `nextUp`: a seat in 2 days and a booking in 1 day → the booking (`kind: 'space'`, its `resourceName`); only cancelled future items → `null`; nothing → `null`.
  - `availabilityLine([{ weekday: 6, start: '10:00', end: '14:00' }, { weekday: 5, start: '18:00', end: '22:00' }]) === 'Fri 18:00–22:00 · Sat 10:00–14:00'`; `availabilityLine([]) === ''`.

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/profile-summary.test.ts` → FAIL.

- [ ] **Step 3: Implement** `summary.ts`.

- [ ] **Step 4: The edit page.** `/me/edit`: `requirePlayer('/me/edit')`; today's form unchanged (same field names and labels), plus the read-only email at the top and a `Back` link to `/me`; heading `Edit your profile`, or `Set up your player profile` with no profile; with no profile the name defaults to `player.user.name ?? ''`. `saveProfileAction`: after `saved`, `redirect('/me?saved=1')` (errors still return as now).

- [ ] **Step 5: The view page.** `/me`: `requirePlayer('/me')`; no profile → `redirect('/me/edit')`. Otherwise the spec §4 layout: top card (`Avatar` `lg`, name, email, `displayPhone(phone)` or `No mobile number yet`, `Playing here since` + `created_at` as `Oct 2026` in the brand time zone, `Edit profile` → `/me/edit`); `Your levels` (one chip per brand section in its colour, `Turf · 3 Solid` from `m.profile.skillLevels`, or the not-rated line); `Your play` (`summariseProfile` over `listMyBookings` + `listMySeats` `upcoming` and `past`, service client as `/me/bookings` uses; `Next up` links to `/me/bookings`; none → `Nothing booked yet.` + `Find a game` → `/`); `Favourites` (activity names by rank, hidden when none); `Usually plays` (`availabilityLine`, hidden when empty); `Booking emails: on/off`. With `?saved=1`, `<p role="status">Profile saved.</p>` above the card.

- [ ] **Step 6: Run** the Step 2 command → PASS; typecheck, lint, `pnpm --filter web test` → clean. Restart the dev server.

- [ ] **Step 7: Commit** — `feat(web): the player Profile is a page to read, with its own edit page`

---

### Task 8: Browser journeys, full suite and notes

**Files:**
- Modify: `apps/web/e2e/r2-journey.spec.ts`, `apps/web/e2e/r3-desk.spec.ts`
- Modify: `memory.md` (§4 map, §6 if a gotcha appears, §8 change log), `README.md` (manage area: My account)

- [ ] **Step 1: Update the player journey** (`r2-journey.spec.ts`): after the email link, expect the URL `/me/edit` (no profile yet) and the heading `Set up your player profile`; after `Save profile`, expect `/me` with status `Profile saved.`; at the end, open `/me` and expect `Turf · 3 Solid` and the text `Games played`.

- [ ] **Step 2: Add the team journeys** (`r3-desk.spec.ts`):
  - `the owner's account is the venue's`: owner signs in from `/signin` → `/manage`; `/` shows link `Manage` and no link `Profile` or `My bookings`; `/me` → URL `/manage/account`; change the name to a random `Owner <4 chars>`, `Save` → `Saved.`, the sidebar link to `/manage/account` contains it; restore the old name in `finally`. `/turf/book` shows `Book walk-ins from Today` and no button `Book`.
  - Extend `a turf-only staff member sees only turf`: before signing in, insert a `player_profiles` row for the staff user (Review Focus 4); after sign-in, `/` shows `Manage`, no `Profile`, no notifications bell; `/me` → `/manage/account`, which lists `Turf` and `The owner chooses your sections on the Staff page.`. Remove the profile in `finally`.

- [ ] **Step 3: Run the journeys**

Run: `pnpm test:e2e` (local stack, dev server on it) → all pass. Run it a second time → all pass.

- [ ] **Step 4: Full suite**

Run from the repo root: `pnpm typecheck`, `pnpm test`, `pnpm db:test`, `pnpm test:race`, `pnpm test:integration`, `pnpm --filter web build`, `pnpm exec supabase db diff --local` → all green, "No schema changes found".

- [ ] **Step 5: Notes.** `memory.md` §8: what changed and the suite counts; §4: `organization_members.display_name/phone`, `requirePlayer`, `/manage/account`, `/me` vs `/me/edit`. README manage-area list gains My account. Commit — `docs: team and player accounts`.

- [ ] **Step 6: Final review and hand-back.** A fresh reviewer checks the branch against the spec; fix findings with failing-first tests; then ask the user about merging. Rollout per spec §7 (the user's `db push` first). Afterwards `pnpm env:hosted` and restart the dev server.
