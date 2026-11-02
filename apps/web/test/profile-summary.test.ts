import { describe, expect, it } from 'vitest';
import type { MyBooking } from '../lib/bookings/bookings';
import type { MySeat } from '../lib/open-play/open-play';
import { availabilityLine, summariseProfile } from '../lib/profiles/summary';

const NOW = new Date('2026-11-02T12:00:00Z');
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

const booking = (startsIn: number, status = 'confirmed', resourceName = 'Pitch 1'): MyBooking => ({
  id: `b${startsIn}${status}`,
  resourceName,
  sectionId: 'turf',
  sectionName: 'Turf',
  startsAt: at(startsIn),
  endsAt: at(startsIn + 1),
  pricePoisha: 60000,
  status,
  cancellable: true,
  paid: false,
});

const seat = (startsIn: number, status = 'confirmed', activityName = '7-a-side football'): MySeat => ({
  bookingId: `s${startsIn}${status}`,
  sessionId: `g${startsIn}`,
  sectionId: 'turf',
  activityName,
  resourceName: 'Pitch 2',
  startsAt: at(startsIn),
  endsAt: at(startsIn + 1),
  team: 1,
  pricePoisha: 30000,
  status,
  cancellable: true,
  paid: false,
});

describe('summariseProfile', () => {
  it('counts games played: seats confirmed or attended in games that have started', () => {
    const seats = [seat(-24), seat(-48, 'attended'), seat(-24, 'cancelled'), seat(-24, 'no_show'), seat(24)];
    expect(summariseProfile([], seats, NOW).gamesPlayed).toBe(2);
  });

  it('counts spaces booked that were not cancelled', () => {
    expect(summariseProfile([booking(-24), booking(24), booking(48, 'cancelled')], [], NOW).spacesBooked).toBe(2);
  });

  it('shows the soonest booking or seat still to come as next up', () => {
    expect(summariseProfile([booking(24)], [seat(48)], NOW).nextUp).toEqual({ kind: 'space', sectionId: 'turf', title: 'Pitch 1', startsAt: at(24) });
    expect(summariseProfile([booking(48)], [seat(24)], NOW).nextUp).toEqual({ kind: 'game', sectionId: 'turf', title: '7-a-side football', startsAt: at(24) });
  });

  it('has nothing next up when everything still to come is cancelled, or there is nothing', () => {
    expect(summariseProfile([booking(24, 'cancelled')], [seat(24, 'cancelled')], NOW).nextUp).toBeNull();
    expect(summariseProfile([], [], NOW)).toEqual({ gamesPlayed: 0, spacesBooked: 0, nextUp: null });
  });
});

describe('availabilityLine', () => {
  it('lists the usual play times Sunday first, with short day names', () => {
    expect(
      availabilityLine([
        { weekday: 6, start: '10:00', end: '14:00' },
        { weekday: 5, start: '18:00', end: '22:00' },
      ]),
    ).toBe('Fri 18:00–22:00 · Sat 10:00–14:00');
  });

  it('is empty with no times', () => {
    expect(availabilityLine([])).toBe('');
  });
});
