# Players chat — Stage C1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live players chat at `/chat` with "Need players" cards (bookings and open-play sessions), I'm in → Accept → swapped mobile numbers, team posts and moderation, reports with auto-hide, a bad-word filter and an unread dot.

**Architecture:** Postgres tables with RLS for reads; every write goes through a server action (identity, zod, word filter) that calls a `security invoker` SQL function as `service_role` which enforces mutes, rate limits, card rules and writes notification rows in one transaction. The browser listens to `chat_messages` and `chat_cards` through Supabase Realtime row changes (like the bell) and reads/marks unread under RLS.

**Tech Stack:** Next.js 16 App Router (cacheComponents, server actions), React 19, Supabase (Postgres, RLS, Realtime), zod, Vitest (unit + integration), pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-players-chat-design.md` (this plan is stage C1: §2–§6, §9–§14 minus the C2 parts).

## Global Constraints

- Branch `players-chat`. Run `git branch --show-current` before every commit.
- Every user-facing string lives in `apps/web/messages/en.ts` (new blocks `m.chat` and `m.manage.chat`); no literals in components.
- SQL functions in `public` are `language plpgsql security invoker set search_path = ''`, `revoke execute … from public, anon, authenticated`, `grant execute … to service_role`. **No `security definer` in `public`**; RLS helpers that need it go in `private`.
- Every foreign key to a tenant table includes `organization_id` (composite `(x_id, organization_id)`; `supabase/tests/database/06_tenant_refs.test.sql` enforces it). Every new table gets `unique (id, organization_id)` when other tables point at it.
- New tables: `enable row level security`; default privileges are revoked, so grant explicitly (`grant select on … to authenticated` only where §10.2 allows reading; `chat_reads` also `insert, update`).
- The service client (`lib/service-client.ts`) is server-only; nothing secret in `NEXT_PUBLIC_*`.
- Times are shown in the brand's time zone (`brand.timezone`, Asia/Dhaka) with `lib/format.ts` helpers.
- Text limits count **code points** in both TypeScript (`[...s].length`) and SQL (`char_length`): message 1–500, card note and report note ≤ 200, blocked word 2–40.
- The mask is `●●●` (three U+25CF).
- Kept for 30 days (§9 table).
- Migrations (apply locally with `pnpm exec supabase migration up --local`; never `db:reset` casually):
  `20261103010000_chat_notification_kinds.sql`, `20261103010100_players_chat.sql`, `20261103010200_chat_message_fns.sql`,
  `20261103010300_chat_card_fns.sql`, `20261103010400_chat_moderation_fns.sql`, `20261103010500_chat_job_fns.sql`.
- Tests run on the LOCAL stack (`pnpm env:local`, dev server restarted for e2e). When the stage is done: `pnpm env:hosted` and restart the dev server.
- Hosted is untouched by this plan (the user runs `db push` at rollout).

## Review Focus

1. **Realtime gaps and repeats:** a message posted between the server render and the subscription, or delivered twice, must appear exactly once, in order — pinned by `mergeMessages` unit tests (Task 9).
2. **Emoji and Bangla at the length limit:** 500 emoji or Bangla characters must be accepted by both the form and SQL, 501 refused by both — unit test in Task 2, pgTAP in Task 4.
3. **A team member who also has a player profile** (owners often test as players) must post as the team, never as the player, and can't post booking cards — pgTAP in Task 4 and Task 5.
4. **Card times in Dhaka**, whatever the server's or browser's zone: an 8 pm Dhaka booking reads "Fri 23 Oct, 8pm–9pm" — unit test in Task 9 (`cardWhen`).
5. **The filter mustn't mangle normal text:** "class", "Scunthorpe", "assess", "shiitake", Bangla sentences and URLs pass unchanged — unit tests in Task 1.

---

### Task 1: Bad-word filter

**Files:**
- Create: `apps/web/lib/chat/filter.ts`, `apps/web/lib/chat/words.ts`
- Test: `apps/web/test/chat-filter.test.ts`

**Interfaces:**
- Produces: `maskBadWords(text: string, extraWords?: readonly string[]): string`; `STARTER_WORDS: readonly string[]`; `MASK = '●●●'`; `normalizeWord(word: string): string` (lower-case, look-alikes mapped; also used to store venue words).

- [ ] **Step 1: Write the failing tests** — `describe('maskBadWords')`:
  - `maskBadWords('what the fuck')` → `'what the ●●●'`; `'Shit!'` → `'●●●!'`; `'$h1t happens'` → `'●●● happens'`; `'shiiiit'` → `'●●●'`; `'FUCKING hell'` → `'●●● hell'`; `'a$$hole'` → `'●●●'`.
  - Unchanged: `'first class pitch'`, `'Scunthorpe United'`, `'assess the shiitake'`, `'as you like'`, `'আজ রাতে খেলা হবে?'`, `'see https://example.com/a?b=1'`.
  - Venue words: `maskBadWords('tui ekta gadha', ['gadha'])` → `'tui ekta ●●●'`; Bangla script `maskBadWords('তুই একটা গাধা', ['গাধা'])` → `'তুই একটা ●●●'`; phrase `maskBadWords('you son of a gun', ['son of a gun'])` → `'you ●●●'`.
  - Keeps spacing and punctuation around a masked word: `'ok,shit,ok'` → `'ok,●●●,ok'`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/chat-filter.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**
  - Tokens are runs of `/[\p{L}\p{M}\p{N}@$]+/gu` (`\p{M}` keeps Bangla vowel signs inside words).
  - `normalizeWord`: `toLowerCase()`, then map `0→o 1→i 3→e 4→a 5→s 7→t @→a $→s`.
  - Each list entry is split on spaces into words. Each word compiles to a pattern where every letter may repeat: `shit` → `^s+h+i+t+$`, `ass` → `^a+s+s+$` (so "as" never matches).
  - An entry matches when consecutive tokens each match its words (whole tokens only). The span from the first token's start to the last token's end becomes `MASK`.
  - `STARTER_WORDS` holds common English swear words and slurs with their usual forms: at least fuck, fucker, fucking, fucked, motherfucker, shit, shitty, bullshit, bitch, bastard, asshole, dick, dickhead, cunt, prick, twat, wanker, whore, slut, retard, faggot, nigger, nigga.
- [ ] **Step 4: Run the test** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): chat bad-word filter`.

### Task 2: Chat forms and refusal words

**Files:**
- Create: `apps/web/lib/forms/chat.ts`
- Modify: `apps/web/messages/en.ts` (new `chat` block: `errors`, `refusal`)
- Test: `apps/web/test/chat-forms.test.ts`

