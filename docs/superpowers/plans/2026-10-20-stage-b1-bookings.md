# Stage B1 — Bookings, Notifications and Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Venues take real whole-space bookings.
- A player books 1–4 slots of a pitch, table or zone on the venue's subdomain.
- Staff add walk-ins (name + phone) from a day view.
- Everyone involved gets an in-app notification (live bell) and an email delivered by a 10-second background job.
- Booking history can no longer be deleted by accident.

**Architecture:**
- **Database.**
  - New migrations protect booking history (`on delete no action`).
  - Venue booking settings and slot length are new columns.
  - Three new tables-and-function groups:
    - `notifications`, the outbox, with Realtime;
    - `resource_bookings`, which writes `resource_reservations`, so the existing exclusion constraint refuses overlaps;
    - `service_role`-only SQL functions that do every write atomically and write the notification in the same transaction.
- **TypeScript.**
  - A pure slot-grid module checks hours, grid and horizon.
  - Domain modules (`lib/bookings`, `lib/notifications`, `lib/email`, `lib/jobs`) take a `SupabaseClient`, so integration tests can call them directly.
- **Jobs.** `pg_cron` calls `pg_net`, which posts to `/api/jobs/tick` every 10 s with a Vault-held secret. The tick delivers pending emails through an `EmailSender` (SMTP → Mailpit locally; Resend adapter for Stage E).

**Tech Stack:**
- Existing: Next.js 16.4 (App Router, Cache Components), Tailwind 4, shadcn base-nova, Vitest 5, Supabase CLI 2.121 (Postgres 17, pgTAP), `@supabase/ssr` ^0.12.7, `@supabase/supabase-js` ^2.118.0, zod ^4.6.7.
- New:
  - `nodemailer` **10.0.15** (exact; it ships its own types; 10.1.x is under two weeks old);
  - `pg` ^8.23.1 as an `apps/web` devDependency, for the env script;
  - Postgres extensions `pg_cron`, `pg_net`;
  - Supabase Vault (already enabled locally).

**Spec:** `docs/superpowers/specs/2026-10-20-stage-b-booking-matchmaking-design.md`, §§1–3, 5–9 as they apply to **B1**. Parent: `2026-10-20-booking-platform-design.md`. Notes: `memory.md`.

## Global Constraints

- **Branch.** Work on `stage-b1-bookings`, cut from `stage-b-design` (which holds the spec and this plan). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Migrations.**
  - Create each one with `pnpm exec supabase migration new <name>`; never edit an existing migration.
  - Apply it with `pnpm exec supabase migration up --local`. **Don't run `db:reset` casually**: the local DB holds the demo venue.
  - Prove from-scratch replay with `pnpm exec supabase db diff --local --schema public`. Expected: `No schema changes found`.
- **RLS and grants.**
  - Every new table enables RLS in the migration that creates it.
  - Grants are explicit (`revoke all … from anon, authenticated`, then specific grants).
  - One permissive policy per table, role and action. `pnpm db:lint` must pass.
- **Functions.**
  - No `security definer` function in `public`.
  - Every function sets `search_path = ''`.
  - New booking and email functions are `security invoker` and executable by `service_role` only. They return status text, like M1.
- **Tenant references.** References between tenant tables are composite `(x_id, organization_id) → parent (id, organization_id)`, with an index leading on `x_id`. `06_tenant_refs.test.sql` fails otherwise.
- **pgTAP tests don't assume an empty database.** Use fixture ids and slugs no real venue would use, and scope every count to those fixtures.
- **Money and time.**
  - Money is `int` poisha; show it with `formatBdt()`.
  - Times are computed and shown in the venue's `organizations.timezone` (`formatNight`, `formatShortTime` from `lib/format.ts`).
  - A time range reads `Fri 23 Oct, 8pm–9pm`.
- **Copy.** All UI and email copy lives in `apps/web/messages/en.ts`. Notification payloads carry ids, times and venue data (names), never sentences.
- **Next.js 16.**
  - Read `apps/web/node_modules/next/dist/docs/` for any API you use.
  - Session-reading parts render inside `<Suspense>`.
  - Server actions call `refresh()` after mutating.
  - After adding keys to `en.ts`, restart the dev server if new labels render empty (memory.md §6).
- **Server code.**
  - Domain modules take a `SupabaseClient` parameter and **don't** import `server-only`. Only `lib/service-client.ts` and route handlers touch secrets.
  - Server actions check the caller first (`requireOrgRole` / `requireUser` + profile at this live venue), then use the service client.
- **Phones.** Walk-in phones go through `normalizePhone` (`lib/forms/profile.ts`) and are stored as `+880…`.
- **Email is only ever sent by the tick** (the outbox). No request path sends email.
- **Tests.**
  - `pnpm test` stays database-free.
  - Database tests: `pnpm db:test`, `pnpm test:race`, `pnpm test:integration` (local Supabase; Mailpit SMTP on 54325).

## Review Focus

1. **Junk URL parameters** on `/book` and the staff Bookings view: `?date=2026-02-30`, `?date=abc`, a resource id from another venue, a malformed uuid. They show today or the first space, or "not found", and never cause a 500. Tested in Tasks 7 and 8.
2. **Overnight venues** (hours 14:00–02:00). A 01:00 slot belongs to the **previous business day** in grids, booking checks and lists. "My bookings" sorts by real time. Tested in Tasks 7 and 8.
3. **Settings changed after bookings exist:** slot length changed, hours shortened, space deactivated. Existing bookings still show as taken (by overlap, not by grid match), stay listed, and stay cancellable. Tested in Tasks 7 and 8.
4. **Walk-in phones in local formats** (`01712-345678`, `+880 1712 345678`) normalise, and junk is a field error. A walk-in never produces a notification or email. Tested in Tasks 6 and 8.
5. **Double submit.** A second click on Book for the same slot by the same player answers "already yours", not "taken". A second Cancel answers "already cancelled". Tested in Task 8.

