# Players chat — Stage C2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Private messages between players (Private tab, conversations, block, a 15-minute unread email, the unread count on the Chat link) and one photo per message in the room and in private messages.

**Architecture:** Private messages are `chat_messages` rows with a `conversation_id` (row rules let only the two participants read them), so Realtime, the filter, Remove, Report and the purge work as in C1. Photos are shrunk in the browser and uploaded straight to a private `chat-photos` bucket under the sender's folder. The message stores the path, and the database checks it belongs to the sender. People see a photo through short-lived signed links that the bucket's row rules allow only to those who may see the message. Photos are deleted through the Storage API from a trash queue the database fills, because SQL can't delete storage objects here (`protect_objects_delete`).

**Tech Stack:** As C1: Next.js 16, React 19, Supabase (Postgres, RLS, Realtime, Storage), zod, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-players-chat-design.md` §7 (private messages), §8 (photos), §9–§14 for the C2 parts. C1 is live (`main` `31dac1d`); its plan is `docs/superpowers/plans/2026-11-02-players-chat-c1.md`, and its decisions are in `memory.md` (§4 "Players chat", §8 change log).

## Global Constraints

- Branch `players-chat-c2`. Run `git branch --show-current` before every commit. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every user-facing string lives in `apps/web/messages/en.ts` (`m.chat`, `m.manage.chat`, `m.notifications`).
- SQL in `public`: `security invoker`, `set search_path = ''`, revoked from `public, anon, authenticated`, granted to `service_role`. The one exception is `chat_private_unread`, which is also granted to `authenticated`: it reads under the caller's row rules. Helpers that need `security definer` go in `private`. No `security definer` in `public`.
- Every FK to a tenant table is composite with `organization_id` (pgTAP 06). New tables get RLS and explicit grants (pgTAP 04 lists).
- The browser writes only: its own `chat_reads` row, its own `chat_conversation_reads.read_at`, and uploads into its own `chat-photos/<user id>/` folder.
- **Photos:**
  - Input types: JPEG, PNG or WebP, up to **5 MB**.
  - Shrunk in the browser to a longest side of **1600 px**, then saved as **JPEG at quality 0.82**.
  - Bucket `chat-photos`: private, **2 MB** limit, accepts `image/jpeg`, `image/png` and `image/webp`.
  - Path `<user id>/<uuid>.jpg`.
  - At most **10 photos an hour** per person.
  - Signed links last **600 seconds**.
  - One photo per message. A card message never has a photo.
- **Private messages:**
  - Only between two players with profiles. Team logins never take part.
  - Blocked either way means no messages and no join requests.
  - Muted players can't send them.
  - The same rate limits and filter as the room.
- **Unread email:** sent when a message has been unread for **15 minutes**; at most one per conversation every **12 hours**; only if the recipient allows emails (the existing outbox checks `email_opt_in`). The email never contains the message text.
- **Purge:** messages after 30 days, as in C1. Conversations go 30 days after their last message. Photos are deleted with their message (once no report is open on it), at the purge, or after **one day** if they were uploaded but never posted.
- **Migrations**, applied locally with `pnpm exec supabase migration up --local`:
  - `20261103020000_chat_private_kind.sql`
  - `20261103020100_chat_private_and_photos.sql`
  - `20261103020200_chat_photo_fns.sql`
  - `20261103020300_chat_private_fns.sql`
  - `20261103020400_chat_reminder_fns.sql`
- **Testing:**
  - Tests run on the LOCAL stack: `pnpm env:local`, then a fresh dev server for the e2e tests.
  - Before `pnpm build`, kill every `next dev` node process; stopping the task isn't enough.
  - When done: `pnpm env:hosted` and restart the dev server.
- **Rollout:** the user runs the hosted `db push` before `main` is pushed. `SiteChrome` reads the new RPC on every signed-in page.

## Review Focus

1. **A private message must never show in the Everyone room.** It reaches the room's channel (org filter) and the room's catch-up. Pinned by integration `roomPage leaves private messages out` (Task 7) and the e2e check in Task 9.
2. **A photo path from someone else, made up, reused, or never uploaded, must be refused.** Pinned by pgTAP 32 (Task 4).
3. **A block in either direction must stop messages in an existing conversation and join requests both ways.** Pinned by pgTAP 33 (Task 5).
4. **An unsupported or huge file must get a plain sentence before any upload.** Inputs: HEIC from a desktop, a 9 MB PNG, a PDF renamed `.jpg`. Pinned by `photoProblem` unit tests (Task 1) and the unreadable-image path (Task 8).
5. **The unread email must not repeat.** No second email within 12 hours, none for a message already read, none to someone who turned emails off. Pinned by pgTAP 34 (Task 6).

---

### Task 1: Photo sizing, file checks and the C2 form fields

**Files:**
- Create: `apps/web/lib/chat/photo-size.ts`
- Modify: `apps/web/lib/forms/chat.ts`, `apps/web/messages/en.ts`
- Test: `apps/web/test/chat-photo-size.test.ts`, `apps/web/test/chat-forms.test.ts`

**Interfaces — Produces:**
- `MAX_PHOTO_BYTES = 5 * 1024 * 1024`, `PHOTO_SIDE = 1600`, `PHOTO_QUALITY = 0.82`.
- `fitWithin(width: number, height: number, max = PHOTO_SIDE): { width: number; height: number }`: keeps the aspect ratio, rounds to whole pixels, never upscales.
- `photoProblem(file: { type: string; size: number }): 'type' | 'size' | null`: types `image/jpeg`, `image/png` and `image/webp` only; at most `MAX_PHOTO_BYTES`.
- `isChatPhotoPath(path: string, userId: string): boolean`: true for `^<userId>/<uuid>\.jpg$` only.
- `parseChatMessageForm` now returns `{ body: string | null; photoPath: string | null }`.
  - `photoPath` is the field `photoPath`, kept only when it matches `^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$`.
  - The body may be empty when there is a photo.
  - Neither a body nor a photo gives `m.chat.errors.empty`.
- `parseReportForm` accepts `reason: 'photo'`.
- `ChatRefusal` gains `blocked`, `bad_photo` and `too_many_photos`, with `m.chat.refusal` copy:
  - `blocked`: "You can't message this player."
  - `bad_photo`: "That photo didn't upload properly — try again."
  - `too_many_photos`: "That's 10 photos this hour — try again later."
- `m.chat.photo` = `{ add: 'Add photo', remove: 'Remove photo', type: "That photo type isn't supported — try a JPEG or PNG.", size: 'Photos can be up to 5 MB.', uploadFailed: "The photo didn't upload — try again.", uploading: 'Uploading…', alt: (name: string) => \`Photo from ${name}\`, open: 'Open full size' }`.

- [ ] **Step 1: Failing tests.**
  - **`fitWithin`:**
    - `(4000, 3000)` → `{1600, 1200}`
    - `(1080, 1920)` → `{900, 1600}`
    - `(800, 600)` → `{800, 600}`
    - `(1601, 1)` → `{1600, 1}`
  - **`photoProblem`:**
    - `{type:'image/heic', size:1}` → `'type'`
    - `{type:'application/pdf', size:1}` → `'type'`
    - `{type:'image/png', size: 9*1024*1024}` → `'size'`
    - `{type:'image/jpeg', size: 5*1024*1024}` → `null`
  - **`isChatPhotoPath`:**
    - your own folder → true
    - someone else's folder → false
    - `../x.jpg` → false
    - a `.png` name → false
  - **Forms:**
    - `parseChatMessageForm({ body: '', photoPath: '<uuid>/<uuid>.jpg' })` → `{ body: null, photoPath }`
    - an empty body and no photo → `errors.body`
    - `photoPath: 'x'` with no body → `errors.body`
    - `parseReportForm({ reason: 'photo' })` → ok
  - **Refusals:** the refusal-words test lists the three new keys.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/chat-photo-size.test.ts test/chat-forms.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** In C1 `sendMessageAction` passes `body` on: keep it compiling by passing `parsed.value.body ?? ''` until Task 8.
- [ ] **Step 4: Run** — Expected: PASS. `pnpm --filter web exec tsc --noEmit` passes.
- [ ] **Step 5: Commit** — `feat(web): chat photo sizing and C2 form fields`.

### Task 2: Schema — conversations, blocks, photos and their row rules

**Files:**
- Create: `supabase/migrations/20261103020000_chat_private_kind.sql`, `supabase/migrations/20261103020100_chat_private_and_photos.sql`
- Modify: `supabase/tests/database/04_grants.test.sql` (new tables in the anon list)
- Test: `supabase/tests/database/30_chat_private_schema.test.sql`

**Interfaces — Produces:**

`…020000`: `alter type public.notification_kind add value if not exists 'chat_private_message';`

`…020100`:
```
chat_conversations: id pk, organization_id, profile_low uuid, profile_high uuid (both → player_profiles(id, organization_id) on delete cascade),
  created_at, last_message_at timestamptz not null default now(), unique (id, organization_id),
  unique (organization_id, profile_low, profile_high), check (profile_low < profile_high)
chat_messages: + conversation_id uuid null → chat_conversations(id, organization_id) on delete cascade; + photo_path text null;
  unique index chat_messages_photo_path_key (photo_path) where photo_path is not null; index (conversation_id, created_at desc);
  check (card_id is null or (conversation_id is null and photo_path is null));
  replace chat_messages_check1 with: state <> 'visible' or body is not null or card_id is not null or photo_path is not null
chat_conversation_reads: conversation_id, organization_id, profile_id, read_at timestamptz null, emailed_at timestamptz null,
  primary key (conversation_id, profile_id); FKs to chat_conversations and player_profiles (composite, cascade)
chat_blocks: organization_id, blocker_profile_id, blocked_profile_id, created_at, primary key (blocker_profile_id, blocked_profile_id),
  check (blocker_profile_id <> blocked_profile_id); FKs to player_profiles (composite, cascade); index (blocked_profile_id)
chat_photo_trash: path text primary key, organization_id → organizations on delete cascade, queued_at timestamptz default now()
storage bucket chat-photos: public false, file_size_limit 2097152, allowed_mime_types {image/jpeg,image/png,image/webp}
```

Helpers in `private` (`security definer`, stable):
- `private.is_conversation_member(p_conversation uuid) returns boolean`: the caller's own profile is `profile_low` or `profile_high`.
- `private.can_see_chat_photo(p_name text) returns boolean`. True when a message with `photo_path = p_name` passes one of:
  - a room message (`conversation_id is null`), `visible`, in a live org, and the caller is signed in;
  - a private message, `visible`, and `is_conversation_member(conversation_id)`;
  - it has an `open` report and `is_org_member(organization_id)` (the team reviewing a report).

RLS (`to authenticated`):
- **`chat_messages` select:** replace with `(conversation_id is null and org_is_live(organization_id)) or (conversation_id is not null and is_conversation_member(conversation_id))`. Each function call is wrapped in `(select …)`, as in C1.
- **`chat_conversations` select:** `is_conversation_member(id)`.
- **`chat_conversation_reads`:** select, insert and update own rows (`is_own_profile(profile_id, organization_id)`). Insert also needs `is_conversation_member(conversation_id)`. Grants:
  - `select`, plus `insert (conversation_id, organization_id, profile_id, read_at)` and `update (read_at)`, to authenticated.
  - Everything to service_role.
- **`chat_blocks` select:** `is_own_profile(blocker_profile_id, organization_id)`.
- **`chat_photo_trash`:** no policies; service_role only.
- **`storage.objects`:**
  - `chat_photos_insert` with check `bucket_id = 'chat-photos' and (storage.foldername(name))[1] = (select auth.uid())::text`;
  - `chat_photos_select` using `bucket_id = 'chat-photos' and (select private.can_see_chat_photo(name))`;
  - no update or delete policies.

- [ ] **Step 1: Write `30_chat_private_schema.test.sql`.** Fixtures: players A, B and C with profiles; staff T; a conversation A–B with one message; a room message with photo `room/…`; a private message with a photo; their `storage.objects` rows (insert as postgres into bucket `chat-photos`).
  - **Who reads private messages:**
    - A and B read the private message; C can't, and nor can T.
    - Everyone signed in still reads the room message.
  - **Conversations, reads and blocks:**
    - C reads 0 conversations.
    - A can insert and update their own `chat_conversation_reads.read_at`.
    - A updating `emailed_at` → `42501`.
    - C can't insert a read row for A–B.
    - A reads their own blocks only.
  - **Storage:**
    - B can `select` the private photo's object row; C can't.
    - C can see the room photo.
    - Hidden: after the room message is set `hidden_by_reports`, C can't see its photo, but T can once an open report exists.
    - A can insert an object into `chat-photos/<A>/…`, but not into `<B>/…` (`42501`).
    - `anon` can't read `chat_photo_trash`, and neither can authenticated.
  - **Constraints:**
    - a card message with a photo fails `23514`;
    - two messages with the same `photo_path` fail `23505`;
    - a photo-only message (no body) is accepted.
- [ ] **Step 2: Run** `pnpm db:test` — Expected: 30 FAIL; the rest pass.
- [ ] **Step 3: Write both migrations;** apply locally. Add the new tables to `04_grants.test.sql`'s anon list and update its plan count.
- [ ] **Step 4: Run** `pnpm db:test` and `pnpm db:lint` — Expected: PASS, no issues.
- [ ] **Step 5: Commit** — `feat(db): private conversations, blocks and the chat-photos bucket`.

### Task 3: Words for the private-message notification

**Files:** Modify `apps/web/lib/notifications/render.ts`, `apps/web/messages/en.ts`. Test: `apps/web/test/notifications-render.test.ts`.

**Interfaces — Produces:**
- `NotificationKind` gains `chat_private_message`.
- Payload `{ conversation_id, sender_name, sender_profile_id }`.
- Renders `{ title: \`${sender_name} sent you a message\`, body: 'Open the chat to read it.' }`. The text of the message is never in the email.

- [ ] **Step 1:** Failing test: payload `{ sender_name: 'Sami' }` → `{ title: 'Sami sent you a message', body: 'Open the chat to read it.' }`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/notifications-render.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit — `feat(web): words for the private message notification`.

### Task 4: Photos in SQL — posting, limits and deletion

**Files:**
- Create: `supabase/migrations/20261103020200_chat_photo_fns.sql`
- Test: `supabase/tests/database/32_chat_photos.test.sql`

**Interfaces — Produces:**
- `private.chat_photo_check(p_user_id uuid, p_path text) returns text`. Returns null when the photo is fine, else:
  - `'bad_photo'` when the path isn't `<p_user_id>/<36-char id>.jpg`, has no `storage.objects` row in bucket `chat-photos`, or is already on a message;
  - `'too_many_photos'` when this user has 10 or more messages with a photo in the last hour.
- **`drop function public.post_chat_message(uuid, uuid, text)`**, then `create function public.post_chat_message(p_organization_id uuid, p_user_id uuid, p_body text, p_photo_path text default null) returns table (status text, message_id uuid)`.
  - Same order as C1. Validation: a trimmed body of 1–500 characters, or null when there is a photo; neither → `invalid`. Then `chat_photo_check`, then `chat_guard`.
  - Stores `body` (or null) and `photo_path`.
- `private.trash_photo(p_message_id uuid) returns void`: queues the message's `photo_path` in `chat_photo_trash` unless an `open` report is on the message.
- **`create or replace private.archive_message`** (keep the C1 fix's note handling): when the new state is `removed_by_author` or `removed_by_venue`, also call `trash_photo`. `hidden_by_reports` keeps the photo.
- **`create or replace public.resolve_chat_reports`** (keep the C1 fix's behaviour): after resolving, if the message isn't `visible`, call `trash_photo` (no report is open any more).
- **`create or replace public.purge_chat(p_now timestamptz default now()) returns setof text`.** Before C1's deletes, it queues:
  - the photos of messages being purged;
  - photos in `storage.objects` (bucket `chat-photos`) created more than 1 day before `p_now` that no message points at.

  It also deletes conversations whose `last_message_at < p_now - 30 days`. It returns the paths it queued.
- `public.take_chat_photo_trash(p_limit int) returns setof text`: the oldest queued paths, without removing them.
- `public.forget_chat_photo_trash(p_paths text[]) returns void`: removes those paths from the queue once Storage has deleted them.

- [ ] **Step 1: Write `32_chat_photos.test.sql`.** Insert `storage.objects` rows as postgres to stand in for uploads.
  - **Posting:**
    - Photo only (body `null`) → `posted` with `body` null.
    - Photo with a caption → posted.
    - Bad paths → `bad_photo` (Review Focus 2): someone else's folder, a path with no object, and the same path a second time.
    - An 11th photo in an hour → `too_many_photos`.
    - Neither text nor photo → `invalid`.
  - **Deletion:**
    - Author removes → the path is in `chat_photo_trash`.
    - Removed with an open report → not queued until the report is resolved; then queued.
    - Hidden by 3 reports → not queued; dismiss → still not queued.
  - **Purge:** queues a 31-day-old message's photo, and an object uploaded 2 days ago that was never posted, but not one uploaded 1 hour ago. It deletes a conversation whose last message was 31 days ago.
  - **The queue:** `take_chat_photo_trash(10)` lists the paths; `forget_chat_photo_trash` empties them.
- [ ] **Step 2: Run** `pnpm db:test` — Expected: 32 FAIL.
- [ ] **Step 3:** Write the migration; apply locally. C1's tests 25 and 27–29 must still pass, because the replaced functions keep their behaviour.
- [ ] **Step 4: Run** `pnpm db:test` — Expected: PASS.
- [ ] **Step 5:** Commit — `feat(db): chat photos — checks, limits and the trash queue`.

### Task 5: Private messages and blocks in SQL

**Files:**
- Create: `supabase/migrations/20261103020300_chat_private_fns.sql`
- Test: `supabase/tests/database/33_chat_private.test.sql`

**Interfaces:**
- **Consumes:** `private.chat_guard`, `private.chat_photo_check` and `private.chat_is_muted`.
- **Produces:**
  - `private.is_blocked(p_organization_id uuid, p_a uuid, p_b uuid) returns boolean`: either direction.
  - `public.post_private_message(p_organization_id uuid, p_user_id uuid, p_to_profile_id uuid, p_body text, p_photo_path text default null) returns table (status text, message_id uuid, conversation_id uuid)`
    - **Statuses:**
      - `posted`;
      - `no_profile` (the sender is on the team or has no profile);
      - `not_found` (the recipient is missing, is yourself, or is a team member);
      - `blocked`, `muted`, `invalid`, `bad_photo`, `too_many_photos`, `too_fast`.
    - **Order:** sender → recipient → blocked → muted → body/photo → photo check → `chat_guard`.
    - **Writes:** finds or creates the conversation for the ordered pair, inserts the message (`author_kind 'player'`), sets `last_message_at`, and upserts the sender's `chat_conversation_reads.read_at = now()`.
  - `public.block_chat_player(p_organization_id uuid, p_user_id uuid, p_profile_id uuid) returns text`: `blocked` | `no_profile` | `not_found` (missing, or yourself).
  - `public.unblock_chat_player(...)`, same arguments: `unblocked` | `not_found`.
  - `public.chat_private_unread(p_organization_id uuid) returns int`
    - **Runs as** `security invoker` under the caller's row rules, granted to authenticated.
    - **Counts:** visible private messages by the other person, newer than the caller's `read_at` (or all of them without a read row).
  - **`create or replace public.request_to_join`** (keep C1's fix): after the own-card check, `blocked` when `is_blocked(poster profile, requester profile)`.
  - **`create or replace public.report_chat_message`** (keep C1's fix): on a private message the reporter must be a participant, else `not_found`.

- [ ] **Step 1: Write `33_chat_private.test.sql`.**
  - **Posting:**
    - A → B posts and creates one conversation; B → A reuses it.
    - `chat_private_unread` as B (`authenticated`) is 1, and 0 after B updates `read_at`.
    - A → A, or A → staff → `not_found`.
    - Staff → B → `no_profile`.
    - Muted A → `muted`.
  - **Blocks (Review Focus 3):**
    - B blocks A → A → B `blocked`, and B → A `blocked` too, in the existing conversation.
    - `request_to_join` between them is `blocked` both ways.
    - Unblock → posting works.
  - **Reports:** C reporting the A–B message → `not_found`; B reporting it → `reported`.
  - **Other rules:** a private photo needs the photo checks too (`bad_photo`), and the shared rate limit applies (`too_fast`).
- [ ] **Step 2: Run** `pnpm db:test` — Expected: 33 FAIL.
- [ ] **Step 3:** Write the migration; apply locally.
- [ ] **Step 4: Run** `pnpm db:test` — Expected: PASS (C1's 26 and 29 too).
- [ ] **Step 5:** Commit — `feat(db): private messages and blocks`.

### Task 6: The unread email and the job's new steps

**Files:**
- Create: `supabase/migrations/20261103020400_chat_reminder_fns.sql`
- Modify: `apps/web/lib/jobs/tick.ts`
- Test: `supabase/tests/database/34_chat_reminders.test.sql`, `apps/web/test/integration/tick.test.ts`

**Interfaces — Produces:**
- `public.due_private_message_reminders(p_now timestamptz default now()) returns int`, capped at 100 a run.
  - **Who:** each (conversation, recipient) with a visible message from the other person, sent more than 15 minutes before `p_now` and newer than the recipient's `read_at`, where `emailed_at` is null or more than 12 hours before `p_now`.
  - **What it sends:** one `chat_private_message` notification with link `/chat/private/<sender profile id>`.
  - **Then:** upserts `emailed_at = p_now`.
- **`runTick` steps** after `chat purge`, before `emails`:
  - `chat reminders` calls the reminder function.
  - `chat photos` calls `take_chat_photo_trash(100)`, then `db.storage.from('chat-photos').remove(paths)`, then `forget_chat_photo_trash(paths)`, but only for the paths Storage confirms.
  - `TickReport.chat` gains `reminders: number; photosDeleted: number`.

- [ ] **Step 1: Write `34_chat_reminders.test.sql`** (Review Focus 5):
  - **Fires:** a message unread for 20 minutes → 1 notification to the recipient, with the right link.
  - **Doesn't repeat:** running again at once → 0. Again 13 hours later with a new unread message → 1.
  - **Doesn't fire when:**
    - the message is 10 minutes old;
    - it's already read (`read_at` after it);
    - it's your own message;
    - it was removed.
- [ ] **Step 2: Integration case.**
  - **Setup:** upload an object to `chat-photos` with the service client and queue it in `chat_photo_trash`.
  - **Then** run `runTick` (any minute).
  - **Expect:** the object is gone from Storage, the queue is empty and `report.chat.photosDeleted >= 1`.
- [ ] **Step 3: Run** `pnpm db:test` and `pnpm test:integration` — Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5: Run** — Expected: PASS.
- [ ] **Step 6:** Commit — `feat: unread private-message emails and photo clean-up on the job timer`.

### Task 7: Chat data for C2 (`lib/chat`)

**Files:**
- Create: `apps/web/lib/chat/private.ts`, `apps/web/lib/chat/photos.ts` (client-safe)
- Modify: `apps/web/lib/chat/rows.ts`, `room.ts`, `reads.ts`, `messages.ts`, `moderation.ts`
- Test: `apps/web/test/integration/chat-private.test.ts`

**Interfaces — Produces:**
- **`rows.ts`:** `ChatMessage` gains `conversationId: string | null` and `photoPath: string | null` (with `MESSAGE_COLUMNS` and `messageFromRow`).
- **`room.ts`:**
  - `roomPage` and `roomSince` take `conversationId?: string`. When given, they filter on it; when not, they filter `conversation_id is null` (Review Focus 1).
  - `isRoomMessage(m: ChatMessage): boolean` (`conversationId === null`).
- **`reads.ts`:**
  - `hasUnreadRoom` counts room messages only.
  - `privateUnread(db, organizationId): Promise<number>` (the RPC).
  - `markConversationRead(db, { conversationId, organizationId, profileId, at })`: upserts `read_at` only.
- **`messages.ts`:**
  - `postMessage(db, { organizationId, userId, body: string | null, photoPath: string | null })`.
  - `postPrivateMessage(db, { organizationId, userId, toProfileId, body, photoPath }): Promise<{ status: 'posted'; messageId: string; conversationId: string } | { status: ChatRefusal }>`, filter applied.
- **`private.ts`** (service client; names come from here, because players can't read each other's profiles):
  - `listConversations(db, { organizationId, profileId }): Promise<Array<{ conversationId: string; otherProfileId: string; otherName: string; lastText: string | null; lastHasPhoto: boolean; lastAt: string; unread: number }>>`, newest first.
  - `conversationWith(db, { organizationId, profileId, otherProfileId }): Promise<{ conversationId: string | null; otherName: string; blockedByMe: boolean; blockedMe: boolean } | null>`. Null for a missing profile, yourself or a team member.
  - `blockPlayer` / `unblockPlayer(db, { organizationId, userId, profileId })`.
  - `blockedByMe(db, { organizationId, profileId }): Promise<string[]>`.
  - `playerCard(db, { organizationId, profileId, viewerProfileId }): Promise<{ name: string; sections: string[]; blockedByMe: boolean } | null>`. `sections` are the names of the sections where they have a skill.
- **`moderation.ts`:** `OpenReport` gains `photoPath: string | null` and `isPrivate: boolean`.
- **`photos.ts`** (browser):
  - `prepareChatPhoto(file: File): Promise<{ blob: Blob } | { problem: 'type' | 'size' | 'unreadable' }>`: `photoProblem` → `createImageBitmap` → canvas at `fitWithin` → `toBlob('image/jpeg', PHOTO_QUALITY)`.
  - `uploadChatPhoto(db, userId, blob): Promise<string | null>`: path `${userId}/${crypto.randomUUID()}.jpg`.
  - `signedPhotoUrls(db, paths: string[]): Promise<Map<string, string>>`: `createSignedUrls(paths, 600)`; paths it may not see are left out.

- [ ] **Step 1: Write `chat-private.test.ts`.** Local stack: players A, B and C with profiles, and staff T.
  - **Posting privately:**
    - `postPrivateMessage` A → B masks "shit".
    - `listConversations` for B shows Sami, the last text and `unread: 1`.
    - `privateUnread` as B (signed-in client) is 1, and 0 after `markConversationRead`.
  - **Rows stay apart (Review Focus 1):**
    - `roomPage` as B (no conversation) leaves the private message out.
    - `roomPage` with the conversation id as C returns nothing.
  - **Lookups:**
    - `conversationWith` for T → null.
    - `playerCard` shows B's sections.
    - After `blockPlayer`, `conversationWith` says `blockedByMe` and `blockedByMe()` lists A.
  - **Photos:**
    - Upload a real 1×1 JPEG as A (signed-in client) to their folder, then `postMessage` with that path in the room.
    - `signedPhotoUrls` as C returns a URL that fetches with status 200.
    - The same as C for a private photo between A and B returns no entry.
- [ ] **Step 2: Run** `pnpm test:integration -- chat-private` — Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `pnpm --filter web exec tsc --noEmit` green: callers of `postMessage` pass `photoPath: null` until Task 8.
- [ ] **Step 4: Run** it and `pnpm test:integration` (the C1 chat test too) — Expected: PASS.
- [ ] **Step 5:** Commit — `feat(web): chat data for private messages and photos`.

### Task 8: Photos in the room

**Files:**
- Create: `apps/web/components/chat/photo-picker.tsx`, `apps/web/components/chat/chat-photo.tsx`
- Modify:
  - `apps/web/components/chat/composer.tsx`: props `{ action, hidden?: Record<string, string>, userId: string, onSent: (result: FormState & { conversationId?: string }) => void }`, plus the photo picker and a hidden `photoPath`;
  - `components/chat/message-item.tsx`: shows the photo above the caption;
  - `components/chat/chat-room.tsx`: drops private rows (`isRoomMessage`) from live events, and passes `action={sendMessageAction}` and `userId={me.userId}` to the Composer;
  - `components/chat/report-dialog.tsx`: an "Inappropriate photo" reason when the message has a photo;
  - `app/(site)/chat/actions.ts`: `sendMessageAction` passes `photoPath`;
  - `messages/en.ts`.
- Test: `apps/web/e2e/c2-chat-photos.spec.ts`

**What it does:**
- **Picking a photo:** the picker runs `prepareChatPhoto`. A problem shows `m.chat.photo.type` or `m.chat.photo.size` (unreadable shows the `type` message), and nothing is uploaded.
- **Upload and preview:** the file goes up with `uploadChatPhoto`, then a thumbnail appears with Remove photo.
- **Sending:** Send sends the caption (or none) with the path.
- **Showing a photo:** `ChatPhoto` asks `signedPhotoUrls` for its path, shows the image with `alt={m.chat.photo.alt(authorName)}`, and opens full size in a lightbox when tapped. A link it can't get shows nothing.
- **Removed or hidden messages** show no photo.

- [ ] **Step 1: Write `c2-chat-photos.spec.ts`.** Two players; the fixture photo is a small PNG written from a base64 string in the test.
  - **Posting:** A attaches it with the caption "our team", and B sees the image live (`naturalWidth > 0`) with its caption.
  - **Refusals before upload:** a 6 MB file gives "Photos can be up to 5 MB.", and a `.txt` renamed `.jpg` gives the type message. Neither creates a `storage.objects` row (checked through `localAdmin().db`).
  - **Removing:** A removes the message; B sees "Message removed" and no image; `chat_photo_trash` holds the path.
- [ ] **Step 2: Run** `pnpm test:e2e -- c2-chat-photos` (dev server on the local stack) — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Run** it and the three `c1-*` specs — Expected: PASS.
- [ ] **Step 5:** Commit — `feat(web): photos in the chat room`.

### Task 9: Private messages on the site

**Files:**
- Create:
  - `apps/web/components/chat/chat-tabs.tsx`
  - `apps/web/components/chat/player-panel.tsx`
  - `apps/web/components/chat/conversation-room.tsx`
  - `apps/web/app/(site)/chat/private/page.tsx`
  - `apps/web/app/(site)/chat/private/[profileId]/page.tsx`
  - `apps/web/app/(site)/chat/private/actions.ts`
- Modify:
  - `app/(site)/chat/page.tsx` (tabs; passes the blocked list);
  - `components/chat/chat-room.tsx`:
    - a player's name opens `PlayerPanel` (not for your own messages, the team's, or when you're a team member or have no profile);
    - messages and cards by people you blocked collapse to one line, `m.chat.blockedLine(n)`;
  - `components/chat/chat-link.tsx` and `components/site/site-nav.tsx`: `ChatLinkState` gains `privateUnread: number`, live; the link shows the number when there is one (it wins over the dot) and the `aria-label` is `m.chat.linkPrivate(n)`;
  - `components/site/site-chrome.tsx` (reads `privateUnread` for players);
  - `messages/en.ts`.
- Test: `apps/web/e2e/c2-chat-private.spec.ts`

**Copy** (`m.chat`):
- `blockedLine: (n) => n === 1 ? '1 message from someone you blocked' : `${n} messages from someone you blocked``
- `linkPrivate: (n) => n === 1 ? 'Chat — 1 unread private message' : `Chat — ${n} unread private messages``
- `private: { everyone: 'Everyone', title: 'Private', none: "No private messages yet. Tap a player's name in the chat to message them.", teamNote: "Team logins don't send private messages.", message: 'Message', block: 'Block', unblock: 'Unblock', plays: (sections: string) => `Plays: ${sections}`, photoOnly: 'Photo' }`

**Interfaces — Produces** (`private/actions.ts`):
- `sendPrivateAction(state, fd): Promise<FormState & { conversationId?: string }>`, with fields `toProfileId`, `body` and `photoPath`;
- `blockAction(profileId: string)` and `unblockAction(profileId: string)`, both returning `Promise<FormState>`, then `refresh()`;
- `playerCardAction(profileId: string): Promise<{ name; sections; blockedByMe } | null>`.

**The pages:**
- **Tabs:** "Everyone" goes to `/chat`; "Private" goes to `/chat/private` and shows the unread count.
- **`/chat/private`:**
  - signed out → the sign-in prompt;
  - a team member → `m.chat.private.teamNote`;
  - no profile → set up your profile;
  - otherwise `listConversations`, each row linking to `/chat/private/<otherProfileId>` with an unread badge, or `m.chat.private.none`.
- **`/chat/private/[profileId]`:**
  - `conversationWith` null → `notFound()`;
  - blocked either way → `m.chat.refusal.blocked`, plus Unblock when you blocked them;
  - otherwise `ConversationRoom`.
- **`ConversationRoom`:**
  - **Live messages:** `subscribeSignedIn` on `chat-dm:<id>:<suffix>` with filter `conversation_id=eq.<id>`, subscribing after the first send creates the conversation.
  - **Catch-up and reading:** catch-up through `roomSince({ conversationId })`; `markConversationRead` at most every 10 seconds while visible.
  - **The menu:** your own message → Remove; theirs → Report.
  - **Composer:** has `hidden={{ toProfileId }}`.
  - **Header:** Block in the header.
- **PlayerPanel:**
  - shows the name and "Plays: Turf, Gaming lounge";
  - **Message** goes to `/chat/private/<id>`;
  - **Block / Unblock** via the actions.

- [ ] **Step 1: Write `c2-chat-private.spec.ts`** with players A and B.
  - **Starting a conversation:** A opens B's name panel in the room → Message → sends "hi there". B, on `/`, sees the Chat link labelled "Chat — 1 unread private message".
  - **Reading and replying:** B opens Private → Sami → reads it. The count clears. B replies with a photo, and A sees the photo live.
  - **Kept out of the room:** B's Everyone room never shows "hi there" (Review Focus 1).
  - **Blocking:**
    - B blocks A from the conversation;
    - after a reload, A sees "You can't message this player." and no box;
    - A's room messages show as "1 message from someone you blocked" in B's room;
    - B unblocks and the box comes back.
- [ ] **Step 2: Run** `pnpm test:e2e -- c2-chat-private` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Run** it, `c2-chat-photos` and the `c1-*` specs — Expected: PASS.
- [ ] **Step 5:** Commit — `feat(web): private messages, blocking and the unread count`.

### Task 10: Reports on photos and private messages, the copy, and the full suite

**Files:**
- Modify:
  - `apps/web/app/(root)/manage/chat/page.tsx`: shows the reported photo with `ChatPhoto` (the team's session may see it while the report is open), and a "Private message" label;
  - `apps/web/messages/en.ts`: the `m.legal` lines below and the `m.manage.chat` labels;
  - `memory.md`;
  - `apps/web/e2e/r2-legal.spec.ts`.
- Test: `apps/web/e2e/c2-chat-reports.spec.ts`, plus the `r2-legal` assertions.

**Exact copy:**
- **`m.legal.updated`:** the merge date.
- **Privacy, "What we keep":** add `'Private messages between players, photos you share in the chat, and who you have blocked.'`
- **Privacy, "Why we keep it, and who sees it":** add `"A private message is seen only by the two of you. If one of you reports it, the venue's team sees a copy of that message, and its photo, until they decide. Photos in the chat are seen by signed-in people; photos in a private message only by the two of you."`
- **Privacy, "Emails":** add `"If a private message waits unread for 15 minutes, we email you once to say so (never what it says), at most once every 12 hours for each conversation."`
- **Privacy, "How long we keep it, and your choices":** extend the chat sentence to `'Chat messages, private messages and their photos are deleted after 30 days, and cards 30 days after the game.'`
- **Terms, "The chat":** add `'Only share photos you have the right to share, and nothing indecent.'`

- [ ] **Step 1: Write the failing tests.**
  - **`c2-chat-reports.spec.ts`:**
    - **Report:** B reports A's private photo message as "Inappropriate photo".
    - **The team's view:** on `/manage/chat`, the owner sees the "Private message" label and the photo loaded, then clicks Remove message.
    - **Afterwards:** B sees "Message removed", and the path is in `chat_photo_trash`.
  - **`r2-legal`:** `/privacy` shows "A private message is seen only by the two of you", and `/terms` shows "Only share photos you have the right to share".
- [ ] **Step 2: Run** both — Expected: FAIL.
- [ ] **Step 3: Implement.** Write the copy, and the `memory.md` change log, §4 and §7 entries.
- [ ] **Step 4: Full suite** (kill every `next dev` before the build):
  - `pnpm --filter web exec vitest run`;
  - `pnpm db:test`;
  - `pnpm test:race`;
  - `pnpm test:integration`;
  - `pnpm test:e2e`;
  - `pnpm --filter web lint`;
  - `pnpm --filter web typecheck`;
  - `pnpm db:lint`;
  - `pnpm --filter web build`;
  - `pnpm exec supabase db diff --local`.

  Expected: all green; the build lists `/chat/private` and `/chat/private/[profileId]`; "No schema changes found".
- [ ] **Step 5: Commit** — `docs: private messages and photos in the privacy policy and terms`. Then `pnpm env:hosted` and restart the dev server.
