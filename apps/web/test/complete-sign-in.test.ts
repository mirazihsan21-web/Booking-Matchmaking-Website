import { describe, expect, it } from 'vitest';
import { isInviteLink } from '../lib/auth/complete-sign-in';

describe('isInviteLink', () => {
  it("is the staff invite email's link (a one-time token of type invite)", () => {
    expect(isInviteLink(new URLSearchParams('token_hash=abc&type=invite&next=/manage'))).toBe(true);
  });

  it('is not an ordinary sign-in: Google, an email sign-in link, or a type without a token', () => {
    expect(isInviteLink(new URLSearchParams('code=abc'))).toBe(false);
    expect(isInviteLink(new URLSearchParams('token_hash=abc&type=magiclink'))).toBe(false);
    expect(isInviteLink(new URLSearchParams('type=invite'))).toBe(false);
  });
});