**Interfaces:**
- Produces (each returns `FormResult<T>` from `lib/forms/result.ts`):
  - `parseChatMessageForm(fd) → { body: string }`, from field `body`;
  - `parseCardForm(fd) → { target: { kind: 'booking'; bookingId: string } | { kind: 'session'; sessionId: string }; spots: number | null; note: string | null }`, from fields `target` (`booking:<uuid>` | `session:<uuid>`), `spots` (required for bookings, integer 1–20; ignored for sessions) and `note`;
  - `parseReportForm(fd) → { messageId: string; reason: 'spam' | 'abuse' | 'other'; note: string | null }`;
  - `parseMuteForm(fd) → { profileId: string; days: 1 | 7 | null }`, from field `length` (`1` | `7` | `forever`);
  - `parseBlockedWordForm(fd) → { word: string }` (trimmed, inner spaces collapsed, lower-cased, 2–40).
- Produces: `m.chat.refusal: Record<ChatRefusal, string>`, where `type ChatRefusal` is exported from `lib/forms/chat.ts`. The keys are the SQL statuses used by Tasks 4–7: `muted`, `too_fast`, `no_profile`, `invalid`, `not_found`, `not_allowed`, `not_yours`, `already_posted`, `too_many_cards`, `bad_spots`, `single_space`, `not_going`, `not_open`, `own_card`, `already_asked`, `too_many_waiting`, `full`, `already_reported`, `own_message`, `too_many_reports`, `exists`, `too_many_words`, `nothing_open`. Copy follows spec §12, e.g. `too_fast: 'Slow down a little — try again in a few seconds.'`, `too_many_waiting: "You've asked to join 10 games — wait for some answers first."`.

- [ ] **Step 1: Failing tests:**
  - empty and whitespace-only body → error `m.chat.errors.empty`;
  - 500 × `'⚽'` passes and 501 fails with `m.chat.errors.tooLong(500)`; 500 × `'খ'` passes (Review Focus 2);
  - `target='booking:<uuid>'` with `spots='0'`, `'21'` or `'2.5'` → `errors.spots`; a session target with no spots passes with `spots: null`; `target='x'` → `errors.target`;
  - a note of 201 code points fails;
  - reason `'photo'` fails in C1;
  - `length='forever'` → `days: null`;
  - word `'  Son  Of '` → `'son of'`, and `'a'` fails.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/chat-forms.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** with zod, following `lib/forms/team-details.ts` (`text()`, `fieldErrors()`). Lengths use `[...s].length`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): chat forms`.

### Task 3: Chat schema, row access and Realtime

**Files:**
- Create: `supabase/migrations/20261103010000_chat_notification_kinds.sql`, `supabase/migrations/20261103010100_players_chat.sql`
- Test: `supabase/tests/database/24_chat_schema.test.sql`
- Modify: `supabase/tests/database/04_grants.test.sql` (add the chat tables to the "anon has no privileges" list; add `chat_messages`, `chat_cards`, `chat_join_requests` to the "authenticated can only read" list)

**Interfaces — Produces (exact names later tasks use):**

The `…010000` file only adds to `public.notification_kind`: `chat_join_request`, `chat_join_accepted`, `chat_join_declined`, `chat_join_left`, `chat_card_closed`, `chat_game_cancelled`. It's a separate file so the values are committed before anything uses them.

`…010100`:
```
enums: chat_author_kind ('player','team'); chat_message_state ('visible','removed_by_author','removed_by_venue','hidden_by_reports');
       chat_card_kind ('booking','session'); chat_card_status ('open','full','closed','cancelled','started');
       chat_join_status ('pending','accepted','declined','withdrawn','left','removed','expired');
       chat_report_reason ('spam','abuse','photo','other'); chat_report_status ('open','removed','dismissed')

chat_cards: id pk, organization_id, kind, resource_booking_id null → resource_bookings(id, organization_id) on delete cascade,
  session_id null → open_play_sessions(id, organization_id) on delete cascade, poster_user_id → auth.users on delete cascade,
  poster_profile_id null → player_profiles(id, organization_id) on delete cascade, poster_name text not null,
  section_id → sections(id, organization_id) on delete cascade, section_name, section_kind business_type, section_accent text,
  title text not null, starts_at, ends_at, seat_price_poisha int null, spots_needed smallint null check 1–20,
  spots_taken smallint not null default 0 check (spots_taken >= 0 and (spots_needed is null or spots_taken <= spots_needed)),
  note text null check (char_length(note) <= 200), status chat_card_status not null default 'open', created_at, closed_at,
  unique (id, organization_id),
  check ((kind = 'booking') = (resource_booking_id is not null) and (kind = 'session') = (session_id is not null)),
  check (kind = 'session' or (spots_needed is not null and poster_profile_id is not null))
  unique index one active card per booking: (resource_booking_id) where status in ('open','full')
  unique index one open card per session per poster: (session_id, poster_user_id) where status = 'open'
  index (organization_id, status, starts_at)

chat_messages: id pk, organization_id, author_user_id → auth.users on delete cascade,
  author_profile_id null → player_profiles(id, organization_id) on delete cascade, author_kind, author_name text not null,
  body text null check (body is null or char_length(body) between 1 and 500),
  card_id null → chat_cards(id, organization_id) on delete cascade, state chat_message_state not null default 'visible', created_at,
  unique (id, organization_id), check ((author_kind = 'team') = (author_profile_id is null)),
  check (state <> 'visible' or body is not null or card_id is not null)
  index (organization_id, created_at desc); index (author_user_id, created_at desc)

chat_message_archive: message_id pk, organization_id, (message_id, organization_id) → chat_messages on delete cascade, body text, archived_at
chat_join_requests: organization_id, card_id → chat_cards(id, organization_id) on delete cascade,
  profile_id → player_profiles(id, organization_id) on delete cascade, status chat_join_status not null default 'pending',
  created_at, decided_at, primary key (card_id, profile_id); index (profile_id, status)
chat_mutes: organization_id, profile_id → player_profiles(id, organization_id) on delete cascade, until timestamptz null,
  muted_by uuid → auth.users on delete set null, created_at, primary key (organization_id, profile_id)
chat_reports: id pk, organization_id, message_id → chat_messages(id, organization_id) on delete cascade,
  reporter_profile_id → player_profiles(id, organization_id) on delete cascade, reason, note text null (≤ 200),
  body_copy text null, author_name_copy text not null, status chat_report_status not null default 'open',
  resolved_by uuid null → auth.users on delete set null, created_at, resolved_at, unique (message_id, reporter_profile_id)