---

### Task 1: Protect booking history

**Files:**
- Create: migration `protect_booking_history`, `supabase/tests/database/07_history.test.sql`
- Modify: `apps/web/app/(root)/manage/[slug]/actions.ts` (`deleteBranchAction`), `apps/web/messages/en.ts`

**Interfaces:**
- Produces: these composite FKs (names unchanged from `20261020191000_tenant_scoped_fks.sql`) become `on delete no action`:
  - `groups_session_id_fkey`, `groups_resource_id_fkey`, `groups_activity_id_fkey`
  - `bookings_session_id_fkey`, `bookings_group_id_fkey`, `bookings_profile_id_fkey`
  - `waitlist_entries_session_id_fkey`, `waitlist_entries_profile_id_fkey`
  - `seat_offers_group_id_fkey`, `seat_offers_waitlist_entry_id_fkey`
  - `events_session_id_fkey`
- Produces: `m.manage.branchInUse`.

- [ ] **Step 1: Write the failing test** `07_history.test.sql`. Fixtures: org `history-org-p`, with a branch, pitch, activity, session, group, profile and one confirmed booking.
  - `is_empty`: none of the 11 constraints above has `confdeltype <> 'a'`.
  - `throws_ok` 23503: delete the profile.
  - `throws_ok` 23503: delete the activity.
  - `throws_ok` 23503: delete the session.
  - `lives_ok`: delete the organization.
  - `is`: the fixture booking count is 0 afterwards.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: 07 fails on the catalog check and the three `throws_ok`.
- [ ] **Step 3: Implement the migration.**
  - For each constraint: drop it and re-add it with the same name, same `(x_id, organization_id) → parent (id, organization_id)`, and `on delete no action`. The indexes already exist.
  - Apply with `migration up`.
  - `deleteBranchAction`: on error code `23503` return `{ ok: false, message: m.manage.branchInUse }`, with the copy "This branch has bookings or sessions, so it can't be deleted. Deactivate its spaces instead."
- [ ] **Step 4: Run** `pnpm db:test && pnpm db:lint && pnpm test:integration`. Expected: PASS (the integration cleanups still delete whole organizations).
- [ ] **Step 5: Commit** `feat(db): protect booking history from cascading deletes`.

### Task 2: Venue booking settings and slot length

**Files:**
- Create: migration `booking_settings`, `apps/web/lib/forms/booking-settings.ts`, `apps/web/test/booking-settings-form.test.ts`
- Modify:
  - `presets/types.ts`, `presets/{boardgame,turf,lounge}.ts`, `test/presets.test.ts`
  - `lib/forms/resource.ts`, `test/forms.test.ts`
  - `lib/orgs/create-organization.ts`
  - `app/(root)/manage/[slug]/{actions.ts,settings/page.tsx,resources/page.tsx}`
  - `messages/en.ts`
  - `supabase/tests/database/01_schema.test.sql`, `04_grants.test.sql`

**Interfaces:**
- **Columns:**
  - `organizations.booking_horizon_days smallint not null default 14` (1–90)
  - `cancel_cutoff_minutes int not null default 120` (0–10080)
  - `match_cutoff_minutes int not null default 360` (0–10080)
  - `max_upcoming_bookings smallint not null default 3` (1–20)
  - `organizations_cutoffs_check check (match_cutoff_minutes > cancel_cutoff_minutes)`
  - `resources.slot_minutes smallint not null default 60 check (slot_minutes between 15 and 240 and slot_minutes % 15 = 0)`; the migration runs `update public.resources set slot_minutes = 120 where kind = 'table'`
  - The owner update grant becomes `(name, branding, booking_horizon_days, cancel_cutoff_minutes, match_cutoff_minutes, max_upcoming_bookings)`.
- **Presets:** each `Preset['resources']` item gains `slotMinutes: number`: 120 for `table`, 60 otherwise. `createOrganization` inserts `slot_minutes`.
- **`parseBookingSettingsForm(formData): FormResult<BookingSettings>`**, where `BookingSettings = { bookingHorizonDays: number; cancelCutoffMinutes: number; matchCutoffMinutes: number; maxUpcomingBookings: number }`.
  - Form fields: `horizonDays` (1–90), `cancelCutoffHours` (0–168), `matchCutoffHours` (0–168), `maxUpcoming` (1–20). Hours × 60 = minutes.
  - Match hours ≤ cancel hours → error on `matchCutoffHours`: `m.forms.matchAfterCancel`, with the copy "Matching must happen before the cancellation cut-off (a larger number of hours)."
- **`parseResourceForm`** gains `slotMinutes`: field `slotMinutes`, 15–240, a multiple of 15, error `m.forms.slotLength`.
- **`saveBookingSettingsAction(slug, _state, form)`** (owner): updates through the RLS client and calls `refresh()`.

