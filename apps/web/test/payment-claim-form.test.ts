import { describe, expect, it } from 'vitest';
import { normaliseTrxId, parsePaymentClaimForm } from '../lib/forms/payment-claim';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const valid = { method: 'bkash', senderPhone: '01911111111', trxId: '9JK7ABC123' };

describe('normaliseTrxId', () => {
  it('drops spaces and upper-cases, the way the database stores it', () => {
    expect(normaliseTrxId(' 9jk7 abc123 ')).toBe('9JK7ABC123');
  });
});

describe('parsePaymentClaimForm', () => {
  it('reads a filled-in form, tidied', () => {
    expect(parsePaymentClaimForm(form({ method: 'nagad', senderPhone: '0191 111 1111', trxId: '9jk7 abc123' }))).toEqual({
      ok: true,
      value: { method: 'nagad', senderPhone: '01911111111', trxId: '9JK7ABC123' },
    });
  });

  it('asks for bKash or Nagad', () => {
    const result = parsePaymentClaimForm(form({ ...valid, method: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['method']);
  });

  it.each([
    ['ten digits', '0191111111'],
    ['not a mobile number', '02123456789'],
  ])('refuses a sender number that is %s', (_, senderPhone) => {
    const result = parsePaymentClaimForm(form({ ...valid, senderPhone }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['senderPhone']);
  });

  it.each([
    ['5 characters', 'AB123'],
    ['21 characters', 'A'.repeat(21)],
    ['a symbol', 'AB12-3456'],
  ])('refuses a transaction ID of %s', (_, trxId) => {
    const result = parsePaymentClaimForm(form({ ...valid, trxId }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['trxId']);
  });
});
