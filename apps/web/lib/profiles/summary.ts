import type { MyBooking } from '@/lib/bookings/bookings';
import type { MySeat } from '@/lib/open-play/open-play';
import { m } from '@/messages';

/** The soonest thing a player has booked: a space, or a seat in a game. */
export interface NextUp {
  kind: 'space' | 'game';
  sectionId: string;
  /** The space's name, or the game's activity. */
  title: string;
  startsAt: string;
}

export interface ProfileSummary {
  gamesPlayed: number;
  spacesBooked: number;
  nextUp: NextUp | null;
}

const PLAYED = new Set(['confirmed', 'attended']);
const NOT_ON = new Set(['cancelled', 'no_show']);

/**
 * "Your play" on the profile, from the same lists My bookings shows: seats in games that have started
 * (confirmed or attended), space bookings that weren't cancelled, and the soonest booking or seat to come.
 */
export function summariseProfile(bookings: MyBooking[], seats: MySeat[], now: Date): ProfileSummary {
  const t = now.getTime();
  const gamesPlayed = seats.filter((s) => PLAYED.has(s.status) && Date.parse(s.startsAt) <= t).length;
  const spacesBooked = bookings.filter((b) => b.status !== 'cancelled').length;
  const coming: NextUp[] = [
    ...bookings
      .filter((b) => !NOT_ON.has(b.status) && Date.parse(b.startsAt) > t)
      .map((b) => ({ kind: 'space' as const, sectionId: b.sectionId, title: b.resourceName, startsAt: b.startsAt })),
    ...seats
      .filter((s) => !NOT_ON.has(s.status) && Date.parse(s.startsAt) > t)
      .map((s) => ({ kind: 'game' as const, sectionId: s.sectionId, title: s.activityName, startsAt: s.startsAt })),
  ];
  const nextUp = coming.reduce<NextUp | null>((soonest, item) => (!soonest || Date.parse(item.startsAt) < Date.parse(soonest.startsAt) ? item : soonest), null);
  return { gamesPlayed, spacesBooked, nextUp };
}

/** Usual play times, Sunday first: "Fri 18:00–22:00 · Sat 10:00–14:00"; "" for none. */
export function availabilityLine(rows: Array<{ weekday: number; start: string; end: string }>): string {
  return [...rows]
    .sort((a, b) => a.weekday - b.weekday)
    .map((r) => `${m.weekdays[r.weekday]!.slice(0, 3)} ${r.start.slice(0, 5)}–${r.end.slice(0, 5)}`)
    .join(' · ');
}