chat_blocked_words: organization_id, word text check (char_length(word) between 2 and 40 and word = lower(word)), primary key (organization_id, word)
chat_reads: organization_id, user_id → auth.users on delete cascade, room_read_at timestamptz not null, primary key (organization_id, user_id)
```

RLS (`to authenticated` unless noted; `anon` gets nothing):
- **`chat_cards` and `chat_messages` select:** `private.org_is_live(organization_id)`.
- **`chat_join_requests` select:** either
  - `private.is_own_profile(profile_id, organization_id)`, the same way the existing `seat_requests` policy calls it; or
  - `exists (select 1 from public.chat_cards c where c.id = card_id and c.poster_user_id = (select auth.uid()))`.
- **`chat_message_archive`, `chat_reports` and `chat_blocked_words` select:** `private.is_org_member(organization_id)`.
- **`chat_mutes` select:** `private.is_org_member(organization_id) or private.is_own_profile(profile_id, organization_id)`.
- **`chat_reads` select, insert and update:** `user_id = (select auth.uid())`, with the same check on writes.
- `alter publication supabase_realtime add table public.chat_messages, public.chat_cards;`

- [ ] **Step 1: Write `24_chat_schema.test.sql`** (ids `…0024…`). Fixtures: a live org with a section, a pitch (capacity 14), players A, B and C with profiles, and a staff member T. Assertions:
  - **Visitor (`anon`):** sees 0 rows in `chat_messages` and `chat_cards`.
  - **Player A, signed in (`authenticated`):**
    - reads room messages and cards;
    - can't `insert` into `chat_messages`, `chat_cards`, `chat_join_requests` or `chat_reports` (`42501`);
    - reads only their own `chat_join_requests` rows plus the rows on cards they posted, so player C sees neither;
    - can't read `chat_reports`, `chat_message_archive` or `chat_blocked_words`;
    - reads their own `chat_mutes` row but not B's;
    - can upsert their own `chat_reads` row but not B's.
  - **Staff T:** reads reports, the archive and every mute.
  - **Realtime:** `chat_messages` and `chat_cards` are in `pg_publication_tables` for `supabase_realtime`.
  - **Constraints:**
    - a 501-character body (`repeat('⚽', 501)`) fails `23514` and 500 passes;
    - a team message with a profile fails;
    - a second open card for one booking fails `23505`.
- [ ] **Step 2: Run** `pnpm db:test` — Expected: 24 FAIL (relations missing); every other file still passes.
- [ ] **Step 3: Write the two migrations** as above. Apply with `pnpm exec supabase migration up --local`.
- [ ] **Step 4: Run** `pnpm db:test` — Expected: all pass, including 04 and 06.
- [ ] **Step 5: Commit** — `feat(db): players chat tables and row access`.

### Task 4: Posting and removing messages (SQL)

**Files:**
- Create: `supabase/migrations/20261103010200_chat_message_fns.sql`
- Test: `supabase/tests/database/25_chat_messages.test.sql`

**Interfaces — Produces:**
- `private.chat_author(p_organization_id uuid, p_user_id uuid) returns table (kind public.chat_author_kind, profile_id uuid, name text)`:
  - a team member (any role) → `('team', null, organizations.name)`, even when they also have a player profile;
  - otherwise the player profile → `('player', id, display_name)`;
  - no rows when there's neither.
- `private.chat_guard(p_organization_id uuid, p_user_id uuid, p_profile_id uuid) returns text`: null when allowed, else `'muted'` or `'too_fast'`.
  - **Order:** takes `pg_advisory_xact_lock(hashtext('chat:' || p_user_id))`, then checks the mute (players only; active when `until is null or until > now()`), then the two rate limits.
  - **Rate limits:** `'too_fast'` when this user wrote any message in the last 3 seconds, or 30 or more in the last 10 minutes. Card messages count too.
- `public.post_chat_message(p_organization_id uuid, p_user_id uuid, p_body text) returns table (status text, message_id uuid)`:
  - statuses `posted` | `no_profile` | `muted` | `too_fast` | `invalid`;
  - the body is trimmed, and `invalid` unless it's 1–500 characters. The body arrives already filtered.
- `private.archive_message(p_message_id uuid, p_state public.chat_message_state) returns void`: copies `body` into `chat_message_archive` (keeping an existing row), sets `body = null` and `state`.
- `private.close_card(p_card_id uuid, p_status public.chat_card_status, p_notify boolean) returns void`:
  - sets `status` and `closed_at`, and marks pending requests `expired`;
  - when `p_notify`, sends `chat_card_closed` to those requesters, with payload `reason` = `'full'` when `p_status = 'full'`, else `'closed'`.
  - Task 5 uses it too.
- `public.remove_chat_message(p_message_id uuid, p_user_id uuid, p_by_venue boolean) returns text`:
  - statuses `removed` | `not_found` | `not_allowed`;
  - **author:** may remove their own plain message (`removed_by_author`), but a card message → `not_allowed` (they close the card instead);
  - **venue** (the user is an org member): any message → `removed_by_venue`, and a card message also closes its card (`closed`, notifying).
- Grants per the Global Constraints, `private.*` included.

- [ ] **Step 1: Write `25_chat_messages.test.sql`:**
  - a player posts → `posted`, with `author_kind='player'` and their display name;
  - a staff member who also has a player profile posts → `author_kind='team'` and `author_name` = the org name (Review Focus 3);
  - a user with no profile and not on the team → `no_profile`;
  - a second post within 3 s → `too_fast`; 30 rows inserted 1 minute ago → the next post is `too_fast`;
  - a muted player → `muted` (and an expired mute isn't);
  - `repeat('খ', 500)` posts and `repeat('খ', 501)` is `invalid`;
  - `'   '` → `invalid`;
  - the author removes their message → state `removed_by_author`, `body` null, and the archive holds the text;
  - another player removing it → `not_allowed`;
  - staff removing someone's message → `removed_by_venue`;
  - `authenticated` can't execute `post_chat_message`.
- [ ] **Step 2: Run** `pnpm db:test` — Expected: 25 FAIL.
- [ ] **Step 3: Write the migration;** apply locally.
- [ ] **Step 4: Run** `pnpm db:test` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(db): post and remove chat messages`.

### Task 5: Cards and join requests (SQL)

**Files:**
- Create: `supabase/migrations/20261103010300_chat_card_fns.sql`
- Test: `supabase/tests/database/26_chat_cards.test.sql`, `supabase/tests/race/chat-accept-race.test.ts`

