import { describe, expect, it } from 'vitest';
import { accentReadability } from '../lib/manage/colour';
import { oldManagePath } from '../lib/manage/paths';
import { brandBusinessDate, deskWindow, freeGaps, placeOnTimeline } from '../lib/manage/today';
import type { OpeningHours } from '../lib/opening-hours';

const TZ = 'Asia/Dhaka';
const every = (open: string, close: string): OpeningHours => ({ 0: [open, close], 1: [open, close], 2: [open, close], 3: [open, close], 4: [open, close], 5: [open, close], 6: [open, close] }) as OpeningHours;
const turf = { openingHours: every('10:00', '23:00') };
const lounge = { openingHours: every('14:00', '02:00') };
const closed = { openingHours: { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null } as OpeningHours };
const dhaka = (iso: string) => new Date(`${iso}+06:00`);

describe('brandBusinessDate', () => {
  it('keeps the night going until the last section closes', () => {
    expect(brandBusinessDate([turf, lounge], dhaka('2026-10-29T01:00:00'), TZ)).toBe('2026-10-28');
    expect(brandBusinessDate([turf, lounge], dhaka('2026-10-29T11:00:00'), TZ)).toBe('2026-10-29');
    expect(brandBusinessDate([turf], dhaka('2026-10-29T01:00:00'), TZ)).toBe('2026-10-29');
  });
});

describe('deskWindow', () => {
  it('runs from the earliest opening to the latest close', () => {
    const w = deskWindow([turf, lounge], '2026-10-28', TZ)!;
    expect(w.start.toISOString()).toBe(dhaka('2026-10-28T10:00:00').toISOString());
    expect(w.end.toISOString()).toBe(dhaka('2026-10-29T02:00:00').toISOString());
  });

  it('is null when every section is closed', () => {
    expect(deskWindow([closed], '2026-10-28', TZ)).toBeNull();
  });
});

describe('placeOnTimeline', () => {
  const w = { start: dhaka('2026-10-28T10:00:00'), end: dhaka('2026-10-29T02:00:00') };
  it('places a block as a share of the window', () => {
    expect(placeOnTimeline(w, dhaka('2026-10-28T10:00:00'), dhaka('2026-10-28T11:00:00'))).toEqual({ leftPct: 0, widthPct: 6.25 });
  });
  it('clips a block that starts before the window', () => {
    expect(placeOnTimeline(w, dhaka('2026-10-28T09:00:00'), dhaka('2026-10-28T11:00:00'))).toEqual({ leftPct: 0, widthPct: 6.25 });
  });
  it('drops a block outside the window', () => {
    expect(placeOnTimeline(w, dhaka('2026-10-29T03:00:00'), dhaka('2026-10-29T04:00:00'))).toBeNull();
  });
});

describe('freeGaps', () => {
  it('merges neighbouring free slots', () => {
    const at = (h: number) => dhaka(`2026-10-28T${String(h).padStart(2, '0')}:00:00`);
    const slot = (h: number, state: 'free' | 'taken') => ({ start: at(h), end: at(h + 1), state });
    const gaps = freeGaps([slot(10, 'free'), slot(11, 'free'), slot(12, 'taken'), slot(13, 'free')]);
    expect(gaps.map((g) => [g.start.toISOString(), g.end.toISOString()])).toEqual([
      [at(10).toISOString(), at(12).toISOString()],
      [at(13).toISOString(), at(14).toISOString()],
    ]);
  });
});

describe('oldManagePath (spec edge 7)', () => {
  const b = 'demo-brand';
  it('maps each old page to its new address', () => {
    expect(oldManagePath('/manage/demo-brand/sessions/abc', b)).toBe('/manage/games/abc');
    expect(oldManagePath('/manage/demo-brand/resources', b)).toBe('/manage/sections');
    expect(oldManagePath('/manage/demo-brand/activities', b)).toBe('/manage/sections');
    expect(oldManagePath('/manage/demo-brand/sections', b)).toBe('/manage/sections');
    expect(oldManagePath('/manage/demo-brand/settings', b)).toBe('/manage/brand');
    expect(oldManagePath('/manage/demo-brand/bookings', b)).toBe('/manage/bookings');
    expect(oldManagePath('/manage/demo-brand/schedule', b)).toBe('/manage/schedule');
    expect(oldManagePath('/manage/demo-brand/staff', b)).toBe('/manage/staff');
    expect(oldManagePath('/manage/demo-brand', b)).toBe('/manage');
    expect(oldManagePath('/manage/demo-brand/unknown', b)).toBe('/manage');
  });
  it('leaves new and unrelated paths alone', () => {
    expect(oldManagePath('/manage/bookings', b)).toBeNull();
    expect(oldManagePath('/manage/demo-brandx', b)).toBeNull();
    expect(oldManagePath('/turf', b)).toBeNull();
    expect(oldManagePath('/manage/demo-brand', '')).toBeNull();
  });
});

describe('accentReadability (spec edge 5)', () => {
  it('passes the built-in section colours', () => {
    for (const hex of ['#43a66b', '#2e9e93', '#8a78e6']) expect(accentReadability(hex).ok).toBe(true);
  });
  it('refuses a colour that would be hard to read', () => {
    const r = accentReadability('#2b313b');
    expect(r.ok).toBe(false);
    expect(r.onCard).toBeLessThan(4.5);
  });
});