- [ ] **Step 1: Write the failing tests.**
  - **`booking-settings-form.test.ts`:**
    - `{14, 2, 6, 3}` → `{ bookingHorizonDays: 14, cancelCutoffMinutes: 120, matchCutoffMinutes: 360, maxUpcomingBookings: 3 }`;
    - cancel 0 / match 1 → ok;
    - match 2 / cancel 2 → error on `matchCutoffHours`;
    - horizon 91 → error on `horizonDays`;
    - `abc` → error.
  - **`forms.test.ts`:** `slotMinutes` 90 → ok; 50 → error; 255 → error.
  - **`presets.test.ts`:** every preset resource has `slotMinutes` 120 when `kind === 'table'`, else 60.
  - **pgTAP `01_schema`:**
    - `throws_ok` 23514: an org with `match_cutoff_minutes = 120, cancel_cutoff_minutes = 120`;
    - `throws_ok` 23514: a resource with `slot_minutes = 50`.
  - **pgTAP `04_grants`:**
    - `has_column_privilege('authenticated', 'public.organizations', 'max_upcoming_bookings', 'UPDATE')`;
    - `not has_column_privilege('authenticated', 'public.organizations', 'status', 'UPDATE')`.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm db:test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The migration and the presets.
  - `createOrganization`.
  - The forms, plus a "Bookings" card on the Settings page with the four fields, showing hours.
  - A slot-length input on the Resources form, plus "60 min slots" on each resource row.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm db:test && pnpm db:lint && pnpm test:integration && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: venue booking settings and slot length`.

### Task 3: Notifications outbox (replaces `messages`)

**Files:**
- Create:
  - migration `notifications`
  - `apps/web/lib/notifications/{render.ts,inbox.ts}`
  - `apps/web/test/notifications-render.test.ts`, `apps/web/test/integration/notifications.test.ts`
  - `supabase/tests/database/08_notifications.test.sql`
- Modify: `supabase/tests/database/{01_schema,04_grants,06_tenant_refs}.test.sql`, `messages/en.ts`

**Interfaces:**
- **Enums:**
  - `notification_kind`: `booking_confirmed`, `booking_cancelled`, `seat_confirmed`, `waitlisted`, `offer`, `offer_expired`, `seat_cancelled`, `session_cancelled`, `no_seat` (all nine now; B2 uses the last seven).
  - `email_status`: `pending`, `sending`, `sent`, `failed`, `skipped`.
- **Table `notifications`:**
  - Columns: `id`, `organization_id`, `profile_id`, `kind`, `payload jsonb not null default '{}'`, `link text not null`, `read_at`, `email_status not null default 'pending'`, `email_attempts smallint not null default 0`, `email_claimed_at`, `emailed_at`, `created_at`.
  - `(profile_id, organization_id) → player_profiles (id, organization_id) on delete cascade`.
  - Indexes: `notifications_profile_id_idx (profile_id, organization_id, created_at desc)`, `notifications_email_pending_idx (created_at) where email_status = 'pending'`.
  - RLS:
    - `select` and `update` to authenticated using `private.is_own_profile(profile_id, organization_id)`;
    - grants: `select` plus `update (read_at)` only.
  - `alter publication supabase_realtime add table public.notifications`.
  - Drop `public.messages` and `public.message_direction`.
- **`type NotificationKind`** (the nine values) and **`renderNotification(n: { kind: NotificationKind; payload: Record<string, unknown> }, timeZone: string): { title: string; body: string }`** in `render.ts` (pure).
  - `booking_confirmed`: payload `{ booking_id, resource_name, starts_at, ends_at, price_poisha }`.
    - Title: "Booking confirmed".
    - Body: "Pitch 1, Fri 23 Oct, 8pm–9pm. Pay ৳2,500 at the venue.", or "… Pay at the venue." when the price is 0.
  - `booking_cancelled`: payload `{ booking_id, resource_name, starts_at, ends_at, by_venue }`.
    - Title: "The venue cancelled your booking" when `by_venue`, otherwise "Booking cancelled".
    - Body: "Pitch 1, Fri 23 Oct, 8pm–9pm."
  - The B2 kinds return `{ title: m.notifications.update, body: '' }` until B2.
- **`inbox.ts`** (RLS client):
  - `listNotifications(db, profileId, organizationId, limit = 50): Promise<InboxItem[]>`, where `InboxItem = { id: string; kind: NotificationKind; payload: Record<string, unknown>; link: string; readAt: string | null; createdAt: string }`, newest first.
  - `unreadCount(db, profileId, organizationId): Promise<number>`.
  - `markAllRead(db, profileId, organizationId): Promise<void>`.

- [ ] **Step 1: Write the failing tests.**
  - **`08_notifications.test.sql`:**
    - player P sees their row, and player Q sees 0 rows;
    - staff of the venue see 0 rows;
    - `throws_ok` 42501 on an insert as authenticated;
    - `lives_ok`: P updates `read_at`;
    - `throws_ok` 42501: P updates `kind`;
    - the table is in `pg_publication_tables` for `supabase_realtime`.
  - **`01`/`04`:** swap `messages` for `notifications`, and `message_direction` for the two new enums.
  - **`06`:** replace the messages assertion with "deleting a profile with no history deletes its notifications".
  - **`notifications-render.test.ts`:** the exact strings above, for `Asia/Dhaka` with `starts_at 2026-10-23T14:00:00Z` and `ends_at 2026-10-23T15:00:00Z`.
  - **`integration/notifications.test.ts`:**
    - `markAllRead` through the player's signed-in client sets `read_at` and `unreadCount` becomes 0;
    - **Realtime:** a signed-in player subscribed to `postgres_changes` INSERT with filter `profile_id=eq.<P>` receives a row inserted by the service client within 5 s;
    - Q's subscription receives nothing within 2 s.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm db:test && pnpm test:integration -- notifications`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration, then `render.ts` and `inbox.ts`, plus copy under `m.notifications`.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm db:test && pnpm db:lint && pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: notifications outbox with realtime`.

### Task 4: Email delivery

**Files:**
- Create:
  - migration `email_outbox`
  - `apps/web/lib/email/{sender.ts,notification-email.ts}`, `apps/web/lib/notifications/deliver.ts`
  - `apps/web/test/notification-email.test.ts`, `apps/web/test/email-sender.test.ts`
  - `apps/web/test/integration/deliver.test.ts`, `supabase/tests/database/09_email_outbox.test.sql`
- Modify:
  - `supabase/config.toml`: under `[local_smtp]`, uncomment `smtp_port = 54325`, then `pnpm db:stop && pnpm db:start`
  - `apps/web/package.json` (`nodemailer` `10.0.15`)
  - `test/integration/global-setup.ts`: default `SMTP_HOST=127.0.0.1`, `SMTP_PORT=54325`, `EMAIL_FROM`

**Interfaces:**
- **SQL:**
  - `public.claim_pending_emails(p_limit int) returns setof public.notifications`.
    - It takes rows with `email_status = 'pending'`, or `'sending'` with `email_claimed_at < now() - interval '5 minutes'`, oldest first, `for update skip locked`.
    - It sets `email_status = 'sending'`, `email_attempts + 1` and `email_claimed_at = now()`.
  - `public.finish_email(p_notification_id uuid, p_outcome text) returns text`.
    - `'sent'` → `sent` + `emailed_at`; `'skipped'` → `skipped`.
    - `'failed'` → `failed` when attempts ≥ 3, otherwise back to `pending`.
    - It returns the resulting status; any other outcome raises.
- **`sender.ts`:**
  - `interface EmailMessage { to: string; subject: string; html: string; text: string }`
  - `interface EmailSender { send(message: EmailMessage): Promise<void> }`
  - `createEmailSender(env: Record<string, string | undefined>): EmailSender`:
    - `EMAIL_TRANSPORT=smtp` → nodemailer with `SMTP_HOST`/`SMTP_PORT`, `secure: false`;
    - `resend` → `fetch('https://api.resend.com/emails')` with `RESEND_API_KEY`;
    - both use `EMAIL_FROM`;
    - a missing or unknown transport, or missing fields, → `Error` naming the variable.
- **`notificationEmail(input: { kind: NotificationKind; payload: Record<string, unknown>; venueName: string; primaryColour: string; siteUrl: string; link: string; timeZone: string }): { subject: string; html: string; text: string }`**:
  - subject `` `${venueName}: ${title}` ``;
  - the body text, then a button to `siteUrl + link`;
  - a footer: "Change your email settings on your profile: <siteUrl>/me";
  - venue data is HTML-escaped.
- **`deliverPendingEmails(db, sender: EmailSender, opts: { limit: number }): Promise<{ sent: number; skipped: number; failed: number }>`:**
  1. Claim the batch.
  2. For each row, load the profile (`email_opt_in`, `user_id`) and org (`name`, `slug`, `timezone`, `branding.primary` or the preset primary).
  3. Opted out, or no Auth email → `skipped`.
  4. Otherwise send to `tenantUrl(slug)` → `sent`; a throw → `failed` (`finish_email` decides retry or final).

- [ ] **Step 1: Write the failing tests.**
  - **`09_email_outbox.test.sql`:**
    - a claim returns a pending row, now `sending` with attempts 1;
    - a second claim in the same transaction returns nothing;
    - a row claimed 6 minutes ago is reclaimable;
    - `finish_email(...,'failed')` at attempts 1 → `pending`, at attempts 3 → `failed`;
    - an unknown outcome raises;
    - `authenticated` cannot execute either function (42501).
  - **`notification-email.test.ts`:**
    - the subject is `Dhanmondi Turf: Booking confirmed`;
    - the html contains `http://dhanmondi-turf.localhost:3000/me/bookings`;
    - the venue name `<b>X</b>` is escaped to `&lt;b&gt;X&lt;/b&gt;`;
    - the text has no HTML.
  - **`email-sender.test.ts`:** `{}` throws naming `EMAIL_TRANSPORT`; `smtp` without `SMTP_HOST` throws naming it; `resend` without `RESEND_API_KEY` throws.
  - **`integration/deliver.test.ts`:**
    - a recording sender gets one email per pending row, and the rows become `sent`;
    - an opted-out profile → `skipped` and no email;
    - an always-throwing sender → `pending` with attempts 1, and after three runs `failed`;
    - `Promise.all` of two `deliverPendingEmails` runs sends each row exactly once;
    - with `createEmailSender({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325', EMAIL_FROM: 'Test <t@localhost>' })`, the message appears in Mailpit (`/api/v1/messages`) with the expected subject.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm db:test && pnpm test:integration -- deliver`. Expected: FAIL.
- [ ] **Step 3: Implement.** Also broaden `m.profile.emailOptIn` to "Email me about my bookings and seats" (spec §6). The flag now governs every notification email.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm db:test && pnpm db:lint && pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: email outbox delivery (SMTP/Mailpit, Resend adapter)`.

