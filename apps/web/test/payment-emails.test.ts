import { describe, expect, it } from 'vitest';
import { paymentCheckEmail } from '../lib/email/payment-check-email';
import { paymentNumbersEmail } from '../lib/email/payment-numbers-email';

const check = {
  venueName: 'Chattoturf',
  primaryColour: '#43a66b',
  playerName: 'Sami',
  resourceName: 'Pitch 1',
  when: 'Fri 6 Nov, 8pm',
  amount: '৳2,500',
  method: 'bkash' as const,
  trxId: '9JK7ABC123',
  link: 'http://localhost:3000/manage/payments',
};

describe('paymentCheckEmail (to the team)', () => {
  it('says who paid what, by which service, with the transaction ID, in the subject', () => {
    expect(paymentCheckEmail(check).subject).toBe('Payment to check: Sami, Pitch 1, Fri 6 Nov, 8pm, ৳2,500 by bKash (TrxID 9JK7ABC123)');
    expect(paymentCheckEmail({ ...check, method: 'nagad' }).subject).toContain('by Nagad');
  });

  it('links to Payments to check', () => {
    const { html, text } = paymentCheckEmail(check);
    expect(html).toContain('href="http://localhost:3000/manage/payments"');
    expect(text).toContain('http://localhost:3000/manage/payments');
  });

  it('escapes what players typed in the HTML', () => {
    expect(paymentCheckEmail({ ...check, playerName: '<b>Sami</b>' }).html).toContain('&lt;b&gt;Sami&lt;/b&gt;');
  });
});

describe('paymentNumbersEmail (to every owner)', () => {
  const change = {
    venueName: 'Chattoturf',
    primaryColour: '#43a66b',
    changedBy: 'Rumi',
    before: { bkash: '01712345678', nagad: null },
    after: { bkash: '01799999999', nagad: '01812345678' },
    link: 'http://localhost:3000/manage/brand',
  };

  it('names what changed, from what to what, and who changed it', () => {
    const { subject, text } = paymentNumbersEmail(change);
    expect(subject).toBe('Chattoturf: the bKash/Nagad numbers for online bookings were changed');
    expect(text).toContain('bKash: 01712345678 → 01799999999');
    expect(text).toContain('Nagad: not set → 01812345678');
    expect(text).toContain('Changed by Rumi.');
  });

  it('leaves out a number that stayed the same', () => {
    expect(paymentNumbersEmail({ ...change, after: { bkash: '01712345678', nagad: '01812345678' } }).text).not.toContain('bKash:');
  });
});