**Interfaces:**
- **Consumes:** `private.chat_author`, `private.chat_guard`, `private.close_card` (Task 4).
- **Notification payloads:** keys `card_id`, `poster_name`, `player_name`, `resource_name` (= card `title`), `section_name`, `starts_at`, `ends_at`, `reason`, `after_accept`; link `/chat/games/<card_id>`.
- **Card functions:**
  - `public.post_booking_card(p_organization_id uuid, p_user_id uuid, p_booking_id uuid, p_spots int, p_note text) returns table (status text, card_id uuid)`
    - **Statuses:** `posted` | `no_profile` (team, or no profile) | `muted` | `too_fast` | `not_yours` (not their `confirmed` booking, or it has already started) | `single_space` (capacity 1) | `bad_spots` (outside 1..`least(20, capacity − 1)`) | `already_posted` | `too_many_cards` (3 `open`/`full` cards by this profile).
    - **Inserts** the card, with snapshots from the booking's space and section (`title` = space name), plus its room message (`body` null, `card_id` set).
  - `public.post_session_card(p_organization_id uuid, p_user_id uuid, p_session_id uuid, p_note text) returns table (status text, card_id uuid)`
    - **Statuses:** `posted` | `no_profile` | `muted` | `too_fast` | `not_found` (the session isn't `open`/`matched`, or has started) | `not_going` (a player with neither a `seat_requests` row nor a `confirmed` `bookings` row for it) | `already_posted` | `too_many_cards` (players only).
    - **Snapshots:** `title` = the activity name, else `'Open play'`; `seat_price_poisha` from the session.
    - The team may post; it's then shown under the brand's name.
  - `public.close_chat_card(p_card_id uuid, p_user_id uuid) returns text`
    - **Statuses:** `closed` | `not_found` | `not_yours` | `not_open`.
    - The poster or any team member may close it. Uses `private.close_card(…, 'closed', true)`.
- **Join-request functions:**
  - `public.request_to_join(p_card_id uuid, p_user_id uuid) returns text`
    - **Statuses:** `requested` | `no_profile` | `muted` | `not_open` (card not `open`, a session card, or started) | `own_card` | `already_asked` | `too_many_waiting` (10 pending).
    - Asking again after `withdrawn` or `left` turns the row back to `pending`. After `declined`, `removed` or `expired` it's `already_asked`.
    - **Notifies** the poster: `chat_join_request`.
  - `public.withdraw_join_request(p_card_id uuid, p_user_id uuid) returns text`
    - **Statuses:** `withdrawn` | `not_found` (no pending request).
  - `public.decide_join_request(p_card_id uuid, p_user_id uuid, p_profile_id uuid, p_accept boolean) returns text`
    - **Statuses:** `accepted` | `declined` | `full` | `not_found` | `not_yours` | `not_open`.
    - **Locking:** locks the card `for update` first.
    - **Accept** raises `spots_taken` and sends `chat_join_accepted`. When it reaches `spots_needed`, it calls `private.close_card(card, 'full', true)`.
    - **Decline** sends `chat_join_declined` with `after_accept = false`.
  - `public.leave_card(p_card_id uuid, p_user_id uuid) returns text`
    - **Statuses:** `left` | `not_found` (not accepted) | `not_open` (started).
    - Lowers `spots_taken`; a `full` card goes back to `open`. Sends `chat_join_left` to the poster.
  - `public.remove_from_card(p_card_id uuid, p_user_id uuid, p_profile_id uuid) returns text`
    - **Statuses:** `removed` | `not_found` | `not_yours` | `not_open`.
    - Lowers `spots_taken`; `full` goes back to `open`. Sends `chat_join_declined` with `after_accept = true`.

- [ ] **Step 1: Write `26_chat_cards.test.sql`** covering every status above. Must include:
  - **Posting a booking card:**
    - a booking by someone else → `not_yours`; a past booking → `not_yours`;
    - capacity 14 allows 13 spots, and 14 → `bad_spots`; a capacity-1 seat → `single_space`;
    - a staff member with a profile → `no_profile` (Review Focus 3);
    - a fourth card → `too_many_cards`.
  - **Joining and deciding:**
    - your own card → `own_card`;
    - the 11th pending request → `too_many_waiting`;
    - accepting the last spot sets status `full` and expires the other pending requests, with one `chat_card_closed` each (`reason` `full`);
    - leaving reopens it;
    - every notification has link `/chat/games/<id>`.
  - **Session cards:**
    - a player without a request → `not_going`, with one → `posted`;
    - team → `posted` under the brand name;
    - `request_to_join` on a session card → `not_open`.
- [ ] **Step 2: Write `chat-accept-race.test.ts`** following `book-resource-race.test.ts`:
  - **Setup:** a card with 1 spot and two pending players.
  - **Accept race:** connection A opens a transaction and accepts one; B's accept of the other must wait and then return `full`. Afterwards `spots_taken = 1`.
  - **Request race:** two concurrent `request_to_join` calls by one player leave exactly one row.
- [ ] **Step 3: Run** `pnpm db:test` and `pnpm test:race` — Expected: FAIL.
- [ ] **Step 4: Write the migration;** apply locally.
- [ ] **Step 5: Run both** — Expected: PASS.
- [ ] **Step 6: Commit** — `feat(db): need-players cards and join requests`.

### Task 6: Reports, mutes and the venue word list (SQL)

**Files:**
- Create: `supabase/migrations/20261103010400_chat_moderation_fns.sql`
- Test: `supabase/tests/database/27_chat_moderation.test.sql`

**Interfaces:**
- **Consumes:** `private.archive_message` and `private.close_card` (Task 4).
- **Reports:**
  - `public.report_chat_message(p_message_id uuid, p_user_id uuid, p_reason public.chat_report_reason, p_note text) returns text`
    - **Statuses:** `reported` | `no_profile` (team or no profile) | `not_found` | `own_message` | `already_reported` | `too_many_reports` (20 in the last 24 h).
    - **The copy:** `body_copy` = the body, else the archived body; for a card message it's `title || ', ' || coalesce(note, '')`. `author_name_copy` is copied too.
    - **Auto-hide:** when the message has 3 open reports from different players and is `visible`, call `private.archive_message(id, 'hidden_by_reports')`.
  - `public.resolve_chat_reports(p_message_id uuid, p_user_id uuid, p_action text) returns text`
    - **Who:** team only.
    - **Statuses:** `resolved` | `not_allowed` | `not_found` | `nothing_open`.
    - **`'remove'`:** archive as `removed_by_venue` (a card message also closes its card, notifying); the open reports become `removed`.
    - **`'dismiss'`:** the open reports become `dismissed`; a `hidden_by_reports` message gets its body back from the archive, `state` goes back to `visible`, and the archive row is deleted.
    - Both set `resolved_by` and `resolved_at`.
- **Mutes:**
  - `public.mute_chat_player(p_organization_id uuid, p_user_id uuid, p_profile_id uuid, p_days int) returns text`
    - **Who:** team only. `p_days` is 1, 7 or null (until unmuted).
    - **Statuses:** `muted` | `not_allowed` | `not_found` | `invalid`.
    - Upserts the `chat_mutes` row; `until` = `now() + days`, or null.
  - `public.unmute_chat_player(p_organization_id uuid, p_user_id uuid, p_profile_id uuid) returns text`
    - **Statuses:** `unmuted` | `not_allowed` | `not_found`.
- **Blocked words:**
  - `public.set_chat_blocked_word(p_organization_id uuid, p_user_id uuid, p_word text, p_add boolean) returns text`
    - **Who:** team only.
    - **Statuses:** `added` | `removed` | `exists` | `not_found` | `too_many_words` (500) | `invalid` | `not_allowed`.
    - The word arrives already normalised by `parseBlockedWordForm`.

- [ ] **Step 1: Write `27_chat_moderation.test.sql`:**
  - **Reporting:**
    - reporting your own message → `own_message`; the same player twice → `already_reported`;
    - the 21st report in a day → `too_many_reports`.
  - **Auto-hide:** 3 reporters → state `hidden_by_reports`, `body` null, and player A reads `body` null through the API (`authenticated`) — nothing leaks.
  - **Resolving:**
    - dismiss restores the text and state `visible`;
    - remove → `removed_by_venue`, and all its reports `removed`;
    - a player calling resolve → `not_allowed`;
    - a report kept its `body_copy` after the author removed the message.
  - **Mutes:**
    - mute 1 day → `until` about now + 1 day, and `post_chat_message` returns `muted`;
    - unmute → posting works again.
  - **Word list:**
    - add the same word twice → `exists`;
    - the 501st word → `too_many_words`.
- [ ] **Step 2: Run** `pnpm db:test` — Expected: 27 FAIL.
- [ ] **Step 3: Write the migration;** apply locally.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(db): chat reports, mutes and word list`.

### Task 7: Closing cards and purging (SQL + the every-minute job)

**Files:**
- Create: `supabase/migrations/20261103010500_chat_job_fns.sql`
- Modify: `apps/web/lib/jobs/tick.ts`
- Test: `supabase/tests/database/28_chat_jobs.test.sql`, `apps/web/test/integration/tick.test.ts` (new `describe('chat')`)

**Interfaces:**
- **Consumes:** `private.close_card` (Task 4); `seatsLeft` from `lib/open-play/open-play.ts`.
- **SQL functions:**
  - `public.close_due_chat_cards() returns table (card_id uuid, outcome text)`
    - Handles up to 200 cards a run, `open` or `full`.
    - **Booking or session cancelled** → status `cancelled`, plus `chat_game_cancelled` to the accepted and pending players. Pending requests become `expired`.
    - **Otherwise `starts_at <= now()`** → status `started`; pending requests expire quietly.
    - `outcome` is `'cancelled'` or `'started'`.
  - `public.close_session_cards(p_session_ids uuid[]) returns int` — the open session cards of those sessions become `full`.
  - `public.purge_chat(p_now timestamptz default now()) returns setof text` (photo paths: none in C1; the shape is kept for C2). It deletes:
    - messages with `created_at < p_now - 30 days`, and their archive rows;
    - cards with `ends_at < p_now - 30 days` (their requests and message go by cascade);
    - reports resolved more than 30 days ago;
    - mutes whose `until` passed more than 30 days ago.
- **The job:** `runTick` gains two steps after `close` and before `emails`, so the new notifications go out in the same tick.
  - **`chat cards`:** call `close_due_chat_cards`; read the open session cards (`kind='session'`, `status='open'`) per organization; call `seatsLeft`; then `close_session_cards` for sessions at 0.
  - **`chat purge`:** only when `now.getUTCMinutes() === 0`; calls `purge_chat`.
  - `TickReport` gains `chat: { closed: number; purged: boolean }`.
  - `runTick` takes an optional `now?: Date` in `deps` for the test.

- [ ] **Step 1: Write `28_chat_jobs.test.sql`:**
  - **Closing:**
    - a card whose booking was cancelled → `cancelled`, with one `chat_game_cancelled` for its accepted and one for its pending player;
    - a started card → `started`, with no notifications;
    - running it twice changes nothing.
  - **Purging:**
    - a 31-day-old message goes and a 29-day-old one stays;
    - a card that ended 31 days ago goes, with its requests;
    - a resolved report 31 days old goes, while an open one stays.
- [ ] **Step 2: Write the integration case:**
  - a session card for a session with 0 seats left is `full` after `runTick`;
  - `report.chat.closed` counts the cancelled card;
  - with `now` at minute 0, `purged` is true.
- [ ] **Step 3: Run** `pnpm db:test` and `pnpm test:integration -- tick` — Expected: FAIL.
- [ ] **Step 4: Implement** the migration and the tick steps.
- [ ] **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Commit** — `feat: chat cards close and purge on the job timer`.

### Task 8: Words for the new notifications

**Files:**
- Modify: `apps/web/lib/notifications/render.ts`, `apps/web/messages/en.ts` (`m.notifications`)
- Test: `apps/web/test/notifications-render.test.ts`

**Interfaces:**
- **Consumes:** the payload keys from Task 5.
- **Produces:** six new `NotificationKind` members, each rendered as `{ title, body }`. `body` uses the existing `spaceAndTime` helper ("Pitch 1 (Turf), Fri 23 Oct, 8pm–9pm").

| Kind | Title | Body |
|---|---|---|
| `chat_join_request` | `${player_name} wants to join your game` | `${spaceAndTime}.` |
| `chat_join_accepted` | `${poster_name} accepted you` | `${spaceAndTime}. Their number is on the game page.` |
| `chat_join_declined` | `${poster_name} took you off the game` when `after_accept`, else `${poster_name}'s game didn't work out` | `${spaceAndTime}.` |
| `chat_join_left` | `${player_name} can't make it any more` | `${spaceAndTime}. A spot is open again.` |
| `chat_card_closed` | `${poster_name}'s game is full` when `reason='full'`, else `${poster_name} closed their game` | `${spaceAndTime}.` |
| `chat_game_cancelled` | `${poster_name}'s game was cancelled` | `${spaceAndTime}.` |

- [ ] **Step 1: Failing tests:** one per kind, with payload `{ player_name: 'Tanvir', poster_name: 'Sami', resource_name: 'Pitch 1', section_name: 'Turf', starts_at: '2026-10-23T14:00:00Z', ends_at: '2026-10-23T15:00:00Z' }` and time zone `Asia/Dhaka`. Expect, for example, `{ title: 'Tanvir wants to join your game', body: 'Pitch 1 (Turf), Fri 23 Oct, 8pm–9pm.' }`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/notifications-render.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS. Also run `test/notification-email.test.ts`, which must stay green.
- [ ] **Step 5: Commit** — `feat(web): words for chat notifications`.

### Task 9: Chat data on the server and in the browser (`lib/chat`)

**Files:**
- Create:
  - `apps/web/lib/chat/rows.ts` (client-safe: types and mappers);
  - `apps/web/lib/chat/room.ts` (client-safe reads);
  - `apps/web/lib/chat/reads.ts` (client-safe unread);
  - `apps/web/lib/chat/time.ts`;
  - `apps/web/lib/chat/messages.ts`, `apps/web/lib/chat/cards.ts` and `apps/web/lib/chat/moderation.ts` (all `server-only`).
- Test: `apps/web/test/chat-rows.test.ts`, `apps/web/test/chat-time.test.ts`, `apps/web/test/integration/chat.test.ts`

**Interfaces — Produces:**

*Types and mappers (`rows.ts`):*
```ts
type ChatMessageState = 'visible' | 'removed_by_author' | 'removed_by_venue' | 'hidden_by_reports';
type ChatCardStatus = 'open' | 'full' | 'closed' | 'cancelled' | 'started';
type ChatJoinStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'left' | 'removed' | 'expired';
interface ChatMessage { id: string; authorKind: 'player' | 'team'; authorUserId: string; authorProfileId: string | null;
  authorName: string; body: string | null; cardId: string | null; state: ChatMessageState; createdAt: string }
interface ChatCard { id: string; kind: 'booking' | 'session'; sessionId: string | null; posterUserId: string; posterProfileId: string | null;
  posterName: string; sectionId: string; sectionName: string; sectionKind: BusinessType; sectionAccent: string; title: string;
  startsAt: string; endsAt: string; seatPricePoisha: number | null; spotsNeeded: number | null; spotsTaken: number;
  note: string | null; status: ChatCardStatus; createdAt: string }
messageFromRow(row: Record<string, unknown>): ChatMessage; cardFromRow(row: Record<string, unknown>): ChatCard
mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[]
```
`mergeMessages` keys rows by id, lets the incoming row win, and orders by `createdAt` then `id`.

*Times (`time.ts`):*
- `chatTime(iso, timeZone, now: Date): string` gives `Today, 8:14pm`, `Yesterday, 8:14pm` or `Fri 23 Oct, 8:14pm`.
- `cardWhen(card: Pick<ChatCard, 'startsAt' | 'endsAt'>, timeZone): string` gives `Fri 23 Oct, 8pm–9pm`.

*Reads in the browser, under RLS (`room.ts`, `reads.ts`):*
- `roomPage(db: SupabaseClient, input: { organizationId: string; before?: string; after?: string; limit?: number }): Promise<{ messages: ChatMessage[]; cards: ChatCard[] }>`
  - newest 50 by default, returned oldest first;
  - `after` means newer than that time (catch-up);
  - `cards` = the cards those messages point at.
- `hasUnreadRoom(db, { organizationId, userId }): Promise<boolean>` — true when a `visible` message by someone else is newer than `room_read_at`, or when there's no read row and any such message exists.
- `markRoomRead(db, { organizationId, userId, at: string }): Promise<void>` — upserts the user's own row.

*Messages (`messages.ts`, server-only). Each takes the service client and returns the SQL status:*
- `postMessage(db, { organizationId, userId, body }): Promise<{ status: 'posted'; messageId: string } | { status: ChatRefusal }>`
  - runs `maskBadWords(body, await blockedWords(db, organizationId))` before the RPC.
- `removeMessage(db, { messageId, userId, byVenue }): Promise<'removed' | ChatRefusal>`

*Cards (`cards.ts`, server-only):*
- **Posting and closing:**
  - `postBookingCard(db, { organizationId, userId, bookingId, spots, note })`, which masks the note;
  - `postSessionCard(db, { organizationId, userId, sessionId, note })`, which masks the note too;
  - `closeCard(db, { cardId, userId })`.
- **Join requests:**
  - `requestToJoin(db, { cardId, userId })` and `withdrawRequest(db, { cardId, userId })`;
  - `decideRequest(db, { cardId, userId, profileId, accept })`;
  - `leaveCard(db, { cardId, userId })` and `removeFromCard(db, { cardId, userId, profileId })`.
- **Lists:**
  - `openCards(db, { organizationId }): Promise<Array<ChatCard & { seatsLeft: number | null }>>`: status `open`, soonest first; `seatsLeft` comes from `seatsLeft` for session cards.
  - `cardableBookings(db, { organizationId, profileId, now? }): Promise<Array<{ bookingId: string; label: string; startsAt: string; endsAt: string; maxSpots: number }>>`: upcoming `confirmed` bookings without an `open` or `full` card, capacity above 1; `maxSpots = min(20, capacity − 1)`; `label` = `"Pitch 1 · Turf"`.
  - `shareableSessions(db, { organizationId, profileId: string | null, isTeam: boolean, now? }): Promise<Array<{ sessionId: string; label: string; startsAt: string }>>`: upcoming `open`/`matched` sessions; for a player, only those they've asked for or hold a seat in; without one of this poster's open cards.
- **One card's page:** `cardView(db, { organizationId, cardId, viewer: { userId: string; profileId: string | null; isTeam: boolean } }): Promise<CardView | null>`
  ```ts
  interface CardView { card: ChatCard; role: 'poster' | 'accepted' | 'waiting' | 'team' | 'other';
    myStatus: ChatJoinStatus | null;
    requests: Array<{ profileId: string; name: string; skill: number | null; askedAt: string }>;   // poster: pending only; else []
    accepted: Array<{ profileId: string; name: string; phone: string | null }>;                   // poster: with phones; others: names only, phone null
    posterPhone: string | null }                                                                     // only when role = 'accepted'
  ```
  - Phones come from `player_profiles.phone` and are read **only** when `role` is `'poster'` or `'accepted'`.
  - Skill comes from `profile_section_skills` for the card's section.

*Moderation (`moderation.ts`, server-only):*
- **Actions:**
  - `reportMessage(db, { messageId, userId, reason, note })`, which masks the note;
  - `resolveReports(db, { messageId, userId, action: 'remove' | 'dismiss' })`;
  - `mutePlayer(db, { organizationId, userId, profileId, days })` and `unmutePlayer(db, { organizationId, userId, profileId })`;
  - `setBlockedWord(db, { organizationId, userId, word, add })`.
- **Reads:**
  - `blockedWords(db, organizationId): Promise<string[]>`;
  - `myMute(db, { organizationId, profileId }): Promise<{ until: string | null } | null>`, active mutes only;
  - `listOpenReports(db, organizationId): Promise<Array<{ messageId: string; authorName: string; authorProfileId: string | null; bodyCopy: string | null; state: ChatMessageState; createdAt: string; reports: Array<{ reporterName: string; reason: string; note: string | null; createdAt: string }> }>>`;
  - `listMutes(db, organizationId): Promise<Array<{ profileId: string; name: string; until: string | null }>>`;
  - `openReportCount(db, organizationId): Promise<number>`.

- [ ] **Step 1: Unit tests:**
  - **`mergeMessages`** (Review Focus 1):
    - duplicates by id collapse to one;
    - a changed row (state `removed_by_venue`) replaces the old one;
    - a catch-up batch overlapping the newest messages keeps the order;
    - same `createdAt` values are ordered by id.
  - **`messageFromRow` and `cardFromRow`** map the snake_case Realtime rows.
  - **`chatTime`** with `now` = Fri 23 Oct 2026, 22:00 Dhaka: "Today, 8:14pm", "Yesterday, 11:59pm", "Wed 21 Oct, 9am".
  - **`cardWhen`:** `14:00Z–15:00Z` → `Fri 23 Oct, 8pm–9pm` (Review Focus 4).
- [ ] **Step 2: Integration test `chat.test.ts`** (local stack; fixtures as in `bookings.test.ts`):
  - **Messages:** `postMessage` masks "shit" and stores `●●●`; a venue word added with `setBlockedWord` is masked next time.
  - **Card page, poster and requests:**
    - `cardView` for the poster lists a pending request with skill;
    - after `decideRequest(accept)`, the poster sees the player's phone and the player sees the poster's phone;
    - a third player sees `role 'other'` and no phones at all.
  - **Lists:**
    - `cardableBookings` hides a booking that has an open card;
    - `openCards` returns soonest first, with `seatsLeft` for a session card.
  - **Moderation:**
    - `listOpenReports` groups 2 reports on one message;
    - `myMute` returns the mute.
  - **Unread:** `hasUnreadRoom` is true for B after A posts, and false after `markRoomRead`.
- [ ] **Step 3: Run** `pnpm --filter web exec vitest run test/chat-rows.test.ts test/chat-time.test.ts` and `pnpm test:integration -- chat` — Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run both** — Expected: PASS.
- [ ] **Step 6: Commit** — `feat(web): chat data layer`.

### Task 10: The chat room page and the Chat link

**Files:**
- Create:
  - `apps/web/app/(site)/chat/page.tsx` and `apps/web/app/(site)/chat/actions.ts`;
  - `apps/web/components/chat/chat-room.tsx` (client), `message-item.tsx`, `composer.tsx` and `chat-link.tsx` (client).
- Modify:
  - `apps/web/components/site/site-nav.tsx`: a Chat link on desktop, after the sections; a Chat tab on phones (`MessagesSquare`) before Me/Manage, for everyone;
  - `apps/web/components/site/site-chrome.tsx`: passes `chat: { organizationId, userId, unread }` for anyone signed in;
  - `apps/web/messages/en.ts` (`m.chat`, `m.site.nav.chat`).
- Test: `apps/web/e2e/c1-chat-room.spec.ts`

**Interfaces:**
- **Consumes:** `roomPage`, `markRoomRead`, `hasUnreadRoom`, `mergeMessages`, `messageFromRow`, `chatTime`, `postMessage`, `removeMessage`, `myMute`, `getSitePlayer`.
- **Produces** (`actions.ts`):
  - `sendMessageAction(state: FormState, fd: FormData): Promise<FormState>`, which parses with `parseChatMessageForm`; a refusal → `{ ok: false, message: m.chat.refusal[status] }`;
  - `removeMyMessageAction(messageId: string): Promise<FormState>`;
  - `<ChatRoom>` props: `{ organizationId; timeZone; me: { userId; profileId: string | null; isTeam: boolean; canPost: boolean }; initial: { messages; cards } }`.

**Page states** (spec §2.1):
- **Signed out:** `m.chat.signInToSee` plus a sign-in link with `next=/chat`.
- **Signed in:** the room. Its box reads:
  - "Set up your player profile to chat" (link `/me/edit?next=/chat`) when `profileId` is null and the person isn't on the team;
  - the mute line (`m.chat.mutedUntil(time)` or `m.chat.mutedForever`) when muted;
  - otherwise the composer (Enter sends, Shift+Enter makes a new line).
- **Messages:** each shows the sender's name, `chatTime`, and a **Team** badge when `authorKind = 'team'`. **Load earlier** at the top calls `roomPage({ before: oldest.createdAt })` in the browser and merges the result.

**Live updates:** one channel, `chat:${organizationId}`, takes `postgres_changes` INSERT and UPDATE on `chat_messages` and `chat_cards`, each filtered by `organization_id=eq.${organizationId}`.
- Every time the channel reaches `SUBSCRIBED`, the room calls `roomPage({ after: newest.createdAt })` and merges the result.
- When the channel drops, a "Reconnecting…" line shows.
- If you've scrolled up, a "New messages ↓" button appears instead of jumping.
- After a successful send, the room catches up the same way.
- `markRoomRead` runs on mount and when new messages arrive while the tab is visible, at most once every 10 s, using the newest message's `createdAt`.

**The Chat link** (`ChatLink`): `{ organizationId; userId; initialUnread: boolean }`.
- It listens for INSERTs; a message by someone else, while you're not on `/chat`, turns the dot on.
- On `/chat` it shows no dot.
- Its `aria-label` is `m.chat.linkUnread` when the dot shows.

- [ ] **Step 1: Write `c1-chat-room.spec.ts`.** Fixtures: two players with profiles, created with `localAdmin().db` and `auth.admin.createUser` plus a `player_profiles` insert, each signed in with `signIn` in its own `browser.newContext()`. Cleanup: `removeTestPlayer`.
  - **Signed out:** `/chat` shows "Sign in to see the players chat".
  - **Live message:** A sends "anyone for futsal at 8?" and B, already on `/chat`, sees it without reloading. Within 5 s, B's own message appears for A.
  - **Unread dot:** B goes to `/`, A sends again, and B's Chat link shows the unread label. Opening `/chat` clears it.
  - **Filter:** A sends "what the fuck" and both see "what the ●●●".
  - **Remove:** A removes their own message, and B sees "Message removed".
  - **Load earlier:** with 60 messages seeded through the service client, the room shows 50 and **Load earlier** brings the rest.
- [ ] **Step 2: Run** `pnpm test:e2e -- c1-chat-room` on the local stack (dev server restarted after `pnpm env:local`) — Expected: FAIL.
- [ ] **Step 3: Implement** the page (Suspense around the data, like the other site pages), the actions, the components and the nav changes.
- [ ] **Step 4: Run the e2e** — Expected: PASS. Run `pnpm --filter web exec vitest run` — Expected: all pass.
- [ ] **Step 5: Commit** — `feat(web): live players chat room`.

### Task 11: Need-players cards, the strip and the game page

**Files:**
- Create:
  - `apps/web/components/chat/card-item.tsx`, `card-strip.tsx` and `need-players-form.tsx`;
  - `apps/web/app/(site)/chat/games/[id]/page.tsx` and `apps/web/app/(site)/chat/games/[id]/actions.ts`.
- Modify:
  - `apps/web/app/(site)/chat/page.tsx` and `actions.ts` (add `postCardAction`);
  - `apps/web/components/chat/chat-room.tsx` (cards in the room);
  - `apps/web/messages/en.ts`.
- Test: `apps/web/e2e/c1-chat-cards.spec.ts`

**Interfaces:**
- **Consumes:** the Task 9 card functions, `parseCardForm`, `cardWhen`, `AutoRefresh`, `sectionStyle`.
- **Produces** (`postCardAction` in `chat/actions.ts`):
  - `postCardAction(state, fd): Promise<FormState>`.
- **Produces** (`games/[id]/actions.ts`). Each is `(state: FormState, fd: FormData) => Promise<FormState>`, reads the card id from `fd`, and calls `revalidatePath('/chat/games/[id]')`:
  - `requestAction` and `withdrawAction`;
  - `acceptAction` and `declineAction` (field `profileId`);
  - `leaveAction`;
  - `removePlayerAction` (`profileId`);
  - `closeCardAction`.

**What each part shows** (spec §2.2 and §2.3):
- **The strip:** `openCards`, wrapped in `<AutoRefresh seconds={60} />`.
- **A card in the room:**
  - the section colour and badge, `title`, `cardWhen`, "posted by …", the note;
  - "N spots left" (`spotsNeeded − spotsTaken`) or "N seats left";
  - an **I'm in** link to `/chat/games/[id]` for booking cards, or **Get a seat** to `/sessions/[sessionId]` for session cards;
  - "Full", "Closed", "Cancelled" or "Started" when it isn't open.
- **The Need players form:**
  - a `target` select listing `cardableBookings` and `shareableSessions`;
  - spots (1..`maxSpots`), shown only for bookings, and the note;
  - the team sees only sessions, labelled "Share a game";
  - with nothing to post, `m.chat.needBookingFirst` and links to the sections.
- **The game page:** each `CardView.role` gets its view from §2.2.
  - Phone numbers are `tel:` links; a missing number shows `m.chat.noNumber`, and on your own side a link to `/me/edit`.

- [ ] **Step 1: Write `c1-chat-cards.spec.ts`:**
  - **Setup:** player A has a booking tomorrow at 20:00 Dhaka on a 14-person pitch, inserted with `book_resource` through the service client. A and B have mobiles saved.
  - **Posting:** A posts "Need players" with spots 3 and note "split the cost". B sees the card in the strip and in the room live.
  - **Asking:** B taps I'm in, the game page shows "Waiting for …", and A's bell count goes up.
  - **Accepting:** A accepts B. A then sees B's number, and B sees A's number and "You're in". The card says "2 spots left".
  - **Privacy:** a third player C, opening the game page, sees no numbers.
  - **Leaving:** B taps "Can't make it", and the card says 3 spots left again.
  - **Closing:** A closes the card, and it leaves the strip.
- [ ] **Step 2: Run** `pnpm test:e2e -- c1-chat-cards` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS. Re-run `c1-chat-room`, which must still pass.
- [ ] **Step 5: Commit** — `feat(web): need-players cards and the game page`.

### Task 12: Moderation — message menu, reports and `/manage/chat`

**Files:**
- Create:
  - `apps/web/components/chat/message-menu.tsx` and `report-dialog.tsx`;
  - `apps/web/app/(root)/manage/chat/page.tsx` and `apps/web/app/(root)/manage/chat/actions.ts`.
- Modify:
  - `apps/web/components/chat/message-item.tsx`;
  - `apps/web/app/(site)/chat/actions.ts` (add `reportAction`, `removeAsVenueAction`, `muteAction`);
  - `apps/web/components/manage/manage-nav.tsx` (a **Chat** item for all staff, with the `chatReports` count);
  - `apps/web/app/(root)/manage/layout.tsx` (passes `openReportCount`);
  - `apps/web/messages/en.ts` (`m.manage.chat`, `m.manage.nav.chat`).
- Test: `apps/web/e2e/c1-chat-moderation.spec.ts`

**Interfaces:**
- **Consumes:** the Task 9 moderation functions, `parseReportForm`, `parseMuteForm` and `parseBlockedWordForm`; `requireManager('staff')` for every manage action.
- **Produces** (`/chat` actions), each `(state, fd) => Promise<FormState>`:
  - `reportAction` (players only);
  - `removeAsVenueAction` and `muteAction` (team only; checked with `getSitePlayer().isTeam`, then the SQL checks membership).
- **Produces** (manage actions):
  - `resolveReportsAction` (fields `messageId` and `action`);
  - `muteFromReportAction`, `unmuteAction`, `addWordAction` and `removeWordAction`.

**Who sees which items** in the menu:
- **Your own plain message:** Remove.
- **Someone else's message (players):** Report.
- **Team:** Remove message, plus Mute player for 1 day, 7 days or until unmuted on player messages. The team never sees Report.
- **Removed or hidden messages** show `m.chat.removed`, `m.chat.removedByVenue` or `m.chat.hiddenForReview`.

**`/manage/chat`:**
- **Reports:** one block per reported message, showing the copy, its author, the reports and the actions.
- **Muted players:** each with when the mute ends and **Unmute**.
- **Blocked words:** the list, with add and remove.
- **A link** to `/chat`.

- [ ] **Step 1: Write `c1-chat-moderation.spec.ts`:**
  - **Fixtures:** players A, B, C and D, plus the demo owner `owner@demo-arena.test`.
  - **Auto-hide:** D posts "buy cheap boots here". A, B and C report it as Spam, and after the third report A sees "Hidden while the venue checks it".
  - **Report count:** the owner's Manage menu shows "Chat (1)". On `/manage/chat`, Dismiss brings the message back for A, live.
  - **Removing:** the owner, on `/chat`, removes D's next message, and A sees "Message removed by the venue".
  - **Muting:** the owner mutes D for 1 day. D sees the mute line instead of the box, and `/manage/chat` lists D. Unmute brings D's box back after a reload.
  - **Venue words:** the owner adds the word "gadha", and A's message "tui gadha" shows "tui ●●●".
- [ ] **Step 2: Run** `pnpm test:e2e -- c1-chat-moderation` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS. Run all three `c1-*` specs and `r3-desk`, which must stay green.
- [ ] **Step 5: Commit** — `feat(web): chat moderation and /manage/chat`.

### Task 13: Privacy, terms and the project notes

**Files:**
- Modify: `apps/web/messages/en.ts` (`m.legal`), `memory.md`
- Test: `apps/web/e2e/r2-legal.spec.ts` (two new assertions)

**Exact copy:**
- **`m.legal.updated`:** set to `'Last updated <release date>'`, where the release date is the day the stage is merged, in the same format.
- **Privacy, "What we keep":** add `'The chat: your messages, the "Need players" cards you post, who asks to join them and who you accept, any reports you make, and mutes the venue sets. Signed-in people can read the chat.'`
- **Privacy, "Why we keep it, and who sees it":** add `"When you accept someone for your game, or someone accepts you, the two of you see each other's mobile number (if you've saved one), so you can sort out the details. Nobody else sees it. If someone reports a message, the venue's team sees a copy of it."`
- **Privacy, "How long we keep it, and your choices":** add `'Chat messages are deleted after 30 days, and cards 30 days after the game.'`
- **Terms:** a new section after "Open play games":
  - `heading: 'The chat'`;
  - paragraphs: `'Be friendly. No spam, no selling, and no sharing other people's personal details.'`, `'The venue can remove messages and mute players who break these rules.'`, `'You decide who joins your game and who you meet; take care, as you would anywhere.'`
- **`memory.md`:** a change-log entry for C1, an architecture-map bullet for `lib/chat` and the chat tables, and a §7 future-ideas line pointing to spec §16.

- [ ] **Step 1: Add the failing assertions** to `r2-legal.spec.ts`: `/privacy` shows "Chat messages are deleted after 30 days", and `/terms` has the heading "The chat".
- [ ] **Step 2: Run** `pnpm test:e2e -- r2-legal` — Expected: FAIL.
- [ ] **Step 3: Implement** the copy and the `memory.md` notes.
- [ ] **Step 4: Run the full suite:**
  - `pnpm --filter web exec vitest run`;
  - `pnpm db:test`;
  - `pnpm test:race`;
  - `pnpm test:integration`;
  - `pnpm test:e2e`;
  - `pnpm --filter web build`;
  - `pnpm --filter web typecheck`;
  - `pnpm db:lint`.

  Expected: all green, and the build lists `/chat`, `/chat/games/[id]` and `/manage/chat`.
- [ ] **Step 5: Commit** — `docs: chat in the privacy policy and terms`. Then `pnpm env:hosted` and restart the dev server.
