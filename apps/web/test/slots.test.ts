import { describe, expect, it } from 'vitest';
import { addDays, businessDaySlots, businessDayWindow, checkBookingStart, currentBusinessDate, localDate, parseDateParam, slotStates } from '../lib/bookings/slots';
import type { OpeningHours } from '../lib/opening-hours';

const zone = 'Asia/Dhaka'; // UTC+6, no daylight saving; 2026-10-23 is a Friday
const daily = (open: string, close: string): OpeningHours =>
  Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, [open, close]])) as OpeningHours;
const tenToEleven = daily('10:00', '23:00');
const lateNights = daily('14:00', '02:00');
const iso = (d: Date) => d.toISOString();
const now = new Date('2026-10-20T06:00:00Z'); // Tue 20 Oct, 12:00 in Dhaka

describe('businessDaySlots', () => {
  it('steps through the day from opening time to closing time', () => {
    const slots = businessDaySlots(tenToEleven, '2026-10-23', 60, zone);
    expect(slots).toHaveLength(13);
    expect(iso(slots[0]!.start)).toBe('2026-10-23T04:00:00.000Z'); // 10:00
    expect(iso(slots.at(-1)!.start)).toBe('2026-10-23T16:00:00.000Z'); // 22:00
    expect(iso(slots.at(-1)!.end)).toBe('2026-10-23T17:00:00.000Z'); // 23:00 — the last slot ends exactly at closing
  });

  it('never runs a slot past closing time', () => {
    const slots = businessDaySlots(tenToEleven, '2026-10-23', 90, zone);
    expect(iso(slots.at(-1)!.start)).toBe('2026-10-23T14:30:00.000Z'); // 20:30–22:00; the next (22:00–23:30) would end after 23:00
    expect(iso(slots.at(-1)!.end)).toBe('2026-10-23T16:00:00.000Z');
  });

  it('continues past midnight on an overnight day', () => {
    const slots = businessDaySlots(lateNights, '2026-10-23', 60, zone);
    expect(slots).toHaveLength(12);
    expect(iso(slots.at(-1)!.start)).toBe('2026-10-23T19:00:00.000Z'); // 01:00 on the 24th
    expect(iso(slots.at(-1)!.end)).toBe('2026-10-23T20:00:00.000Z'); // 02:00 on the 24th
  });

  it('has no slots on a closed day', () => {
    expect(businessDaySlots({ ...tenToEleven, '5': null }, '2026-10-23', 60, zone)).toEqual([]);
  });
});

describe('checkBookingStart', () => {
  const at = (when: string, slots = 1, extra: Partial<Parameters<typeof checkBookingStart>[0]> = {}) =>
    checkBookingStart({ hours: tenToEleven, slotMinutes: 60, timeZone: zone, startsAt: new Date(when), slots, now, horizonDays: 14, ...extra });

  it('accepts a slot on the grid and says which business day it is on', () => {
    expect(at('2026-10-23T14:00:00Z')).toEqual({ ok: true, endsAt: new Date('2026-10-23T15:00:00Z'), businessDate: '2026-10-23' });
  });

  it('refuses a start between grid lines', () => {
    expect(at('2026-10-23T14:30:00Z')).toEqual({ ok: false, reason: 'off_grid' });
  });

  it('refuses a booking that would run past closing', () => {
    expect(at('2026-10-23T16:00:00Z', 2)).toEqual({ ok: false, reason: 'outside_hours' }); // 22:00 × 2
  });

  it('takes 1 to 4 slots', () => {
    expect(at('2026-10-23T14:00:00Z', 0)).toEqual({ ok: false, reason: 'bad_count' });
    expect(at('2026-10-23T14:00:00Z', 5)).toEqual({ ok: false, reason: 'bad_count' });
  });

  it('refuses a slot that has already started', () => {
    expect(at('2026-10-20T04:00:00Z')).toEqual({ ok: false, reason: 'past' }); // 10:00 today; it is 12:00
  });

  it('lets staff book the slot in progress (a walk-in at 12:10), but not one that has ended', () => {
    const tenPast = new Date('2026-10-20T06:10:00Z'); // 12:10 in Dhaka
    expect(at('2026-10-20T06:00:00Z', 1, { now: tenPast, horizonDays: null, allowInProgress: true })).toEqual({
      ok: true,
      endsAt: new Date('2026-10-20T07:00:00Z'),
      businessDate: '2026-10-20',
    });
    expect(at('2026-10-20T05:00:00Z', 1, { now: tenPast, horizonDays: null, allowInProgress: true })).toEqual({ ok: false, reason: 'past' });
    expect(at('2026-10-20T06:00:00Z', 1, { now: tenPast })).toEqual({ ok: false, reason: 'past' }); // players: no
  });

  it('keeps players inside the booking window, but not staff', () => {
    expect(at('2026-11-04T14:00:00Z')).toEqual({ ok: false, reason: 'beyond_horizon' }); // 15 days ahead
    expect(at('2026-11-04T14:00:00Z', 1, { horizonDays: null }).ok).toBe(true);
  });

  it('puts a 01:00 slot on the previous business day when the venue is open overnight', () => {
    expect(at('2026-10-23T19:00:00Z', 1, { hours: lateNights })).toEqual({
      ok: true,
      endsAt: new Date('2026-10-23T20:00:00Z'),
      businessDate: '2026-10-23',
    });
  });
});

