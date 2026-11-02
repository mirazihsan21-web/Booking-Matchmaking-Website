# Team and player accounts — Design

**Date:** 2026-11-02 · **Builds on:** R1–R3, the Vercel launch and the Manage link (`6bc407b`, live at
`https://chattoturf.vercel.app`)
**Status:** approved in conversation (parts 1–3 and testing/rollout); this document is for review.

## 1. Goal and decisions

Today an owner or staff member who signs in gets the player site: "Profile" opens the player form
("Your profile at Chattoturf": name, phone, a skill level per section, favourites, play times), with
My bookings and Notifications beside it. The owner's login has no player profile, so that form is empty,
and nothing shows the name, photo and email Google already gave us. Apart from the "Manage" link, a
manager's account is a customer's account. For players, Profile is only an edit form: there is no page
that shows them who they are here.

| Decision | Choice |
|---|---|
| Team logins | **Venue only.** Owners and staff run the venue; they don't book or take seats with that login. A staff member who wants to play uses another email. |
| How | **One sign-in for everyone; the site adapts to the account.** No separate team sign-in page. |
| The manager's own account | A **My account** page inside Manage: photo, name, mobile, email, sign-in method, role, sections, team since, Sign out. |
| Team names | Each team member has their own **name and mobile**, kept with their membership (not a player profile). |
| Player Profile | **View, then edit:** `/me` shows the profile; `/me/edit` is the form. |

**Done when:** the owner signs in and lands in Manage, the site menu offers Manage (not Profile or My
bookings), My account shows their Google photo, name and email, and they can change their name and mobile;
a player opens Profile and sees their photo, levels, games played and what's next, edits it on its own page,
and a first-time player gets the form with their Google name filled in.

## 2. Team accounts are venue-only

**Who is "team":** a member (owner or staff) of the brand's organisation (`BRAND_SLUG`), as
`isBrandTeamMember` (`lib/tenancy/team.ts`) already decides.

**Signing in.** `landingAfterSignIn(next, isTeam)` (`lib/auth/redirect.ts`) changes: a team account goes to
`next` when it is a manage page (`/manage` or `/manage/…`), otherwise to `/manage`. Players keep `next`.

**The site menu** (`components/site/site-nav.tsx`, `site-chrome.tsx`) for a team account:
- Laptop: **Manage** and the person's photo (both linking to Manage) replace My bookings, the bell and
  Profile.
- Phone: the last bottom tab is **Manage** (a dashboard icon), not Me.
- Signed-out visitors and players see the menu as now.

**Player pages send team accounts away.** A shared guard (`requirePlayer(next)`: signed in, or to
`/signin?next=…`; team, or to `/manage/account`) runs on `/me`, `/me/edit`, `/me/bookings`,
`/me/notifications` and `/me/offers/[id]`.

**Section and game pages stay viewable.** A team account sees a section's booking page and a game page as
a visitor would, but where **Book**, **Request a seat** or **Join the waitlist** would be it sees:
"You're signed in as Chattoturf's team. Book walk-ins from Today." with a link:
- booking page: to Today with that space's panel open (`/manage?book=<space id>`) when the person runs
  that section (owner, or staff of it); otherwise to Today (`/manage`);
- game page: to the game in Manage (`/manage/games/<id>`) when they run its section; otherwise to Today.

**The server refuses too.** `bookSpaceAction`, `requestSeatAction` (seat or waitlist),
`respondMyOfferAction`, `respondByTokenAction` and `saveProfileAction` return "Team accounts can't book,
take seats or keep a player profile here. Use Manage." for a team account, before anything is written.
`withdrawAction` (leaving a game) still works, so an old seat can be given up.

**A player who later joins the team:** their past bookings and seats stay where they are (the venue's
Bookings and games list them as before); their login becomes a team login.

## 3. My account (Manage)

