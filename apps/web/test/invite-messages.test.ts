import { describe, expect, it } from 'vitest';
import { m } from '../messages';

describe('m.manage.inviteSent', () => {
  const email = 'sam@example.com';

  it('a new address: the invite email went, or it did not', () => {
    expect(m.manage.inviteSent(email, { existingAccount: false, emailSent: true })).toBe("Invited sam@example.com. We've emailed them a link to join.");
    expect(m.manage.inviteSent(email, { existingAccount: false, emailSent: false })).toBe(
      "Invited sam@example.com, but the email didn't go out. They'll see the invite when they sign in with that address.",
    );
  });

  it('an existing account: emailed by us, and the invite waits on the site', () => {
    expect(m.manage.inviteSent(email, { existingAccount: true, emailSent: true })).toBe(
      "Invited sam@example.com. They already have an account, so we've emailed them, and they'll see the invite when they open the site.",
    );
    expect(m.manage.inviteSent(email, { existingAccount: true, emailSent: false })).toBe(
      "Invited sam@example.com. They already have an account. The email didn't go out, but they'll see the invite when they open the site.",
    );
  });
});
