// What `pnpm env:vercel` puts into Vercel and the hosted Vault, as plain functions so it can be tested
// without either (spec docs/superpowers/specs/2026-10-29-vercel-launch-design.md §2 and §4).

/**
 * The Vercel production variables for the site at `host` (its *.vercel.app address). Secrets are marked
 * sensitive: Vercel then never shows them again.
 *
 * @param {{ supabaseUrl: string, publishableKey: string, secretKey: string, jobSecret: string, host: string,
 *   brandSlug: string, gmail: string, gmailAppPassword?: string }} input
 * @returns {Array<{ name: string, value: string, sensitive: boolean }>}
 */
export function vercelEnvironment(input) {
  const plain = (name, value) => ({ name, value, sensitive: false });
  const secret = (name, value) => ({ name, value, sensitive: true });
  return [
    plain('NEXT_PUBLIC_SUPABASE_URL', input.supabaseUrl),
    plain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', input.publishableKey),
    secret('SUPABASE_SECRET_KEY', input.secretKey),
    plain('NEXT_PUBLIC_ROOT_DOMAIN', input.host),
    plain('NEXT_PUBLIC_GOOGLE_AUTH_ENABLED', 'true'),
    plain('BRAND_SLUG', input.brandSlug),
    secret('JOB_SECRET', input.jobSecret),
    plain('EMAIL_TRANSPORT', 'smtp'),
    plain('SMTP_HOST', 'smtp.gmail.com'),
    plain('SMTP_PORT', '465'),
    plain('SMTP_USER', input.gmail),
    secret('SMTP_PASS', input.gmailAppPassword ?? ''),
    plain('EMAIL_FROM', `Chattoturf <${input.gmail}>`),
    // Vercel then builds with the repo's own pnpm (root package.json "packageManager").
    plain('ENABLE_EXPERIMENTAL_COREPACK', '1'),
  ];
}

/**
 * What was set, by name only — the one thing the script prints.
 *
 * @param {Array<{ name: string, sensitive: boolean }>} vars
 */
export function envSummary(vars) {
  return vars.map((v) => `  ${v.name}${v.sensitive ? ' (sensitive)' : ''}`).join('\n');
}

/**
 * SQL that points the hosted job tick at the site: replaces the Vault's `app_url` and `job_secret`.
 * Only an https address and a 64-character hex secret are accepted, so nothing can break out of the quotes.
 *
 * @param {{ appUrl: string, jobSecret: string }} input
 */
export function vaultSql({ appUrl, jobSecret }) {
  if (!/^https:\/\/[a-z0-9.-]+$/.test(appUrl)) throw new Error('appUrl must be https://<host>');
  if (!/^[0-9a-f]{64}$/.test(jobSecret)) throw new Error('jobSecret must be 64 hex characters');
  return [
    "delete from vault.secrets where name in ('app_url', 'job_secret');",
    `select vault.create_secret('${appUrl}', 'app_url');`,
    `select vault.create_secret('${jobSecret}', 'job_secret');`,
  ].join('\n');
}
