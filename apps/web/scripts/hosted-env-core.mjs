// The lines `pnpm env:hosted` writes to apps/web/.env.local, as a plain function so it can be tested.

/**
 * `.env.local` for a dev server on the hosted database. The job secret is always new (`jobSecret`): the local
 * stack's Vault keeps its own, so its every-minute tick is turned away (401) and can't take the live site's
 * work — real players' pending emails stay with the deployed site. Mail settings are kept from `current`.
 *
 * @param {{ ref: string, publishable: string, secret: string, googleEnabled: string, brandSlug: string,
 *   current: Record<string, string>, jobSecret: string }} input
 * @returns {string[]}
 */
export function hostedEnvLines({ ref, publishable, secret, googleEnabled, brandSlug, current, jobSecret }) {
  const keep = (name, fallback) => `${name}=${current[name] ?? fallback}`;
  return [
    `NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable}`,
    `SUPABASE_SECRET_KEY=${secret}`,
    'NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000',
    `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=${googleEnabled}`,
    `BRAND_SLUG=${brandSlug}`,
    `JOB_SECRET=${jobSecret}`,
    keep('EMAIL_TRANSPORT', 'smtp'),
    keep('SMTP_HOST', '127.0.0.1'),
    keep('SMTP_PORT', '54325'),
    keep('EMAIL_FROM', 'Booking & Matchmaking <bookings@localhost>'),
    // Optional: a mail-server login (Gmail) and a Resend key, kept only when already set.
    ...['SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY'].filter((name) => current[name]).map((name) => `${name}=${current[name]}`),
  ];
}
