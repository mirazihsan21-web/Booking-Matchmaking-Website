import { describe, expect, it } from 'vitest';
import { safeNext } from '../lib/auth/redirect';

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