### Task 5: The 10-second tick

**Files:**
- Create:
  - migration `jobs_tick`
  - `apps/web/lib/jobs/{auth.ts,tick.ts}`, `apps/web/app/api/jobs/tick/route.ts`
  - `apps/web/test/job-auth.test.ts`, `apps/web/test/integration/tick.test.ts`
  - `supabase/tests/database/10_jobs.test.sql`
- Modify:
  - `apps/web/proxy.ts`
  - `apps/web/scripts/write-env-local.mjs`, `apps/web/.env.example`
  - `apps/web/package.json` (devDependency `pg` ^8.23.1)

**Interfaces:**
- **SQL:**
  - `create extension if not exists pg_cron;` and `create extension if not exists pg_net with schema extensions;`.
  - `private.trigger_tick() returns bigint`:
    - reads `app_url` and `job_secret` from `vault.decrypted_secrets`;
    - if either is missing it returns `null` and does nothing;
    - otherwise it returns `net.http_post(url := app_url || '/api/jobs/tick', headers := jsonb_build_object('Authorization', 'Bearer ' || job_secret, 'Content-Type', 'application/json'), body := '{}'::jsonb)`.
  - `select cron.schedule('tick', '10 seconds', 'select private.trigger_tick()')`.
- **`authorizeJob(header: string | null, secret: string | undefined): boolean`**: `Bearer <secret>`, compared with `timingSafeEqual`. A missing header, or an empty or unset secret, → `false`.
- **`runTick(deps: { db: SupabaseClient; sender: EmailSender }): Promise<TickReport>`**, where `TickReport = { emails: { sent: number; skipped: number; failed: number } }`. B1 has one step: `deliverPendingEmails(db, sender, { limit: 50 })`.
- **Route `POST /api/jobs/tick`:**
  - 401 `{ error: 'unauthorized' }` unless `authorizeJob(request.headers.get('authorization'), process.env.JOB_SECRET)`;
  - otherwise 200 with `runTick({ db: createServiceClient(), sender: createEmailSender(process.env) })` as JSON.
