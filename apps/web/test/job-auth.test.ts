import { describe, expect, it } from 'vitest';
import { authorizeJob } from '../lib/jobs/auth';

const secret = 'a'.repeat(64);

describe('authorizeJob (the cron → /api/jobs/tick bearer secret)', () => {
  it('accepts the right secret', () => {
    expect(authorizeJob(`Bearer ${secret}`, secret)).toBe(true);
  });

  it('refuses a wrong secret of the same length', () => {
    expect(authorizeJob(`Bearer ${'b'.repeat(64)}`, secret)).toBe(false);
  });

  it('refuses a secret of a different length', () => {
    expect(authorizeJob(`Bearer ${secret}x`, secret)).toBe(false);
    expect(authorizeJob('Bearer short', secret)).toBe(false);
  });

  it('refuses a missing header or another scheme', () => {
    expect(authorizeJob(null, secret)).toBe(false);
    expect(authorizeJob(secret, secret)).toBe(false);
  });

  it('refuses everything when the server has no secret configured', () => {
    expect(authorizeJob('Bearer ', '')).toBe(false);
    expect(authorizeJob('Bearer ', undefined)).toBe(false);
    expect(authorizeJob('Bearer undefined', undefined)).toBe(false);
  });
});
