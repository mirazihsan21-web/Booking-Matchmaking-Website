import { describe, expect, it } from 'vitest';
import { hostedEnvLines } from '../scripts/hosted-env-core.mjs';

// `pnpm env:hosted` points the dev server at the hosted database. Once the site is live, the hosted site runs
// the job tick; the local stack's tick must not drive hosted work too (final review of the Vercel launch,
// Important 3): it would take real players' pending emails into Mailpit, or send them with localhost links.
describe('hostedEnvLines', () => {
  const current = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    JOB_SECRET: 'the-local-vault-secret',
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '54325',
    EMAIL_FROM: 'Dev <dev@localhost>',
  };
  const lines = hostedEnvLines({
    ref: 'rhycdpswtiitjhzoczfq',
    publishable: 'sb_publishable_TESTONLY',
    secret: 'sb_secret_TESTONLY',
    googleEnabled: 'true',
    brandSlug: 'chattoturf',
    current,
    jobSecret: 'b'.repeat(64),
  });

  it('gives the dev server a new job secret, so the local tick is turned away', () => {
    expect(lines).toContain(`JOB_SECRET=${'b'.repeat(64)}`);
    expect(lines.join('\n')).not.toContain('the-local-vault-secret');
  });

  it('points at the hosted project and keeps the local mail settings', () => {
    expect(lines).toContain('NEXT_PUBLIC_SUPABASE_URL=https://rhycdpswtiitjhzoczfq.supabase.co');
    expect(lines).toContain('NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000');
    expect(lines).toContain('SMTP_PORT=54325');
    expect(lines).toContain('EMAIL_FROM=Dev <dev@localhost>');
  });
});