- **`proxy.ts`:** paths starting `/api/jobs/` return `NextResponse.next()` **before** the session refresh and host routing.
- **`pnpm env:local`** also writes:
  - `JOB_SECRET` (`randomBytes(32).toString('hex')`, new each run);
  - `EMAIL_TRANSPORT=smtp`, `SMTP_HOST=127.0.0.1`, `SMTP_PORT=54325`;
  - `EMAIL_FROM=Booking & Matchmaking <bookings@localhost>`.

  It then replaces both Vault secrets through `pg` on `status.DB_URL`: `delete from vault.secrets where name in ('app_url','job_secret')`, then `vault.create_secret('http://host.docker.internal:3000','app_url')` and `vault.create_secret(<secret>,'job_secret')`.
- **`.env.example`** documents those variables plus `RESEND_API_KEY`.

- [ ] **Step 1: Write the failing tests.**
  - **`job-auth.test.ts`:**
    - the right secret → true;
    - a wrong secret of the same length → false;
    - a different length → false;
    - a `null` header → false;
    - secret `''` or `undefined` → false even for `'Bearer '`.
  - **`10_jobs.test.sql`:**
    - `cron.job` has `jobname = 'tick'` with `schedule = '10 seconds'`;
    - after deleting both Vault secrets in the transaction, `private.trigger_tick()` is null and no new `net.http_request_queue` row exists;
    - after creating both, it returns an id, and the queued row's `url` is `<app_url>/api/jobs/tick`.
  - **`integration/tick.test.ts`:** `runTick` with a recording sender delivers a pending notification and reports `emails.sent = 1`; a second run reports 0.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm db:test && pnpm test:integration -- tick`. Expected: FAIL.
- [ ] **Step 3: Implement**, apply the migration, and run `pnpm env:local`.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm db:test && pnpm db:lint && pnpm test:integration && pnpm --filter web build`. Expected: PASS. Then, with the dev server up:
  - `curl -s -o /dev/null -w "%{http_code}" -X POST -H "Host: host.docker.internal:3000" http://localhost:3000/api/jobs/tick` → `401`;
  - the same request with `-H "Authorization: Bearer $JOB_SECRET"` → `200`;
  - a pending notification inserted with the service client becomes `sent` within 20 s without any manual call, proving the cron → Vault → pg_net → route → Mailpit chain.
- [ ] **Step 5: Commit** `feat: 10-second job tick (pg_cron → pg_net → /api/jobs/tick)`.

### Task 6: `resource_bookings` and its SQL functions

**Files:**
- Create: migration `resource_bookings`, `supabase/tests/database/11_resource_bookings.test.sql`, `supabase/tests/race/book-resource-race.test.ts`
- Modify: `supabase/tests/database/{01_schema,04_grants}.test.sql`

**Interfaces:**
- **Enum** `resource_booking_status`: `confirmed`, `cancelled`, `attended`, `no_show`.
- **Table `resource_bookings`:**
  - Columns: `id`, `organization_id`, `resource_id`, `profile_id`, `guest_name`, `guest_phone`, `period tstzrange not null check (not isempty(period))`, `price_poisha int not null check (price_poisha >= 0)`, `status not null default 'confirmed'`, `created_by → auth.users on delete set null`, `cancelled_by → auth.users on delete set null`, `created_at`, `cancelled_at`.
  - `resource_bookings_who_check check ((profile_id is not null) <> (guest_name is not null and guest_phone is not null))`.
  - FKs: `(resource_id, organization_id)` and `(profile_id, organization_id)`, both `on delete no action`.
  - Indexes: `(organization_id)`, `(resource_id, organization_id)`, `(profile_id, organization_id)`, `(created_by)`, `(cancelled_by)`.
  - RLS select: own profile or org member. Grants: `select` to authenticated, nothing to anon.
- **`public.book_resource(p_organization_id uuid, p_resource_id uuid, p_starts_at timestamptz, p_slots int, p_profile_id uuid, p_guest_name text, p_guest_phone text, p_created_by uuid) returns table (status text, booking_id uuid)`:**
  1. **`invalid`** when: `p_slots` isn't 1–4; the resource isn't an active resource of the org; both or neither of profile/guest are given; or the profile isn't in the org.
  2. **Limit (player bookings):** lock the profile (`for update`), count its `confirmed` bookings with `upper(period) > now()`, and return `limit_reached` at `max_upcoming_bookings`.
  3. **Period and price:** period = `[p_starts_at, p_starts_at + p_slots × slot_minutes)`; price = `round(price_per_hour_poisha × slot_minutes × p_slots / 60.0)`, or 0 when the space has no price.
  4. **Writes:** insert the booking and a `resource_reservations` row (`source 'booking'`, `source_id` = booking id) inside a `begin … exception when exclusion_violation` block; a violation returns `taken`.
  5. **Notification:** for a player, a `booking_confirmed` notification with payload `{ booking_id, resource_name, starts_at, ends_at, price_poisha }` and link `/me/bookings`.
  6. Returns `booked` with the id.
