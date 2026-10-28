# Launch on Vercel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Chattoturf site online on Vercel's free plan as a working product, with player sign-in and email, and the job timer running against the live site.

**Architecture:** No app code changes. A migration moves the job tick to every minute and quietly closes past games; `apps/web/vercel.json` pins the region and limits deploys to `main`; a script fills Vercel's production variables and the hosted Vault without printing secrets; docs carry the launch runbook; the last task is the launch itself, with steps the developer does in their own accounts.

**Tech Stack:** Vercel (Hobby, CLI `pnpm dlx vercel@65.4.0`), Supabase CLI (`db push`, `db query --linked`), Postgres/pg_cron, pgTAP, Vitest, Node 24 scripts (`.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-29-vercel-launch-design.md`

## Global Constraints

- Address: `chattoturf.vercel.app`, or the production domain Vercel actually assigns if that name is taken — the same host everywhere (Vercel variables, Vault `app_url`, Supabase Auth URLs).
- Brand `chattoturf`; hosted project `rhycdpswtiitjhzoczfq` (`ap-northeast-2`); Vercel functions region `icn1`.
- Only `main` deploys: `"git": { "deploymentEnabled": { "**": false, "main": true } }` (`*` does not match branch names with `/`).
- Tick schedule `* * * * *` everywhere.
- Vercel builds with the repo's pnpm (`packageManager: pnpm@12.14.0`) through `ENABLE_EXPERIMENTAL_COREPACK=1` — a 14th, non-secret variable beside the spec's 13 — and Node 24 from `apps/web/package.json` `"engines": { "node": "24.x" }`.
- Email: `EMAIL_TRANSPORT=smtp`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `EMAIL_FROM=Chattoturf <brand gmail>`; `RESEND_API_KEY` unset.
- Secrets (`SUPABASE_SECRET_KEY`, `JOB_SECRET`, `SMTP_PASS`) are never printed, logged, committed or put on a command line; scripts print variable names only.
- Writes to the live database may be blocked by Claude Code's permission check — the developer then runs the exact command with `!`.
- E2E and integration tests stay on the local stack; nothing writes real data automatically.

## Review Focus

1. **Vercel assigns a different address** (name taken) — every setting must use the assigned host. Pinned in Task 2 (`vercelEnvironment` and `vaultSql` take the host; tests use a non-default host) and Task 4 (the host is read from Vercel before the script runs).
2. **A secret shows up in the terminal** — the script prints only `envSummary` (names). Pinned in Task 2 (`envSummary` contains no value).
3. **A branch like `feat/x` deploys a preview against the live database** — pinned in Task 2 (test reads `vercel.json`: `**` false, `main` true).
4. **Old emails or "no seat" notices go out on the first live tick** — pinned in Task 1 (quiet close inserts no notifications) and Task 4 (outbox counted before the Vault is set).
5. **An email sign-in link returns to `localhost`** — checked by hand in Task 4 after the Supabase URL settings.

---

### Task 1: Timer every minute, past games closed quietly

**Files:**
- Create: `supabase/migrations/20261029010000_launch_timer.sql`, `supabase/tests/database/21_launch.test.sql`
- Modify: `supabase/tests/database/10_jobs.test.sql:7` (and its description text)

**Interfaces:**
- Produces: `private.close_past_sessions_quietly() returns integer` (number closed); execute revoked from `public, anon, authenticated`. The migration calls it once.

- [ ] **Step 1: Write the failing tests.** In `10_jobs`, the schedule check becomes `select is((select schedule from cron.job where jobname = 'tick'), '* * * * *', 'the tick runs every minute');` (and its comment says "every minute"). New `21_launch.test.sql` (plan 5), fixture: an org + `add_section` turf + a resource + a player profile; session A `open` starting 1 day ago with a `seat_requests` row and a `waitlist_entries` row (`waiting`); session B `open` starting in 2 days. Then `select private.close_past_sessions_quietly()`:
  - `is(<returned count>, 1, 'one past game closed')`
  - `is(status of A, 'closed', 'the past game is closed')`
  - `is(status of B, 'open', 'a future game is untouched')`
  - `is(waitlist entry status, 'expired', 'its waitlist place has expired')`
  - `is((select count(*) from public.notifications where organization_id = <org>), 0::bigint, 'and nobody is told')`
- [ ] **Step 2: Run** `pnpm db:test` — Expected: FAIL (`10_jobs` have '10 seconds'; `21_launch` function does not exist).
- [ ] **Step 3: Implement the migration:** `select cron.schedule('tick', '* * * * *', 'select private.trigger_tick()');` (same name replaces the job); `private.close_past_sessions_quietly()` does what `public.close_started_sessions()` (`20261021020100_open_play_offers.sql:296`) does — `closed`, pending `seat_offers` → `expired`, `waiting`/`offered` waitlist entries → `expired` — for sessions `in ('open','matched') and starts_at <= now()`, **without any `notifications` insert**; `security invoker`, `set search_path = ''`; revoke execute; then `select private.close_past_sessions_quietly();`. Header comment says why (the first live tick must not send weeks-late "no seat" emails).
- [ ] **Step 4: Run** `pnpm exec supabase migration up --local`, then `pnpm db:test` and `pnpm db:lint` — Expected: PASS, advisors clean.
- [ ] **Step 5: Commit** `feat(db): tick every minute; close past games quietly before launch`

### Task 2: Vercel config and the `env:vercel` script

**Files:**
- Create: `apps/web/vercel.json`, `apps/web/scripts/vercel-env-core.mjs`, `apps/web/scripts/write-env-vercel.mjs`, `apps/web/scripts/hosted-keys.mjs`, `apps/web/test/vercel-env.test.ts`
- Modify: `apps/web/scripts/write-env-hosted.mjs` (use `hosted-keys.mjs`), `apps/web/package.json` (`"env:vercel": "node scripts/write-env-vercel.mjs"`; `"engines": { "node": "24.x" }`), root `package.json` (`"env:vercel": "pnpm --filter web env:vercel"`)

**Interfaces:**
- Produces (in `vercel-env-core.mjs`):
  - `vercelEnvironment({ supabaseUrl, publishableKey, secretKey, jobSecret, host, brandSlug, gmail, gmailAppPassword }): Array<{ name: string; value: string; sensitive: boolean }>` — the 13 variables of spec §2 plus `ENABLE_EXPERIMENTAL_COREPACK` (`'1'`).
  - `envSummary(vars): string` — one line per variable: name and `(sensitive)` when so; never a value.
  - `vaultSql({ appUrl, jobSecret }): string` — deletes the `app_url`/`job_secret` Vault secrets and creates both; throws unless `appUrl` is `https://` + a host and `jobSecret` is 64 hex characters.
- Produces (in `hosted-keys.mjs`): `hostedProject(): Promise<{ ref: string; url: string; publishable: string; secret: string }>` — the ref check and `supabase projects api-keys --reveal` logic moved out of `write-env-hosted.mjs` unchanged.

- [ ] **Step 1: Write the failing tests** (`test/vercel-env.test.ts`), with `host: 'chattoturf-x1.vercel.app'` (not the default — Review Focus 1):
  - the names are exactly `NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, NEXT_PUBLIC_ROOT_DOMAIN, NEXT_PUBLIC_GOOGLE_AUTH_ENABLED, BRAND_SLUG, JOB_SECRET, EMAIL_TRANSPORT, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, ENABLE_EXPERIMENTAL_COREPACK`;
  - values: `NEXT_PUBLIC_ROOT_DOMAIN` = the host, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` = `'true'`, `EMAIL_TRANSPORT` = `'smtp'`, `SMTP_HOST` = `'smtp.gmail.com'`, `SMTP_PORT` = `'465'`, `SMTP_USER` = the gmail, `EMAIL_FROM` = `'Chattoturf <chattoturf.bd@gmail.com>'`;
  - `sensitive` is true exactly for `SUPABASE_SECRET_KEY`, `JOB_SECRET`, `SMTP_PASS`;
  - `envSummary` contains every name and none of the secret, job secret or app password strings (Review Focus 2);
  - `vaultSql` contains `'https://chattoturf-x1.vercel.app'` and both `vault.create_secret` calls; throws for `appUrl: 'http://x'`, for a job secret `"abc'; drop table x; --"`;
  - `vercel.json` (read with `fs`): `regions` equals `['icn1']`; `git.deploymentEnabled` equals `{ '**': false, main: true }` (Review Focus 3); `apps/web/package.json` `engines.node` equals `'24.x'`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/vercel-env.test.ts` — Expected: FAIL (module and file missing).
- [ ] **Step 3: Implement** `vercel.json` (with `"$schema": "https://openapi.vercel.sh/vercel.json"`), `vercel-env-core.mjs`, `hosted-keys.mjs` (move, don't change behaviour), and `write-env-vercel.mjs`: flags `--host <host>` (required) and `--gmail <address>` (required); reads the keys via `hostedProject()`; asks for the Gmail App Password at a hidden prompt; generates `JOB_SECRET` with `randomBytes(32).toString('hex')`; for each variable runs `pnpm dlx vercel@65.4.0 env rm <NAME> production --yes` (ignore "not found") then `env add <NAME> production` with the value on **stdin** (`--sensitive` for sensitive ones); writes `vaultSql` to a temp file (mode 0600) in `os.tmpdir()`, runs `pnpm exec supabase db query --linked -f <file>`, and deletes the file in `finally`; prints `envSummary` and "Vault: app_url, job_secret set" only. Header comment states the runbook position (spec §5 step 3).
- [ ] **Step 4: Run** the test file, then `pnpm typecheck`, `pnpm --filter web lint`, `pnpm --filter web test`; and `pnpm env:hosted` + `pnpm env:local` once each to prove the moved key logic still works (each writes `.env.local`; end on `env:local`) — Expected: PASS, both env commands succeed.
- [ ] **Step 5: Commit** `feat: Vercel config and the env:vercel script`

### Task 3: Docs — the runbook

**Files:**
- Modify: `README.md` (new "### Deploying (Vercel)" after "Rolling R3 out…"; every "10-second" tick mention → "every minute"; Commands gains `pnpm env:vercel`), `memory.md` (§5 rulings: Vercel Hobby and why not Cloudflare; Hobby limits behind the 1-minute tick; Gmail for all email; `**` branch glob)

- [ ] **Step 1: Write** the README section: the launch order of spec §5 (who does each step), the variable list (names only), `pnpm env:vercel --host <host> --gmail <address>`, the Supabase dashboard values (Site URL, redirect URLs, SMTP fields, invite template + subject), "publish the Google app", how to redeploy (push `main`), roll back (promote the previous deployment), and stop the timer (`delete from vault.secrets where name = 'app_url'`).
- [ ] **Step 2: Check** `grep -nE "10-second|10 seconds" README.md` — Expected: no matches outside history notes.
- [ ] **Step 3: Commit** `docs: deploying on Vercel`

### Task 4: Launch

Runs **after** the whole-branch review of Tasks 1–3, its fix pass, and the merge to `main` (finishing-a-development-branch) — the launch deploys `main`. No code. Steps marked (dev) are done by the developer in their own accounts; Claude gives exact values and verifies.

- [ ] **Step 1: (dev)** Brand Gmail with 2-Step Verification and an App Password.
- [ ] **Step 2: (dev)** `! pnpm dlx vercel@65.4.0 login`. Then Claude: create/link the project from `apps/web` (`vercel link`, project name `chattoturf`, root directory `apps/web`, connect the GitHub repo), and read the assigned production domain — Expected: a `*.vercel.app` host; it is THE host from here on.
- [ ] **Step 3:** `pnpm env:vercel --host <host> --gmail <address>` (dev types the App Password) — Expected: the 13 names listed; "Vault: app_url, job_secret set" (if the Vault write is blocked, dev runs the printed command with `!`). **Before it,** count the hosted outbox: `pnpm exec supabase db query --linked "select email_status, count(*) from public.notifications group by 1"` — Expected: no `pending`/`sending` rows; any found are reported to the developer and the launch waits for their call.
- [ ] **Step 4: (dev)** `! pnpm exec supabase db push --yes` — Expected: `20261029010000_launch_timer.sql` applied.
- [ ] **Step 5: (dev)** Supabase dashboard (Auth → URL Configuration; Auth → SMTP Settings; Auth → Email Templates → Invite user; Auth → Rate Limits → emails 100/h) and Google Cloud (Audience → Publish app), with the README values.
- [ ] **Step 6:** Push `main` (merged already; the developer approves the push) — Vercel builds production. Expected: deployment "Ready"; `curl -sI https://<host>/` → 200.
- [ ] **Step 7: Checks.** `SITE_URL=https://<host> node apps/web/scripts/smoke-site.mjs "/|Coming up" "/turf|Turf" "/signin|Email me a sign-in link"` — Expected: ok. Tick: `pnpm exec supabase db query --linked "select status_code, timed_out, error_msg, count(*) from net._http_response where created > now() - interval '5 minutes' group by 1, 2, 3"` — Expected: only 200s, no timeouts or errors, about 5. (dev, on a phone) Google sign-in; email-link sign-in arrives from the brand Gmail and returns to `https://<host>` (Review Focus 5); the owner opens `/manage`; a test booking's confirmation email arrives within a minute.
- [ ] **Step 8:** After 3–7 days, Vercel → Usage: Active CPU on course to stay under 4 hours for the month.
- [ ] **Step 9:** Record the launch in `memory.md` §8 (host, date, checks) and the auto-memory; commit `docs: launched on Vercel`.
