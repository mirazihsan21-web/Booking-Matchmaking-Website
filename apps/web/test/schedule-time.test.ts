import { describe, expect, it } from 'vitest';
import type { OpeningHours } from '../lib/opening-hours';
import { DEFAULT_OPENING_HOURS } from '../lib/opening-hours';
import { weeklyStarts, withinOpeningHours } from '../lib/schedule/time';

const DHAKA = 'Asia/Dhaka';
const at = (iso: string) => new Date(iso);
const everyDay = (open: string, close: string): OpeningHours =>
  Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, [open, close]])) as OpeningHours;

describe('weeklyStarts', () => {
  it('repeats the same local time each week', () => {
    expect(weeklyStarts({ date: '2026-10-23', time: '20:00' }, 3, DHAKA).map((d) => d.toISOString())).toEqual([
      '2026-10-23T14:00:00.000Z',
      '2026-10-30T14:00:00.000Z',
      '2026-11-06T14:00:00.000Z',
    ]);
  });

  it('allows 1 to 12 weeks', () => {
    expect(() => weeklyStarts({ date: '2026-10-23', time: '20:00' }, 0, DHAKA)).toThrow(RangeError);
    expect(() => weeklyStarts({ date: '2026-10-23', time: '20:00' }, 13, DHAKA)).toThrow(RangeError);
  });
});

describe('withinOpeningHours', () => {
  it('accepts a slot that ends exactly at closing', () => {
    expect(withinOpeningHours(DEFAULT_OPENING_HOURS, at('2026-10-23T16:00:00Z'), 60, DHAKA)).toBe(true); // 22:00–23:00
  });

  it('refuses a slot that runs past closing', () => {
    expect(withinOpeningHours(DEFAULT_OPENING_HOURS, at('2026-10-23T16:30:00Z'), 60, DHAKA)).toBe(false); // 22:30–23:30
  });

  it('refuses a closed day', () => {
    const hours = { ...DEFAULT_OPENING_HOURS, '5': null }; // Friday closed
    expect(withinOpeningHours(hours, at('2026-10-23T14:00:00Z'), 60, DHAKA)).toBe(false);
  });

  it('accepts the small hours of an overnight opening', () => {
    // Open 18:00–02:00; Saturday 01:00 local is still Friday night's window.
    expect(withinOpeningHours(everyDay('18:00', '02:00'), at('2026-10-23T19:00:00Z'), 60, DHAKA)).toBe(true);
  });

  it('accepts a late slot that crosses midnight inside an overnight opening', () => {
    expect(withinOpeningHours(everyDay('18:00', '02:00'), at('2026-10-23T17:30:00Z'), 90, DHAKA)).toBe(true); // 23:30–01:00
  });
});