- **`public.cancel_resource_booking(p_booking_id uuid, p_cancelled_by uuid) returns text`:**
  - returns `not_found` or `not_cancellable` (status isn't `confirmed`);
  - otherwise sets `cancelled`, `cancelled_at` and `cancelled_by`, and deletes its reservation;
  - for a player, writes `booking_cancelled` with `by_venue = p_cancelled_by is distinct from <profile's user_id>`;
  - returns `cancelled`.
- **`public.set_resource_booking_status(p_booking_id uuid, p_status public.resource_booking_status) returns text`:** `updated` (only `confirmed → attended | no_show`), `invalid` or `not_found`.
- All three are `service_role` only.

- [ ] **Step 1: Write the failing tests.**
  - **`11_resource_bookings.test.sql`** (org `rb-org-p`, branch hours 10:00–23:00, Pitch 1 ৳2,500/h with 60-min slots, a session reserving Pitch 1 19:00–20:00, players A and B, `max_upcoming_bookings` 2):
    - A books 20:00 × 1 → `booked`, price 250000, with one reservation;
    - B books 20:00 → `taken`;
    - B books 19:00 (open play) → `taken`;
    - B books 21:00 → `booked` (back-to-back);
    - a walk-in (guest name + `+8801712345678`) at 22:00 → `booked`, and **no notification is written**;
    - an insert with both a profile and a guest → 23514;
    - an insert with a guest name but no phone → 23514;
    - with A at the limit, a staff walk-in on another slot is still `booked` (walk-ins don't count);
    - `p_slots` 5 → `invalid`;
    - another org's resource → `invalid`;
    - A at 2 upcoming → `limit_reached`;
    - A's `booking_confirmed` notification exists with the payload above;
    - cancelling A's booking → `cancelled`, its reservation is gone, and B can now book 20:00;
    - cancelling again → `not_cancellable`;
    - cancelled by staff → `by_venue` true;
    - `set_resource_booking_status(...,'no_show')` on a confirmed booking → `updated`, and on a cancelled one → `invalid`;
    - A sees only A's bookings, staff see all, and B sees only B's;
    - `authenticated` executing `book_resource` → 42501.
  - **`01`/`04`:** add the table and enum; authenticated has only `SELECT` on `resource_bookings`.
  - **Race test** (two `pg` connections):
    - two `book_resource` calls for the same slot at once → exactly one `booked`, one `taken`;
    - a player with `max_upcoming_bookings = 1` booking two different slots at once → one `booked`, one `limit_reached`.
- [ ] **Step 2: Run** `pnpm db:test && pnpm test:race`. Expected: FAIL.
- [ ] **Step 3: Implement the migration**, then `migration up`.
- [ ] **Step 4: Run** `pnpm db:test && pnpm db:lint && pnpm test:race`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): whole-space bookings with atomic book/cancel functions`.

### Task 7: Slot grid (pure TypeScript)

**Files:**
- Create: `apps/web/lib/bookings/slots.ts`, `apps/web/test/slots.test.ts`

**Interfaces:**
- `interface Slot { start: Date; end: Date }`
- `type SlotState = 'free' | 'taken' | 'open_play' | 'past'`
- `localDate(instant: Date, timeZone: string): string` → `YYYY-MM-DD`
- `addDays(date: string, days: number): string`
- `parseDateParam(value: string | undefined, today: string): string` → the value if it's a real calendar date, otherwise `today`
- **`businessDaySlots(hours: OpeningHours, date: string, slotMinutes: number, timeZone: string): Slot[]`:** from that date's opening time, step `slotMinutes` while `start + slotMinutes ≤ close`. A close ≤ open runs into the next calendar day. A closed day → `[]`.
- **`slotStates(slots: Slot[], busy: Array<{ start: Date; end: Date; source: 'booking' | 'session' }>, now: Date): Array<Slot & { state: SlotState }>`:**
  - `past` if `start ≤ now`;
  - otherwise any overlap with a `session` → `open_play`;
  - overlap with a `booking` → `taken`;
  - else `free`.
  - Overlap is by time, not grid match.
- **`checkBookingStart(input: { hours: OpeningHours; slotMinutes: number; timeZone: string; startsAt: Date; slots: number; now: Date; horizonDays: number | null }): { ok: true; endsAt: Date; businessDate: string } | { ok: false; reason: 'bad_count' | 'past' | 'off_grid' | 'outside_hours' | 'beyond_horizon' }`:**
  - `bad_count` unless `slots` is 1–4;
  - `past` if `startsAt ≤ now`;
  - the business date is the start's local date, or the previous date when the start falls in that date's overnight tail;
  - `off_grid` unless `startsAt` is a slot start of its business day;
  - `outside_hours` unless `startsAt + slots × slotMinutes ≤` that day's close;
  - `beyond_horizon` when `horizonDays` isn't null and `businessDate > addDays(localDate(now), horizonDays)`.

- [ ] **Step 1: Write the failing tests** (`Asia/Dhaka`; 2026-10-23 is a Friday):
  - 10:00–23:00 with 60-min slots → 13 slots, first `10:00`, last `22:00–23:00`;
  - 90-min slots → last start `21:00`;
  - 14:00–02:00 with 60-min slots → 12 slots, the last `01:00–02:00` on 2026-10-24;
  - a closed day → `[]`;
  - `checkBookingStart`:
    - 20:00 × 1 → ok with `businessDate '2026-10-23'`;
    - 20:30 → `off_grid`;
    - 22:00 × 2 → `outside_hours`;
    - 0 or 5 slots → `bad_count`;
    - a start before `now` → `past`;
    - 15 days ahead with horizon 14 → `beyond_horizon`, but `null` horizon → ok;
    - **overnight (Review Focus 2):** 01:00 on 2026-10-24 for hours `14:00–02:00` → ok with `businessDate '2026-10-23'`;
  - **`slotStates` (Review Focus 3):** a booking 20:30–21:30 on a 60-min grid marks both 20:00 and 21:00 `taken`; a session 19:00–20:00 marks 19:00 `open_play`; a slot starting at `now` is `past`;
  - **`parseDateParam` (Review Focus 1):** `'2026-02-30'`, `'abc'` and `undefined` → today; `'2026-10-23'` → itself.
- [ ] **Step 2: Run** `pnpm --filter web test -- slots`. Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse `zonedTimeToUtc` (`@bm/sim`), and move `localDayAndMinutes` and `window` from `lib/schedule/time.ts` into an export the two modules share. Don't duplicate them.
- [ ] **Step 4: Run** `pnpm --filter web test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): slot grid for whole-space bookings`.

### Task 8: Booking server logic

**Files:**
- Create: `apps/web/lib/bookings/bookings.ts`, `apps/web/lib/forms/walk-in.ts`, `apps/web/test/walk-in-form.test.ts`, `apps/web/test/integration/bookings.test.ts`

**Interfaces** (all take `db: SupabaseClient`, the service client from actions):
- **`bookSpace(db, input: BookSpaceInput): Promise<BookSpaceResult>`:**
  - `BookSpaceInput = { organizationId: string; resourceId: string; startsAt: Date; slots: number; who: { profileId: string } | { guestName: string; guestPhone: string }; createdBy: string; actor: 'player' | 'staff'; now?: Date }`
  - `BookSpaceResult = { status: 'booked'; bookingId: string } | { status: 'taken' } | { status: 'already_yours' } | { status: 'limit_reached' } | { status: 'invalid'; reason: 'not_bookable' | 'bad_count' | 'past' | 'off_grid' | 'outside_hours' | 'beyond_horizon' }`
  - Steps:
    1. Load the org (live, timezone, horizon) and the resource with its branch hours. An unknown or inactive resource, or a non-live org → `not_bookable`.
    2. `checkBookingStart`, with `horizonDays: actor === 'staff' ? null : org horizon`.
    3. Call `book_resource`.
    4. On `taken` with a player, if a confirmed booking of the same profile overlaps → `already_yours`.
- **`cancelSpaceBooking(db, input: { organizationId: string; bookingId: string; actor: { kind: 'player'; profileId: string } | { kind: 'staff' }; cancelledBy: string; now?: Date }): Promise<'cancelled' | 'too_late' | 'not_cancellable' | 'not_found'>`:**
  - A player may cancel only their own booking (else `not_found`), and only while `now < start − cancel_cutoff_minutes` (else `too_late`).
- **`setSpaceBookingStatus(db, input: { organizationId: string; bookingId: string; status: 'attended' | 'no_show' }): Promise<'updated' | 'invalid' | 'not_found'>`.**
- **`spaceDay(db, input: { organizationId: string; resourceId: string; date: string; withNames: boolean; now?: Date }): Promise<SpaceDay | null>`:**
  - `SpaceDay = { resource: { id: string; name: string; slotMinutes: number; pricePerHourPoisha: number | null }; slots: Array<Slot & { state: SlotState; booking?: { id: string; name: string; phone: string | null; status: string } }> }`
  - Returns `null` for a resource outside the org.
  - `booking` is filled only when `withNames`: player `display_name` with no phone, or walk-in name + phone.
- **`branchDay(db, input: { organizationId: string; branchId: string; date: string; now?: Date }): Promise<SpaceDay[] | null>`:** active resources, `withNames: true`; returns `null` for a foreign branch.
- **`listMyBookings(db, input: { organizationId: string; profileId: string; now?: Date }): Promise<{ upcoming: MyBooking[]; past: MyBooking[] }>`:**
  - `MyBooking = { id: string; resourceName: string; startsAt: string; endsAt: string; pricePoisha: number; status: string; cancellable: boolean }`
  - Sorted by `startsAt` (upcoming ascending, past descending).
  - `cancellable` = confirmed and `now < start − cutoff`.
- **`parseWalkInForm(formData): FormResult<{ guestName: string; guestPhone: string; slots: number }>`:** name 1–60, phone required via `normalizePhone` (`m.profile.phoneFormat`), slots 1–4.

- [ ] **Step 1: Write the failing tests.**
  - **`walk-in-form.test.ts` (Review Focus 4):** `'01712-345678'` and `'+880 1712 345678'` → `+8801712345678`; `'12345'` → error on `guestPhone`; an empty name → error.
  - **`integration/bookings.test.ts`** (a fresh org per file, hours 10:00–23:00, `now` fixed to 2026-10-20 12:00 Dhaka):
    1. a player books Fri 2026-10-23 20:00 → `booked`;
    2. a second player at the same slot → `taken`;
    3. **(Review Focus 5)** the same player again → `already_yours`;
    4. staff walk-in at 21:00 → `booked`;
    5. a player 20:30 → `invalid/off_grid`;
    6. a player beyond 14 days → `beyond_horizon`, while staff at the same time → `booked`;
    7. a foreign resource id → `not_bookable`;
    8. **`spaceDay`:**
       - `withNames: false` hides names;
       - staff `branchDay` shows the walk-in's phone;
       - a foreign resource → `null`;
       - **(Review Focus 1)** a malformed uuid → `null`, not a throw;
    9. **cancelling:**
       - the player cancels 3 h before → `cancelled`;
       - the player cancels at 1 h before → `too_late`;
       - another player cancels someone else's booking → `not_found`;
       - staff cancel at 1 h before → `cancelled`;
       - **(Review Focus 5)** a second cancel → `not_cancellable`;
    10. **(Review Focus 3)** after the resource is deactivated and its `slot_minutes` changed to 90, the existing booking is still in `listMyBookings`, the grid still shows it `taken`, and it is cancellable;
    11. **(Review Focus 2)** with hours 14:00–02:00, a booking at 01:00 on the 24th is accepted against business day 23, and `listMyBookings` orders it after a 23:00 booking on the 23rd.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm test:integration -- bookings`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): booking, cancelling and day views for whole spaces`.

### Task 9: Player screens

**Files:**
- Create:
  - `apps/web/components/tenant/tenant-header.tsx`, `apps/web/components/notifications/bell.tsx`
  - `apps/web/components/bookings/slot-picker.tsx`
  - `apps/web/app/t/[slug]/book/{page.tsx,actions.ts}`
  - `apps/web/app/t/[slug]/me/bookings/{page.tsx,actions.ts}`
  - `apps/web/app/t/[slug]/me/notifications/{page.tsx,actions.ts}`
- Modify: `apps/web/app/t/[slug]/layout.tsx`, `apps/web/app/t/[slug]/page.tsx`, `messages/en.ts`

**Interfaces:**
- **`TenantHeader`** (server, inside the layout's Suspense):
  - logo and name linking to `/`;
  - links: **Book a space** (`/book`), **My bookings** (`/me/bookings`), **Profile** (`/me`) or **Sign in**;
  - `<Bell profileId initialUnread />` when the signed-in user has a profile here.
  - The public page drops its own "My profile" button and gains a **Book a space** call to action.
- **`Bell`** (client): subscribes as in Task 3's test; increments on INSERT; shows the count; links to `/me/notifications`; unsubscribes on unmount.
- **`/book`:**
  - `requireUser('/book')`; with no profile, a card "Create your profile first" links to `/me`.
  - Query params: `?resource=<id>&date=YYYY-MM-DD`, with defaults of the first active resource and today, through `parseDateParam` (Review Focus 1).
  - Shows the resource picker, the date picker (today … horizon), and `spaceDay(withNames: false)` as a grid of free, taken, open-play and past cells.
  - **`SlotPicker`** chooses a start and 1–4 slots, then submits `bookSpaceAction(slug, resourceId, _state, form)`. Form fields: `startsAt` (ISO), `slots`.
  - Statuses map to the `m.bookings.*` copy:

    | Status | Message |
    |---|---|
    | `booked` | "Booked! See My bookings." |
    | `taken` | "That time was just taken. Pick another slot." |
    | `already_yours` | "You've already booked this slot." |
    | `limit_reached` | "You already have N upcoming bookings here. Cancel one to book another." |
    | `invalid` | One line per reason |
- **`/me/bookings`:** upcoming and past lists from `listMyBookings`, each row reading "Pitch 1 · Fri 23 Oct, 8pm–9pm · ৳2,500 · Confirmed".
  - Cancellable rows get **Cancel**, through `cancelMyBookingAction(slug, bookingId, _state, _form)`.
  - Rows past the cut-off show "Contact the venue to cancel".
- **`/me/notifications`:** `listNotifications` rendered with `renderNotification`, linking each to its `link`. A client effect calls `markAllReadAction(slug)` once on mount.

- [ ] **Step 1: Implement** the components, pages and actions.
- [ ] **Step 2: Run** `pnpm --filter web lint && pnpm typecheck && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 3: Browser check** (Playwright MCP; screenshots into the workspace):
  1. A player on `dhanmondi-turf.localhost:3000` opens **Book a space**, picks Pitch 1 and next Friday 8pm × 1, and books.
  2. The bell shows **1** without a reload.
  3. Mailpit has "Dhanmondi Turf: Booking confirmed" within 20 s.
  4. `/me/bookings` lists the booking, and **Cancel** frees the slot (the grid shows it free again).
  5. `/book?date=abc` and `?resource=<foreign id>` render without an error.
