# Players chat — Design

**Date:** 2026-11-02 · **Builds on:** R1–R3, team and player accounts, the open booking grid, team invites,
privacy and terms pages (all live at `https://chattoturf.vercel.app`, `main` = `00c7aa5`)
**Status:** approved in conversation (parts 1–4); this document is for review.

## 1. Goal and decisions

Players who are short of people for a game have nowhere to find them. This adds a **players chat** to the
site: one live room for everyone, where a player with a booking can post a **"Need players" card**, others
tap **I'm in**, and the poster accepts the ones they want.

| Decision | Choice |
|---|---|
| Shape | One live chat room **plus** "Need players" cards inside it (and a strip of open cards on top). |
| Who reads | **Signed-in people only.** Visitors see "Sign in to see the players chat". |
| Who posts | Players with a player profile (there's a name to show) and team members (shown as the venue). |
| I'm in | Sends a request; the **poster accepts or declines** each one. |
| After Accept | The poster and that player **see each other's mobile number** (if saved). Nobody else ever does. |
| Cards | For the poster's own upcoming confirmed **booking**, or for an **open-play session** (team, or a player who has asked for a seat). |
| Extras | Report button, unread dot/count, photos, private messages, open-play cards, bad-word filter. |
| Live updates | Supabase Realtime row changes on Postgres tables (the way the notification bell already works). Broadcast channels and polling were set aside: broadcast needs a second set of access rules for scale this venue won't reach; polling would eat the Vercel Hobby allowance (1M calls a month). |
| Kept for | 30 days. |
| Built in | Two stages, each tested and shipped live on its own: **C1** (room, cards, moderation, reports, filter, unread dot) and **C2** (private messages, photos). One plan per stage. |

**Not in either stage:** Bangla, "Message the venue", reactions, editing messages, typing indicators, push
notifications, threads (see §16).

**Done when (C1):** two players on phones are signed in; one posts "Need 3 players" for their Friday 8 pm turf
booking; the other sees it appear live, taps I'm in; the poster gets a bell notification, accepts; both see
each other's number on the game page; a staff member mutes a rude player and removes their message; a
report from three players hides a message at once.
**Done when (C2):** those two players message each other privately with a photo; the unread count shows in the
header; an unread message emails after 15 minutes; a block stops it all.

## 2. What players see (C1)

### 2.1 The chat page — `/chat`

- Linked from the site header (desktop) and the phone tab bar for **everyone**, labelled **Chat**.
  `chat` can't clash with a section: section slugs come only from the kind (`turf`, `cafe`, `lounge`, `-N`).
- **Not signed in:** a short page, "Sign in to see the players chat", with the sign-in button (returns to `/chat`).
- **Signed in:**
  - **Top strip — "Games looking for players":** the open cards, **soonest game first**, each a compact row
    (section badge, what and when, spots or seats left). Tapping one opens its page.
  - **The room:** the latest 50 messages, oldest at the top, newest at the bottom, and **Load earlier** for
    50 more. Each message shows the sender's name, the time (Asia/Dhaka, "Today 8:14 pm" / "Fri 2 Nov, 8:14 pm"),
    and a **Team** badge for venue messages. Cards appear in the room as cards.
  - **The box:** plain text, 1–500 characters, Send (Enter sends on desktop, Shift+Enter is a new line).
    **Need players** button next to it. Text is shown as typed; links are not made clickable.
  - **No player profile yet** (signed in, `profileId` null, not team): the box is replaced by
    "Set up your player profile to chat" → `/me/edit?next=/chat`.
  - **Muted:** the box is replaced by "You're muted in the chat until Fri 2 Nov, 8:14 pm" (or "until the venue
    unmutes you").
- New messages arrive live (§10). If you've scrolled up, a "New messages ↓" button appears instead of
  jumping.

### 2.2 "Need players" cards for bookings

- **Need players** opens a small form:
  - **Booking:** a list of *your own* upcoming **confirmed** whole-space bookings that don't already have an open
    card ("Turf · Pitch 1 · Fri 8–9 pm"). None → "You need a booking first" with a link to the sections.
  - **How many are you short?** 1 to `min(20, space capacity − 1)`. A space for one person can't have a card
    ("This space is for one player").
  - **Note** (optional, up to 200 characters): "intermediate, split the cost".
- The card shows: section badge and colour, the activity or space ("7-a-side football · Pitch 1"), day and
  time, "posted by Sami", **N spots left**, the note, and **I'm in**.
- **I'm in** (not your own card, one request per card): sends a request; the button becomes
  "Asked · Withdraw". The poster gets a notification.
- **The card's page — `/chat/games/[id]`** (from the strip, the card or a notification):
  - Everyone signed in: the card's details and status.
  - **The poster:** the requests (name, the player's skill for that section if set, when they asked) with
    **Accept** / **Decline**; the accepted players with their **mobile numbers** and **Remove**; **Close card**.
  - **An accepted player:** "You're in", the poster's **mobile number**, the booking's section, space and time,
    and **Can't make it** (frees the spot; the poster is told).
  - **A requester still waiting:** "Waiting for Sami" and **Withdraw**.
  - Numbers: "No number saved" when the other person hasn't saved one, plus (for yourself) a link to add yours.
- **Accept** takes a spot; when the last spot goes the card shows **Full** and the remaining pending requests
  are told the card closed. **Decline** tells the player.
- **A card closes** when it's full, the poster closes it, the booking is cancelled, or the game starts.
  Closed cards leave the strip; in the room they show "Closed" (or "Full", "Cancelled") without the button.

### 2.3 Cards for open-play sessions

- The team (from `/chat`) or a player who has **asked for a seat** in that session can post a card for an
  upcoming open-play session that still takes requests: **"Open play · Fri 8 pm · ৳300 a seat · 6 seats left"**,
  with a note. A player's card reads "Sami is going — join in".
- **Get a seat** opens the existing session page (`/sessions/[id]`); asking for a seat works exactly as today
  (the venue's matching decides). No Accept step and no numbers.
- One open card per session per poster. Seats left are re-read when the strip renders and every minute
  (the existing `AutoRefresh`).
- It closes when the session starts, is cancelled, or has no seats left.

### 2.4 Your own messages

- **Remove** on your own message → "Message removed". You can close your own cards.

## 3. The venue side (C1)

- Team members (owner and staff) open `/chat` like anyone. Their messages show as **the brand name** (e.g.
  "Chattoturf") with a **Team** badge; the row records which member sent it.
- Team logins don't post booking cards or tap I'm in (they don't book as players). They can post open-play cards.
- Each message has a menu for the team: **Remove message** ("Message removed by the venue") and
  **Mute player** for **1 day**, **7 days** or **until unmuted**. A muted player can read but can't send
  messages, post cards, ask to join or (C2) send private messages. They can still answer requests on their own
  cards, withdraw, and close cards.
- **`/manage/chat`** (new, in the Manage menu as **Chat**, with the open-report count, e.g. "Chat (3)"):
  - **Reports** (§4) with their actions.
  - **Muted players** with when the mute ends and **Unmute**.
  - **Blocked words** (§6): the venue's own list, add and remove.
  - A link to the chat.

## 4. Reports (C1)

- **Report** on every room message and card that isn't yours (C2: private messages too). Reason: **Spam**,
  **Rude or abusive**, **Inappropriate photo** (C2), **Other**; optional note up to 200 characters. Then:
  "Thanks — the venue team will take a look."
- A card is reported through its message in the room (every card has one).
- One report per message per player; at most 20 reports a day per player.
- A report **keeps a copy** of what was reported (text, sender name, photo path in C2), so the team can review
  it even after the sender removes it, and without reading anything else.
- **Auto-hide:** when 3 different players have reported the same message, it's hidden at once: everyone sees
  "Hidden while the venue checks it" until the team acts.
- On `/manage/chat`, each open report shows the message, sender, reporters, reasons and notes, with:
  - **Remove message** (resolves every open report on that message),
  - **Mute sender** (1 day / 7 days / until unmuted; the reports stay open until removed or dismissed),
  - **Dismiss** (resolves the reports; a hidden message comes back).

## 5. Unread dot and count

- **C1:** the **Chat** link (header and tab bar) shows a **dot** when there are room messages you haven't
  seen. Your own and removed messages don't count. It updates live on every page while you're signed in.
  Opening `/chat` clears it, and so does reading new messages while it's open.
- **C2:** the link also shows the **number of unread private messages** ("Chat 2"), which wins over the dot.
- Team members get the dot too. (The open-report count lives in the Manage menu.)

## 6. Bad-word filter (C1)

- Every text people type into the chat — room messages, card notes, report notes, (C2) private messages and
  photo captions — goes through the filter **before it's saved**. Bad words are replaced with `●●●`.
- A **built-in starter list** of common English swear words and slurs lives in code; the venue adds its own
  words (Bangla script or Banglish) on `/manage/chat` (up to 500 words, each 2–40 characters).
- Matching is **whole words**, ignoring capitals, stretched letters ("shiiit") and look-alike symbols
  (`0→o`, `1→i`, `3→e`, `4→a`, `5→s`, `7→t`, `@→a`, `$→s`). "class" and "Scunthorpe" pass. Multi-word entries
  match as phrases.
- It's a pure function (`maskBadWords(text, extraWords)`), unit-tested, run in the server action.
- It doesn't catch everything; reports are the backstop.

## 7. Private messages (C2)

- Tap a player's name in the room → a small panel (name, the sections they play) with **Message** (and
  **Block**). The conversation page is `/chat/private/[profileId]`; it's created by the first message, so empty
  conversations never exist.
- `/chat` gets two tabs: **Everyone** and **Private**. Private lists conversations, latest first, with the
  other person's name, the last message and the unread count.
- The same box, limits, filter, photos, Remove and Report as the room.
- **You can't message:** yourself, a team login, someone you've blocked or who has blocked you
  ("You can't message this player"), or anyone while you're muted.
- **Block** (from the panel or a conversation): they can't message you, and you can't message them; their room
  messages and cards are hidden from you ("1 message from someone you blocked" collapsed line); you can't ask to
  join each other's cards. They aren't told. **Unblock** from the same place.
- **Unread email:** when a private message has been unread for **15 minutes**, the recipient gets one
  notification (bell + email if they allow emails): "Sami sent you a message". At most one per conversation
  every **12 hours**.
- The team never sees private messages, except a reported one (the report's copy).

## 8. Photos (C2)

- Room and private messages can carry **one photo** plus an optional caption (the message text).
- The browser shrinks it first (longest side 1600 px, JPEG quality 0.82) using `createImageBitmap` and a
  canvas; originals up to **5 MB** in JPEG, PNG or WebP (iPhones hand over JPEG through the file picker). A photo
  the browser can't read → "That photo type isn't supported — try a JPEG or PNG".
- It uploads **straight from the browser to Supabase Storage** (Vercel functions take at most 4.5 MB per
  request) into a private bucket `chat-photos`, path `<user id>/<uuid>.jpg`, at most 2 MB, image types only.
  Then the message is posted with that path; the database checks the path is the sender's, the file exists and
  it isn't used by another message.
- **Who can see a photo:** room photos — signed-in people, while the message isn't removed or hidden; private
  photos — the two people; the team — photos in an open report. Shown through short-lived signed links;
  tapping opens it full size.
- At most **10 photos an hour** per person.
- A photo is deleted from storage when its message is removed (or, if an open report points at it, when the
  report is resolved), when it's purged after 30 days, or (uploaded but never posted) after one day.

## 9. Limits

| What | Limit |
|---|---|
| Message text | 1–500 characters after trimming (a photo message may have no text) |
| Card note, report note | up to 200 characters |
| Sending | 1 message every 3 seconds and 30 every 10 minutes per person (room and private together) |
| Photos | 10 an hour per person; 5 MB original, 2 MB stored |
| Cards | 3 open per player; one open card per booking; one per session per poster |
| Spots | 1 to `min(20, capacity − 1)` |
| Requests | one per card per player; at most 10 waiting at once per player; not on your own card |
| Reports | one per message per player; 20 a day per player |
| Mutes | 1 day, 7 days, or until unmuted |
| Venue word list | 500 words, 2–40 characters each |
| Kept | messages 30 days; cards and their requests 30 days after the game; resolved reports 30 days |

## 10. How it's built

### 10.1 Tables (all carry `organization_id`)

**C1**

- **`chat_messages`** — `id`, `organization_id`, `author_user_id` (auth user), `author_profile_id`
  (player, null for team), `author_kind` (`player` | `team`), `author_name` (snapshot: the player's display name
  or the brand name), `body` (filtered text, null when removed or hidden), `card_id` (null for plain messages),
  `conversation_id` (C2; null = the room), `photo_path` (C2), `state` (`visible` | `removed_by_author` |
  `removed_by_venue` | `hidden_by_reports`), `created_at`. Index `(organization_id, conversation_id, created_at desc)`.
  Names are snapshots: a later name change doesn't rewrite old messages (they're gone in 30 days anyway).
- **`chat_message_archive`** — `message_id`, `body`, `photo_path`, `archived_at`. When a message is removed or
  hidden its content moves here (team-readable only), so a removed message's text can't be read through the API;
  **Dismiss** on a hidden message moves it back.
- **`chat_cards`** — `id`, `organization_id`, `kind` (`booking` | `session`), `resource_booking_id` or
  `session_id`, `poster_user_id`, `poster_profile_id` (null for team), snapshots for display (`section_id`,
  `section_name`, `section_kind`, `title` e.g. "7-a-side football · Pitch 1", `starts_at`, `ends_at`,
  `seat_price_poisha` for sessions), `spots_needed`, `spots_taken`, `note`, `status` (`open` | `full` | `closed` |
  `cancelled` | `started`), `created_at`, `closed_at`. Partial unique indexes: one open card per booking; one open
  card per (session, poster).
- **`chat_join_requests`** — `card_id`, `profile_id`, `status` (`pending` | `accepted` | `declined` | `withdrawn` |
  `left` | `removed` | `expired`), `created_at`, `decided_at`; unique `(card_id, profile_id)`.
- **`chat_mutes`** — `organization_id`, `profile_id`, `until` (null = until unmuted), `muted_by`, `created_at`.
- **`chat_reports`** — `id`, `message_id`, `reporter_profile_id`, `reason`, `note`, copies of the reported
  `body`, `author_name` and `photo_path`, `status` (`open` | `removed` | `dismissed`), `resolved_by`,
  `created_at`, `resolved_at`; unique `(message_id, reporter_profile_id)`.
- **`chat_blocked_words`** — `organization_id`, `word`; unique per organization (lower-cased).
- **`chat_reads`** — `organization_id`, `user_id`, `room_read_at`.

**C2**

- **`chat_conversations`** — `id`, `organization_id`, `profile_low`, `profile_high` (`low < high`, unique pair),
  `created_at`, `last_message_at`.
- **`chat_conversation_reads`** — `conversation_id`, `profile_id`, `read_at`, `emailed_at`.
- **`chat_blocks`** — `organization_id`, `blocker_profile_id`, `blocked_profile_id`, `created_at`.
- Storage bucket **`chat-photos`** (private, 2 MB, `image/jpeg`, `image/png`, `image/webp`).

### 10.2 Who can read (row-level security)

- **Room messages and cards:** any signed-in user (the brand's chat). Visitors (`anon`): nothing.
- **Private messages, conversations, reads:** only the two participants.
- **Join requests:** the requester and the card's poster.
- **Reports, mutes, the archive, the venue word list:** the team (owner and staff). A player can read their own
  mute (to show "You're muted until …").
- **`chat_reads`:** your own row.
- **Blocks:** your own blocks.
- **Phone numbers are never exposed by these tables.** `/chat/games/[id]` reads them on the server with the
  service client, after checking that the viewer is the poster or an accepted player.
- Helpers live in `private` as `security definer` (the existing rule: none in `public`).

### 10.3 Who writes

- The browser writes **only** its own `chat_reads` row (C2: its own `chat_conversation_reads.read_at`) and its own
  uploads in `chat-photos`. Everything else goes through **server actions**:
  1. check who's asking (`getSitePlayer`; team actions also check the member's role),
  2. validate with zod (`lib/forms`),
  3. run the word filter,
  4. call a SQL function as `service_role` (the same pattern as `book_resource` and `request_seat`).
- The SQL functions enforce, in one transaction: mutes; the rate limits (counted under a per-person advisory
  lock); the card rules (your own upcoming confirmed booking, capacity, one open card per booking, 3 per player;
  for sessions: open for requests, team or a player with a request or seat); request rules (not your own card,
  open card, at most 10 waiting, C2 blocks); **Accept never goes past the spots** (the card row is locked, so two
  quick taps can't overfill it); report rules and auto-hide at 3 reporters; and the notification rows.
- Functions (C1): `post_chat_message`, `remove_chat_message`, `post_chat_card`, `close_chat_card`,
  `request_to_join`, `withdraw_join_request`, `decide_join_request` (accept / decline), `leave_card`,
  `remove_from_card`, `report_chat_message`, `resolve_chat_reports` (remove / dismiss), `mute_chat_player`,
  `unmute_chat_player`, `set_chat_blocked_word`, `close_due_chat_cards`, `purge_chat`.
  C2 adds `post_private_message`, `block_chat_player`, `unblock_chat_player`, `due_private_message_reminders`.
- Server-side code lives in `lib/chat/` (each function takes a `SupabaseClient`, integration-tested), and the
  pure parts (filter, card status words, unread rules, limits) are unit-tested.

### 10.4 Live updates

- `chat_messages` and `chat_cards` join the `supabase_realtime` publication.
- `/chat` subscribes to inserts and updates on both (filter `organization_id=eq.<brand>`). It adds rows by id
  (Realtime can deliver a row twice), replaces changed ones (removed, hidden, card spots and status), and on
  every (re)subscribe fetches anything newer than the newest message it has, so nothing is lost between the
  server render and the subscription.
- The **Chat link** subscribes to message inserts to light the dot (room messages from others) and, in C2,
  re-reads the private unread count when a private message arrives — RLS means each person only receives rows
  they're allowed to see.
- **Load earlier**, the unread queries and marking as read run in the browser under RLS (no Vercel calls).
  Sending is one server action per message.
- Seats left on open-play cards come from the existing `seatsLeft`, re-read every minute by `AutoRefresh`.

### 10.5 Notifications

New `notification_kind` values, written by the SQL functions into the existing outbox (bell + email, words in
`renderNotification` and `messages/en.ts`, payloads hold ids, times and names only):

| Kind | To | Says |
|---|---|---|
| `chat_join_request` | poster | "Tanvir wants to join your Fri 8 pm turf game" |
| `chat_join_accepted` | player | "Sami accepted you for Fri 8 pm — see their number" |
| `chat_join_declined` | player | "Sami's Fri 8 pm game didn't work out" (also when removed after accepting) |
| `chat_join_left` | poster | "Tanvir can't make Fri 8 pm any more — 1 spot open again" |
| `chat_card_closed` | waiting requesters | "Sami's Fri 8 pm game is full / closed" |
| `chat_game_cancelled` | accepted and waiting players | "Sami's Fri 8 pm game was cancelled" |
| `chat_private_message` (C2) | recipient | "Sami sent you a message" |

They link to `/chat/games/[id]` (C2: the conversation).

### 10.6 The every-minute job

`runTick` gets new steps, each in its own `step(…)` so one failure doesn't stop the rest:
- **cards:** `close_due_chat_cards` closes cards whose game has started (waiting requests expire quietly) or
  whose booking or session was cancelled (→ `chat_game_cancelled`); session cards with no seats left are closed
  too (the job asks `seatsLeft` for the open session cards). A mute simply stops applying once `until` passes.
- **reminders (C2):** `due_private_message_reminders` writes the 15-minute unread notifications.
- **purge (once an hour is enough, run when the minute is 0):** `purge_chat` deletes messages older than 30 days,
  cards and requests 30 days after the game, resolved reports and ended mutes after 30 days, and returns the photo paths to
  delete; the job deletes them from storage, plus unposted uploads older than a day (C2).

## 11. Privacy policy and terms

- **Privacy** (`m.legal.privacy`), new lines: chat messages, cards and photos are seen by signed-in people (private
  messages only by the two people) and kept for 30 days; after a poster accepts someone, those two see each other's
  mobile number; a reported message (including a private one) is copied for the venue team; the team can see who
  is muted and why. "Last updated" moves to the release date.
- **Terms**, a "Chat" section: be respectful, no spam, no selling, no one else's personal details; the venue can
  remove messages and mute players; meeting other players is at your own judgement.

## 12. Errors and edge cases

- Every refusal is a plain sentence from `messages/en.ts`: "Slow down a little — try again in a few seconds",
  "You're muted until …", "That booking already has an open card", "This card is full", "You've asked to join
  10 games — wait for some answers first", "You can't message this player", etc. Nothing throws to the page.
- The poster's booking is cancelled (by them or the venue) → the next tick closes the card and tells accepted and
  waiting players. The card shows "Cancelled".
- The game starts → the card closes ("Started"); nothing more can change on it, but its page stays readable until
  purged.
- A player is muted while waiting on cards → their requests stay; they can still withdraw.
- A team member leaves the team → their old messages stay as the brand.
- Two people accept/ask at the same moment → row locks in the SQL functions decide; the loser gets
  "This card is full".
- Realtime drops (phone sleeps) → on reconnect the page catches up (§10.4); a "Reconnecting…" line shows while
  it's down.
- A message from someone you blocked (C2) arrives live → collapsed line, not the text.

## 13. Testing

- **pgTAP** (`supabase/tests/database/24_chat*.test.sql`): RLS for every new table (visitor, another player,
  poster, accepted player, team, outsider), the browser can't insert or update messages, cards, requests or
  reports; every SQL function's rules and limits; auto-hide at 3; archive on remove and restore on dismiss; purge;
  card closing; notification rows; C2 conversation privacy, blocks and storage policies.
- **Race** (`supabase/tests/race`): two accepts on the last spot never overfill; two requests from one player
  never make two rows.
- **Unit** (Vitest): `maskBadWords` (`$h1t`, "shiiit", "class", "Scunthorpe", phrases, Bangla script words from
  the venue list), the zod forms, card status words, time formatting, the unread rules, the photo-resize maths.
- **Integration** (`test/integration/chat*.test.ts`, local stack): every `lib/chat` function end to end,
  including notifications and the phone-number rule.
- **End to end** (Playwright, two browser contexts): C1 — a live message from one player shows up for the other;
  card → I'm in → Accept → both numbers shown; mute stops sending; three reports hide a message; the unread dot
  lights and clears. C2 — a private message with a photo, the unread count, block.
- The usual: build, `supabase db diff` empty after migrations, advisors clean.

## 14. Stages and rollout

- **C1** — migration `<timestamp>_players_chat.sql`, `lib/chat`, `/chat`, `/chat/games/[id]`, `/manage/chat`, header
  link and dot, notifications, tick steps, privacy and terms lines, tests. Ship: merge, the user runs
  `! pnpm exec supabase db push --yes` on hosted **before** `main` is pushed (the old code runs fine on the new
  schema), then push `main`.
- **C2** — migration `<timestamp>_private_messages_and_photos.sql`, the Private tab and conversations, block, photos,
  reminder step, storage clean-up, privacy lines, tests. Same rollout.
- Free-plan headroom: Supabase Realtime allows 200 concurrent connections and 2 million messages a month; storage
  1 GB (a shrunk photo is ~200–400 KB, kept 30 days); Vercel Hobby 1 million function calls a month (one per send).

## 15. Files (expected)

- `supabase/migrations/<timestamp>_players_chat.sql` (C1), `<timestamp>_private_messages_and_photos.sql` (C2)
- `apps/web/lib/chat/` — `messages.ts`, `cards.ts`, `moderation.ts`, `reads.ts`, `filter.ts`, `words.ts`
  (starter list), C2 `private.ts`, `photos.ts`
- `apps/web/lib/forms/chat.ts`
- `apps/web/app/(site)/chat/` — `page.tsx`, `actions.ts`, `games/[id]/page.tsx`, C2 `private/…`
- `apps/web/components/chat/` — room, message, card, strip, composer, need-players form, team menu, report
  dialog, C2 panel, photo picker and viewer
- `apps/web/app/(root)/manage/chat/` — `page.tsx`, `actions.ts`
- `apps/web/components/site/site-nav.tsx` (Chat link + dot), `components/manage/*` nav (Chat count)
- `apps/web/lib/jobs/tick.ts` (steps), `lib/notifications/render.ts`, `messages/en.ts`
- tests as in §13

## 16. Future ideas (not built)

Bangla UI; "Message the venue" (players ↔ team inbox); reactions; editing messages; typing indicators; push
notifications; per-section rooms; report alerts to the team by email; account deletion that also clears chat
content; switching live updates to Realtime broadcast if the chat ever outgrows row changes.