**Data.** Migration `20261102010000_team_member_details.sql`:
- `organization_members.display_name text not null` (trimmed length 1–60) and
  `organization_members.phone text` (optional; the same `+8801…` form players' phones use).
- **Backfill** for existing rows: the Google full name (`raw_user_meta_data.full_name`, else `name`), else
  the part of the email before "@", cut to 60 characters, else "Team member".
- A **`before insert` trigger** fills `display_name` the same way when it is missing, so every way in
  (brand setup, accepted invites, `createOrganization`) gets a name without code changes. Its function lives
  in `private` (`security definer`, empty `search_path`, reads `auth.users`; not callable by `anon` or
  `authenticated`), never in `public`.
- Writes go through the server, like the other manage actions: the page's action uses the service client
  and updates only the signed-in person's own row (`organization_id` = the brand, `user_id` = them), only
  these two columns.

**`getManager`** (`lib/tenancy/manager.ts`) also returns the person's `displayName`.

**Navigation** (`components/manage/manage-nav.tsx`):
- Laptop: the sidebar ends with a card (photo, name, role: "Miraz Ihsan · Owner") linking to
  `/manage/account`; View site and Sign out stay below it.
- Phone: **My account** is the first item under More.

**`/manage/account`** (owners and staff):
- Photo: the Google picture (`user_metadata.avatar_url`, else `picture`), shown with
  `referrerPolicy="no-referrer"`; without one, the person's initials in a circle. One shared `Avatar`
  component serves Manage and the site.
- **Name** and **Mobile number**: an edit form (Save → "Saved."). Name 1–60 characters; mobile optional,
  in the players' phone format (same parser and messages).
- **Email**: read-only, with "This is your sign-in. It can't be changed here."
- **How you sign in**: from the account's identities — "Google", "Email link" or "Google and email link".
- **Role**: Owner or Staff.
- **Sections**: owners see "All sections"; staff see their sections as coloured chips (read-only) and
  "The owner chooses your sections on the Staff page."
- **On the team since** (`organization_members.created_at`, the brand's time zone).
- **Sign out**.

**Staff page** (`/manage/staff`): each person shows their name, with the email underneath
(`listMembers` returns `name`).

## 4. Player Profile: view, then edit

**`/me` — the profile (read-only)**, Profile tab active:
- **Top card:** photo (Google, else initials), name, email, mobile (or "No mobile number yet"),
  "Playing here since <month year>" (`player_profiles.created_at`), and **Edit profile** (to `/me/edit`).
- **Your levels:** one chip per section in its colour — "Turf · 3 Solid"; a section with no level:
  "Not rated: add a level to join its games."
- **Your play:**
  - **Games played:** the player's seats that aren't cancelled, in games that have started.
  - **Spaces booked:** their space bookings that aren't cancelled.
  - **Next up:** the soonest booking or seat still to come (not cancelled), with section, what and when,
    linking to My bookings; with nothing booked: "Nothing booked yet." and a link to the home page's
    sections.
  - Counted from the same lists My bookings shows (`listMyBookings`, `listMySeats`), summarised by one pure
    function (`summariseProfile(bookings, seats, now)`).
- **Also:** favourites as names ("7-a-side football, Catan"), usual play times ("Fri 18:00–22:00 · Sat
  …"), and "Booking emails: on" or "off".
- After saving, `/me?saved=1` shows "Profile saved." as a status line.

**`/me/edit` — the form** (moved from today's `/me`, fields unchanged):
- The email, read-only, at the top.
- **Save profile** saves and goes to `/me?saved=1`; errors stay on the form as now. A **Back** link returns
  to `/me`.
- Heading "Edit your profile"; for someone with no profile yet, "Set up your player profile".

**First visit.** `/me` for a signed-in player with no profile goes to `/me/edit`, where the name is filled
from Google (`full_name`, else `name`; blank for email-link sign-ins).

**Unchanged:** the tabs (Profile · My bookings · Notifications), booking, seats, waitlists, notifications.

## 5. Error handling

- Team refusals are plain messages in the existing form error slot; nothing is written.
- My account: an invalid name or mobile shows the field's message; a failed save shows "Couldn't save.
  Try again." A person whose membership ended between loading and saving gets the existing manage refusal
  (`requireManager`).
- A Google photo that fails to load falls back to initials (`onError`).
- Profile stats never fail the page: a query error is thrown to the error boundary like other `/me` pages.

## 6. Testing

Every change starts with a test that fails first.
- **Unit:** `landingAfterSignIn` (team → `/manage` unless `next` is a manage page; players keep `next`);
  `summariseProfile` (games played, spaces booked, next up, cancelled and started cases); the My account form
  parser (name length, phone format); initials.
- **pgTAP** `23_team_member_details`: the columns and checks; the trigger names a new member from
  `full_name`, then `name`, then the email; an explicit name is kept; the trigger function isn't callable
  by `anon`/`authenticated`.
- **Integration:** updating one's own name and mobile changes only that row and those columns;
  `listMembers` returns names.
- **e2e (Playwright):**
  - The owner signs in, lands in Manage; on the site the menu shows Manage and no Profile or My bookings;
    `/me` sends them to My account; they change their name and see it in the sidebar; a booking page shows
    the team note and no Book button.
  - A player: the existing journey adjusted (first visit → `/me/edit`, saving → `/me` with
    "Profile saved."); their profile shows their levels and "Games played".
- The full suite (unit, pgTAP, race, integration, e2e, build, schema diff) passes before merging.

## 7. Rollout

1. Work on branch `team-and-player-accounts`; review; ask before merging.
2. The developer runs `pnpm exec supabase db push --yes` for the new migration (hosted) **before** `main`
   is pushed, so the deployed code finds the columns.
3. Merge, push `main`; Vercel deploys.
4. Point the local dev server back at the live data (`pnpm env:hosted`, restart).

## 8. Out of scope

Uploading a photo; changing the sign-in email; team members playing with their team login; editing other
people's names (each person edits their own); notifications for the team; Supabase's URL Configuration and
the other dashboard launch steps (the developer's, later).