- [ ] **Step 4: Commit** `feat(web): book a space, my bookings and live notifications`.

### Task 10: Staff Bookings day view

**Files:**
- Create: `apps/web/app/(root)/manage/[slug]/bookings/{page.tsx,actions.ts}`
- Modify: `apps/web/app/(root)/manage/[slug]/layout.tsx` (nav: **Bookings** after Schedule), `messages/en.ts`

**Interfaces:**
- **Page** (staff or above):
  - `?branch=<id>&date=YYYY-MM-DD`, defaulting to the first branch and today; a foreign branch → `notFound()`.
  - Previous and next day links.
  - One column per active space from `branchDay`.
  - **Free future cells** hold a `<details>` "+ Walk-in" form (name, phone, slots).
  - **Booked cells** show the name, with the phone for walk-ins, the status, and **Cancel**, **Attended** and **No-show**.
  - **Open-play cells** read "Open play".
- **Actions:**
  - `walkInAction(slug, resourceId, startsAt, _state, form)`: staff; `parseWalkInForm` then `bookSpace({ actor: 'staff', who: guest })`.
  - `staffCancelBookingAction(slug, bookingId, _state, _form)`.
  - `setBookingStatusAction(slug, bookingId, status, _state, _form)`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `pnpm --filter web lint && pnpm typecheck && pnpm --filter web build`. Expected: PASS.
