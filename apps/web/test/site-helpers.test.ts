import { describe, expect, it } from 'vitest';
import type { OpeningHours } from '../lib/opening-hours';
import { dayWindow } from '../lib/site/days';
import { clockLabel, statusNow } from '../lib/site/hours';
import { kindWords, sectionBlurb, sectionPhoto, sectionPhotoUrl } from '../lib/site/kinds';
import { bookPath, mapsLink, sectionPath } from '../lib/site/paths';
import { seatsLevel } from '../lib/site/seats';
import { m } from '../messages';

const tz = 'Asia/Dhaka'; // UTC+6, no daylight saving
const every = (open: string, close: string): OpeningHours =>
  Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, [open, close]])) as OpeningHours;
/** Friday 30 October 2026 at a Dhaka wall-clock time (or another date). */
const at = (hhmm: string, date = '2026-10-30') => new Date(`${date}T${hhmm}:00+06:00`);

describe('statusNow', () => {
  it('is open until closing time during the day', () => {
    expect(statusNow([every('10:00', '23:00')], tz, at('14:00'))).toEqual({ state: 'open', until: '23:00' });
  });

  it('says when it opens later today', () => {
    expect(statusNow([every('10:00', '23:00')], tz, at('09:00'))).toEqual({ state: 'later', opens: '10:00' });
  });

  it('is closed after closing time, and on a closed day', () => {
    expect(statusNow([every('10:00', '23:00')], tz, at('23:30'))).toEqual({ state: 'closed' });
    expect(statusNow([{ ...every('10:00', '23:00'), '5': null }], tz, at('14:00'))).toEqual({ state: 'closed' });
  });

  it("stays open after midnight on last night's overnight hours (Review Focus 3)", () => {
    expect(statusNow([every('14:00', '02:00')], tz, at('01:00', '2026-10-31'))).toEqual({ state: 'open', until: '02:00' });
  });

  it('takes the latest close when several sections are open', () => {
    expect(statusNow([every('10:00', '23:00'), every('14:00', '02:00')], tz, at('22:30'))).toEqual({ state: 'open', until: '02:00' });
  });
});

describe('clockLabel', () => {
  it('reads a 24-hour time the way people say it', () => {
    expect(clockLabel('23:00')).toBe('11 PM');
    expect(clockLabel('02:00')).toBe('2 AM');
    expect(clockLabel('10:30')).toBe('10:30 AM');
    expect(clockLabel('12:00')).toBe('12 PM');
    expect(clockLabel('00:00')).toBe('12 AM');
  });
});

describe('dayWindow', () => {
  it('shows seven days from today with a next arrow', () => {
    expect(dayWindow('2026-10-28', 14)).toEqual({
      days: ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'],
      prev: null,
      next: '2026-11-04',
    });
  });

  it('pages on by a week and back', () => {
    expect(dayWindow('2026-10-28', 14, '2026-11-04')).toEqual({
      days: ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'],
      prev: '2026-10-28',
      next: '2026-11-11',
    });
  });

  it('stops at the last day of the booking window', () => {
    expect(dayWindow('2026-10-28', 14, '2026-11-11')).toEqual({ days: ['2026-11-11'], prev: '2026-11-04', next: null });
    expect(dayWindow('2026-10-28', 3)).toEqual({ days: ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'], prev: null, next: null });
  });

  it('treats a start outside the window as today', () => {
    expect(dayWindow('2026-10-28', 14, '2026-10-01')).toEqual(dayWindow('2026-10-28', 14));
    expect(dayWindow('2026-10-28', 14, '2026-12-25')).toEqual(dayWindow('2026-10-28', 14));
    expect(dayWindow('2026-10-28', 14, 'garbage')).toEqual(dayWindow('2026-10-28', 14));
  });
});

describe('seatsLevel (Review Focus 5)', () => {
  it('is full at 0, low at 1–2 and plenty above', () => {
    expect(seatsLevel(0)).toBe('full');
    expect(seatsLevel(1)).toBe('low');
    expect(seatsLevel(2)).toBe('low');
    expect(seatsLevel(3)).toBe('plenty');
  });
});

describe('paths and kinds', () => {
  it('builds section and booking addresses', () => {
    expect(sectionPath('turf-2')).toBe('/turf-2');
    expect(bookPath('turf')).toBe('/turf/book');
    expect(bookPath('turf', { resource: 'r1', date: '2026-10-30' })).toBe('/turf/book?resource=r1&date=2026-10-30');
  });

  it("uses each kind's own wording and photo", () => {
    expect(kindWords('gaming_lounge')).toEqual({ join: 'Squad up', book: 'Book a PC', games: 'squad sessions', noGames: 'No squad sessions yet' });
    expect(kindWords('turf')).toEqual({ join: 'Join match', book: 'Book pitch', games: 'open matches', noGames: 'No open matches yet' });
    expect(kindWords('boardgame_cafe')).toEqual({ join: 'Grab a seat', book: 'Book table', games: 'game nights', noGames: 'No game nights yet' });
    expect(sectionPhoto('boardgame_cafe')).toBe('/sections/cafe.jpg');
    expect(sectionPhoto('turf')).toBe('/sections/turf.jpg');
    expect(sectionPhoto('gaming_lounge')).toBe('/sections/lounge.jpg');
  });

  it("uses a section's own photo and description when it has them, else the kind's", () => {
    expect(sectionPhotoUrl({ kind: 'turf', photoPath: null })).toBe('/sections/turf.jpg');
    expect(sectionPhotoUrl({ kind: 'turf', photoPath: 'org/sections/sec/p.jpg' })).toBe(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/org-assets/org/sections/sec/p.jpg`);
    expect(sectionBlurb({ kind: 'gaming_lounge', description: null })).toBe(m.site.landing.blurb.gaming_lounge);
    expect(sectionBlurb({ kind: 'gaming_lounge', description: 'Forty PCs.' })).toBe('Forty PCs.');
  });
});

describe('mapsLink', () => {
  it('searches Google Maps for the address', () => {
    expect(mapsLink('House 12, Road 5, Dhanmondi, Dhaka')).toBe('https://www.google.com/maps/search/?api=1&query=House%2012%2C%20Road%205%2C%20Dhanmondi%2C%20Dhaka');
  });
});
