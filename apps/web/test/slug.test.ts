import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, normalizeSlug, validateSlug } from '../lib/tenancy/slug';

describe('normalizeSlug', () => {
  it('trims, lower-cases and hyphenates', () => {
    expect(normalizeSlug('  Dhanmondi Turf ')).toBe('dhanmondi-turf');
    expect(normalizeSlug('Gulshan_PC   Zone')).toBe('gulshan-pc-zone');
  });
});

describe('validateSlug (Review Focus 1)', () => {
  it.each(['-turf', 'turf-', 'ab', 'a'.repeat(33), 'ধানমন্ডি', 'turf!', 'two words', 'UPPER'])('%j is malformed', (slug) => {
    expect(validateSlug(slug)).toEqual({ ok: false, reason: 'format' });
  });

  it.each(['admin', 'www', 'api', 'manage', 't'.repeat(1)])('%j is reserved or malformed', (slug) => {
    expect(validateSlug(slug).ok).toBe(false);
  });

  it('reports reserved words as reserved', () => {
    expect(validateSlug('admin')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateSlug('www')).toEqual({ ok: false, reason: 'reserved' });
  });

  it.each(['gulshan-pc-zone', 'abc', 'turf-24', 'a'.repeat(32)])('%j is fine', (slug) => {
    expect(validateSlug(slug)).toEqual({ ok: true });
  });

  // Self-serve signup means anyone can claim <slug>.<platform domain>: keep phishing-prone names for us.
  it.each(['login', 'signin', 'signup', 'account', 'verify', 'secure', 'pay', 'payment', 'checkout', 'billing', 'wallet', 'bkash', 'nagad', 'dev', 'staging', 'cdn'])(
    '%j is reserved (phishing-prone on the platform domain)',
    (slug) => {
      expect(validateSlug(slug)).toEqual({ ok: false, reason: 'reserved' });
    },
  );

  // Browsers show xn-- (punycode) labels as Unicode, which allows look-alike venue addresses.
  it.each(['xn--dhanmondi', 'xn--80ak6aa92e'])('%j (punycode) is reserved', (slug) => {
    expect(validateSlug(slug)).toEqual({ ok: false, reason: 'reserved' });
  });

  it('matches the database reserved list', () => {
    expect([...RESERVED_SLUGS].sort()).toEqual(
      [
        'www', 'app', 'admin', 'api', 'manage', 'auth', 'static', 't', 'help', 'support', 'status', 'docs', 'blog', 'mail',
        'login', 'signin', 'signup', 'register', 'account', 'accounts', 'verify', 'secure', 'security',
        'pay', 'payment', 'payments', 'checkout', 'billing', 'wallet', 'bkash', 'nagad',
        'dev', 'staging', 'cdn', 'assets', 'media', 'onboarding',
      ].sort(),
    );
  });
});