describe('slotStates', () => {
  const slots = businessDaySlots(tenToEleven, '2026-10-23', 60, zone);
  const state = (start: string, list: ReturnType<typeof slotStates>) => list.find((s) => iso(s.start) === start)?.state;

  it('marks every slot a booking overlaps as taken, even off the grid', () => {
    const states = slotStates(slots, [{ start: new Date('2026-10-23T14:30:00Z'), end: new Date('2026-10-23T15:30:00Z'), source: 'booking' }], now);
    expect(state('2026-10-23T14:00:00.000Z', states)).toBe('taken'); // 20:00
    expect(state('2026-10-23T15:00:00.000Z', states)).toBe('taken'); // 21:00
    expect(state('2026-10-23T16:00:00.000Z', states)).toBe('free'); // 22:00
  });

  it('shows open-play time separately', () => {
    const states = slotStates(slots, [{ start: new Date('2026-10-23T13:00:00Z'), end: new Date('2026-10-23T14:00:00Z'), source: 'session' }], now);
    expect(state('2026-10-23T13:00:00.000Z', states)).toBe('open_play'); // 19:00
    expect(state('2026-10-23T14:00:00.000Z', states)).toBe('free'); // back-to-back is free
  });

  it('marks a slot that has started as past', () => {
    expect(slotStates(slots, [], new Date('2026-10-23T04:00:00Z'))[0]!.state).toBe('past');
  });
});

describe('businessDayWindow (every booking belongs to exactly one business day)', () => {
  const win = (hours: OpeningHours) => {
    const w = businessDayWindow(hours, '2026-10-23', zone);
    return [iso(w.start), iso(w.end)];
  };

  it('is the calendar day for a venue that closes before midnight', () => {
    expect(win(tenToEleven)).toEqual(['2026-10-22T18:00:00.000Z', '2026-10-23T18:00:00.000Z']); // Fri 00:00 → Sat 00:00
  });

  it("runs from the end of last night's hours to the end of tonight's for an overnight venue", () => {
    expect(win(lateNights)).toEqual(['2026-10-22T20:00:00.000Z', '2026-10-23T20:00:00.000Z']); // Fri 02:00 → Sat 02:00
  });

  it('still covers a closed day, so bookings on it are not lost', () => {
    expect(win({ ...lateNights, '5': null })).toEqual(['2026-10-22T20:00:00.000Z', '2026-10-23T18:00:00.000Z']); // Fri 02:00 → Sat 00:00
  });
});

describe('currentBusinessDate (Review Focus 2)', () => {
  it('stays on Friday at 00:30 Saturday while an overnight venue is still open', () => {
    expect(currentBusinessDate(lateNights, new Date('2026-10-23T18:30:00Z'), zone)).toBe('2026-10-23');
  });

  it('moves to Saturday once the overnight hours have ended', () => {
    expect(currentBusinessDate(lateNights, new Date('2026-10-23T20:30:00Z'), zone)).toBe('2026-10-24'); // 02:30
  });

  it('is just the calendar date for a venue that closes before midnight', () => {
    expect(currentBusinessDate(tenToEleven, new Date('2026-10-23T18:30:00Z'), zone)).toBe('2026-10-24');
  });
});

describe('dates', () => {
  it('reads the local date and adds days across months', () => {
    expect(localDate(new Date('2026-10-23T19:00:00Z'), zone)).toBe('2026-10-24');
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });

  it.each([['2026-02-30'], ['abc'], [undefined], ['2026-1-5']])('falls back to today for %j', (value) => {
    expect(parseDateParam(value, '2026-10-20')).toBe('2026-10-20');
  });

  it('keeps a real date', () => {
    expect(parseDateParam('2026-10-23', '2026-10-20')).toBe('2026-10-23');
  });
});
