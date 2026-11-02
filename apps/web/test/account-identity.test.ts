import { describe, expect, it } from 'vitest';
import { initials, signInMethods, userFromClaims } from '../lib/account/identity';

describe('initials', () => {
  it('takes the first and last words', () => {
    expect(initials('Miraz Ihsan')).toBe('MI');
    expect(initials('Ana Maria Lopez')).toBe('AL');
  });

  it('uses one letter for one word', () => {
    expect(initials('desk.person')).toBe('D');
  });

  it('shows a question mark for a blank name', () => {
    expect(initials('  ')).toBe('?');
  });
});

describe('signInMethods', () => {
  it('names Google, email links, or both', () => {
    expect(signInMethods(['google'])).toBe('Google');
    expect(signInMethods(['email'])).toBe('Email link');
    expect(signInMethods(['email', 'google'])).toBe('Google and email link');
  });

  it('treats an account with no providers listed as email-link only', () => {
    expect(signInMethods([])).toBe('Email link');
  });
});

describe('userFromClaims', () => {
  it("reads the person's Google name, photo and sign-in providers from the token", () => {
    expect(
      userFromClaims({
        sub: 'u1',
        email: 'miraz@example.test',
        user_metadata: { full_name: 'Miraz Ihsan', name: 'Miraz', avatar_url: 'https://lh3.example/a.jpg', picture: 'https://lh3.example/p.jpg' },
        app_metadata: { providers: ['email', 'google'] },
      }),
    ).toEqual({ id: 'u1', email: 'miraz@example.test', name: 'Miraz Ihsan', avatarUrl: 'https://lh3.example/a.jpg', providers: ['email', 'google'] });
  });

  it('falls back to name and picture', () => {
    const user = userFromClaims({ sub: 'u2', user_metadata: { name: 'Only Name', picture: 'https://lh3.example/p.jpg' } });
    expect(user).toMatchObject({ name: 'Only Name', avatarUrl: 'https://lh3.example/p.jpg', email: null, providers: [] });
  });

  it('gives nulls for an email-link account with no metadata, and ignores non-strings', () => {
    expect(userFromClaims({ sub: 'u3', email: 'a@b.test', user_metadata: { full_name: 42 }, app_metadata: { providers: 'email' } })).toEqual({
      id: 'u3',
      email: 'a@b.test',
      name: null,
      avatarUrl: null,
      providers: [],
    });
  });

  it('is null without a subject', () => {
    expect(userFromClaims({})).toBeNull();
    expect(userFromClaims(undefined)).toBeNull();
  });
});
