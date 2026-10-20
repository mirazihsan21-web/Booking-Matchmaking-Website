import { describe, expect, it } from 'vitest';
import { bdtToPoisha, formatBdt } from '../lib/money';

describe('bdtToPoisha', () => {
  it.each([
    ['2500', 250000],
    ['2,500', 250000],
    ['2500.50', 250050],
    ['৳2,500', 250000],
    [' 600 ', 60000],
    ['0', 0],
  ])('reads %j as %d poisha', (input, poisha) => {
    expect(bdtToPoisha(input)).toBe(poisha);
  });

  it.each(['-5', '1.234', 'abc', '', '2,50,0x'])('rejects %j', (input) => {
    expect(bdtToPoisha(input)).toBeNull();
  });
});

describe('formatBdt', () => {
  it('formats whole taka', () => expect(formatBdt(250000)).toBe('৳2,500'));
  it('shows poisha when present', () => expect(formatBdt(250050)).toBe('৳2,500.50'));
  it('formats zero', () => expect(formatBdt(0)).toBe('৳0'));
  it('round-trips', () => expect(bdtToPoisha(formatBdt(123456))).toBe(123456));
});