- [ ] **Step 3: Browser check:**
  1. As the owner, open Bookings for next Friday; the player's 8–9pm booking is shown with the player's name.
  2. Add a walk-in "Karim, 01712-345678" at 9–10pm; it shows as `+8801712345678`.
  3. Mark the 8pm booking **Attended**.
  4. Deleting the branch now shows `m.manage.branchInUse`.
  5. `?date=2026-02-30` renders today.
- [ ] **Step 4: Commit** `feat(web): staff bookings day view with walk-ins`.

### Task 11: B1 wrap-up

- [ ] **Step 1: Run** `pnpm typecheck && pnpm test && pnpm --filter web lint && pnpm --filter web build && pnpm db:test && pnpm db:lint && pnpm test:race && pnpm test:integration`, then `pnpm exec supabase db diff --local --schema public`. Expected: every command exits 0, and the diff says `No schema changes found`.
- [ ] **Step 2: Browser journey** (spec §1 Done-when, item 1, plus B1's notifications):
  1. Player A books Pitch 1 for Friday 8–9pm.
  2. Player B is refused the same slot ("just taken").
  3. Staff add a walk-in for 9–10pm.
  4. A gets the bell and a Mailpit email.
  5. A cancels before the cut-off; B can then book 8–9pm.
  6. Staff see B's booking and the walk-in.
- [ ] **Step 3: Docs.**
  - **`README.md`:**
    - `pnpm env:local` now also sets the job secret and Vault;
    - the tick runs every 10 s and needs the dev server on :3000;
    - Mailpit SMTP is on 54325;
    - the new test counts.
  - **`memory.md`:**
    - B1 decisions and rulings;
    - gotchas: `host.docker.internal` from the DB container (Docker Desktop; Linux needs `extra_hosts`), `[local_smtp] smtp_port`, and that email templates and SMTP changes need `db:stop`/`db:start`;
    - the change log.
- [ ] **Step 4: Commit** `docs: Stage B1 setup and notes`.
