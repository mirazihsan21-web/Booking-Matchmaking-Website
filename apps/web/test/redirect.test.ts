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
    // URL parsers strip tab/CR/LF, so these would become //evil.example
    ['/\t/evil.example', '/'],
    ['/\n/evil.example', '/'],
    ['/\r/evil.example', '/'],
    ['/\u0000/evil.example', '/'],
  ])('%j → %j', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it('never resolves to another origin', () => {
    for (const ch of ['\t', '\n', '\r', '\u000b', '\u000c', ' ', '\u007f']) {
      const next = safeNext(`/${ch}/evil.example`);
      expect(new URL(next, 'http://localhost:3000').origin).toBe('http://localhost:3000');
    }
  });
});
