import { describe, expect, it } from 'vitest';
import type { OpeningHours } from '../lib/opening-hours';
import { takingsFromRows } from '../lib/payments/takings';

const TZ = 'Asia/Dhaka';
const every = (open: string, close: string): OpeningHours => ({ 0: [open, close], 1: [open, close], 2: [open, close], 3: [open, close], 4: [open, close], 5: [open, close], 6: [open, close] }) as OpeningHours;
const dhaka = (iso: string) => new Date(`${iso}+06:00`);
const sections = [
  { id: 'turf', openingHours: every('10:00', '23:00') },
  { id: 'lounge', openingHours: every('14:00', '02:00') },
];

describe('takingsFromRows', () => {
  const rows = takingsFromRows({
    sections,
    date: '2026-10-28',
    timeZone: TZ,
    spaceBookings: [
      { sectionId: 'turf', start: dhaka('2026-10-28T18:00:00'), status: 'attended' },
      { sectionId: 'turf', start: dhaka('2026-10-28T20:00:00'), status: 'no_show' },
      { sectionId: 'turf', start: dhaka('2026-10-28T21:00:00'), status: 'cancelled' },
      { sectionId: 'turf', start: dhaka('2026-10-29T12:00:00'), status: 'confirmed' }, // the next day
      { sectionId: 'lounge', start: dhaka('2026-10-29T00:30:00'), status: 'confirmed' }, // still the 28th's night
    ],
    seats: [{ sectionId: 'lounge', start: dhaka('2026-10-28T21:00:00'), status: 'attended' }],
    payments: [
      { sectionId: 'turf', takenAt: dhaka('2026-10-28T18:05:00'), amountPoisha: 60000 },
      { sectionId: 'lounge', takenAt: dhaka('2026-10-29T01:00:00'), amountPoisha: 15000 }, // after midnight: the 28th (spec edge 4)
      { sectionId: 'turf', takenAt: dhaka('2026-10-29T01:00:00'), amountPoisha: 99900 }, // turf closed at 23:00: the 29th
    ],
  });

  it('counts each section on its own business day', () => {
    expect(rows.rows).toEqual([
      { sectionId: 'turf', bookings: 2, seats: 0, arrived: 1, noShows: 1, cashPoisha: 60000 },
      { sectionId: 'lounge', bookings: 1, seats: 1, arrived: 1, noShows: 0, cashPoisha: 15000 },
    ]);
  });

  it('adds up a total', () => {
    expect(rows.total).toEqual({ bookings: 3, seats: 1, arrived: 2, noShows: 1, cashPoisha: 75000 });
  });
});
