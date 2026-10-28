# Launch on Vercel — Design

**Date:** 2026-10-29 · **Builds on:** R1–R3 (merged to `main`, pushed, rolled out to the hosted project `rhycdpswtiitjhzoczfq`)
**Status:** approved in conversation (sections 1–4); this document is for review.

## 1. Goal and decisions

The site runs only on the developer's machine. This puts it online as a **working product** — the real
Chattoturf brand with its real data — that also serves as the developer's portfolio piece.

| Decision | Choice |
|---|---|
| What "online" means | A real public launch: visitors find it, sign in and book. |
| Data | The real hosted brand (`chattoturf`) as it is. No demo data, no demo logins. |
| Host | **Vercel Hobby** (free; allowed for personal/portfolio use; runs Next.js 16 with no code changes). Cloudflare Workers was set aside: OpenNext doesn't run Next 16's Node-runtime `proxy.ts`, vinext lacks Cache Components and partial prerendering, and the free plan allows 10 ms of CPU per request. |
| Address | `https://chattoturf.vercel.app` (Vercel adds a suffix if the name is taken; a custom domain can be added later without rebuilding). |
| Player sign-in | Google (the Google app published) **and** email links. |
| Email | One new brand Gmail account with an App Password sends everything: Supabase's sign-in and invite emails, and the site's booking and seat-offer emails. |

**Done when:** a visitor on a phone opens `https://chattoturf.vercel.app`, browses the sections, signs in with
Google or an email link, and books; the owner signs in and works from `/manage`; booking emails arrive from
the brand Gmail; the job timer runs every minute against the live site.

## 2. Hosting and builds

- A Vercel project **`chattoturf`** on the developer's Hobby account, connected to the GitHub repo
  `mirazihsan21-web/Booking-Matchmaking-Website` (owned by a user, which Hobby allows). Root directory
  `apps/web`; the pnpm workspace is installed from the repo root. Node 24.
- **Only `main` deploys** (`vercel.json`: Git deployments enabled for `main` only). There are no preview
  sites: a preview would run against the same live database.
- **Functions run in `icn1` (Seoul)**, next to the database (`ap-northeast-2`).
- **Production environment variables** (names from `apps/web/.env.example`):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
  `NEXT_PUBLIC_ROOT_DOMAIN` (`chattoturf.vercel.app`), `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` (`true`),
  `BRAND_SLUG` (`chattoturf`), `JOB_SECRET`, `EMAIL_TRANSPORT` (`smtp`), `SMTP_HOST` (`smtp.gmail.com`),
  `SMTP_PORT` (`465`), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (`Chattoturf <the brand Gmail>`).
- **Secrets are never printed, logged or committed.** A script, `pnpm env:vercel`
  (`apps/web/scripts/write-env-vercel.mjs`), writes the variables with the Vercel CLI from their sources:
  the Supabase keys from the Supabase CLI (as `pnpm env:hosted` does), a newly generated `JOB_SECRET`, and
  `SMTP_PASS` typed by the developer at a hidden prompt. Re-running it replaces the values.
- `next.config.ts` needs no change: images come from the Supabase origin's public `org-assets` path, and the
  local-IP allowance is off because the hosted Supabase host isn't local.

## 3. Sign-in and email

- **Supabase Auth URLs** (dashboard): Site URL `https://chattoturf.vercel.app`; redirect URLs
  `https://chattoturf.vercel.app/**` and `http://localhost:3000/**` (local development keeps working).
- **Supabase Auth custom SMTP** (dashboard): `smtp.gmail.com`, port 465, the brand Gmail and its App
  Password, sender name "Chattoturf". The Auth email rate limit is raised from Supabase's low default
  to 100 an hour.
- **Invite template:** the hosted project gets `supabase/templates/invite.html` and its subject ("You've been
  invited to a venue's team"); the sign-in email keeps Supabase's default.
- **The site's own emails** (outbox delivery on the job tick) use the same Gmail through the existing SMTP
  sender (`lib/email/sender.ts`, port 465 = TLS).
- **Google:** the OAuth app is switched from Testing to **Published** (basic scopes need no review). The
  redirect URI (the Supabase callback) is unchanged.
- Gmail sends about 500 emails a day — enough for one venue. No sign-in code changes.

## 4. The job timer

- **One migration** reschedules the tick from every 10 seconds to **every minute** (`* * * * *`),
  everywhere, so local and hosted never drift. The pgTAP check that pins the schedule (`10_jobs`) changes
  with it. Matching at the cut-off, offer expiry, closing at the start and email delivery happen within a
  minute. About 43,000 calls a month, well inside Hobby's 1,000,000 invocations. CPU is shared with page renders
  (every open page refreshes every 30 s), so a usage check follows the launch (§6). The tick's request waits up to
  30 s for the site (pg_net's default is a few seconds; a cold start plus email sending takes longer).
- **The same migration quietly closes past games:** any open-play session whose start has passed but is still
  `open` or `matched` becomes `closed`, with no "no seat" notifications. On hosted this is expected to be a
  no-op (no sessions as of the R1 rollout); it guarantees the first live tick sends nothing weeks late.
- **Pre-launch check:** the hosted outbox is checked for undelivered old emails; any found are reported to the
  developer before the timer starts (not deleted silently).
- **Pointing it at the site:** the hosted Vault gets `app_url = https://chattoturf.vercel.app` and
  `job_secret` = the Vercel `JOB_SECRET`, written by `pnpm env:vercel` through the Supabase CLI (if Claude
  Code's permission check blocks a live-database write, the developer runs that step with `!`).
- **Emergency stop:** remove `app_url` from the Vault; the site keeps working.

## 5. Launch order

1. (developer) Create the brand Gmail, turn on 2-Step Verification, create an App Password.
2. (developer) `vercel login`; Claude creates and links the `chattoturf` project.
3. `pnpm env:vercel` — Vercel production variables and the hosted Vault (the developer types the Gmail App Password).
4. (developer, via `!`) `pnpm exec supabase db push --yes` — the timer migration.
5. (developer) Supabase dashboard: URL configuration, custom SMTP, invite template.
6. (developer) Google Cloud: publish the OAuth app.
7. First production deploy (from `main`).
8. Checks (§6). Only then is the address shared.

## 6. Checks

- **Automated, read-only:** the smoke script signed out against the live address — home, each section, a
  game page, `/signin` — and the hosted `net._http_response` rows show the tick answered 200 each minute (no
  timeouts or errors).
- **After 3–7 days:** Vercel → Usage, against Hobby's 4 CPU-hours a month.
- **By hand (the developer, on a phone):** sign in with Google; sign in by email link (the email arrives from
  the brand Gmail); the owner account opens `/manage`; a booking made by a test player sends its confirmation
  email. Nothing writes real data automatically; the e2e and integration tests stay on the local stack (they
  create and delete users).
- **Rollback:** Vercel's "promote previous deployment"; stop the timer as in §4; database changes are new
  migrations, as always.

## 7. Docs

README gains **Deploying (Vercel)**: the launch order, the variable list (names only), how to redeploy, roll
back and stop the timer. `memory.md` records the decisions, the Hobby limits that shaped them, and the launch.

## 8. Out of scope

A custom domain and Resend (later, when a domain is bought); preview deployments; database backups beyond
Supabase Free (a nightly backup job is a follow-up); bKash payments (Stage C); the R3 deferred minors.
