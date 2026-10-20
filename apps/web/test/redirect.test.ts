import { describe, expect, it } from 'vitest';
import { requestOrigin, safeNext } from '../lib/auth/redirect';

describe('requestOrigin (Next reports its own hostname in request.url, not the Host header)', () => {
  const root = 'localhost:3000';
  const url = 'http://localhost:3000/auth/callback?code=x';

  it('keeps a venue subdomain', () => {
    expect(requestOrigin('dhanmondi-turf.localhost:3000', url, root)).toBe('http://dhanmondi-turf.localhost:3000');
  });

  it('keeps the root host', () => {
    expect(requestOrigin('localhost:3000', url, root)).toBe('http://localhost:3000');
  });

  it('ignores hosts outside the platform (no open redirect via Host)', () => {
    expect(requestOrigin('evil.example', url, root)).toBe('http://localhost:3000');
  });

  it('ignores invalid venue hosts', () => {
    expect(requestOrigin('a.b.localhost:3000', url, root)).toBe('http://localhost:3000');
    expect(requestOrigin(null, url, root)).toBe('http://localhost:3000');
  });
});

describe('safeNext (no open redirects after sign-in)', () => {
  it.each([
    ['/manage', '/manage'],
    ['/me?tab=profile', '/me?tab=profile'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['manage', '/'],
  ])('%j → %j', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
