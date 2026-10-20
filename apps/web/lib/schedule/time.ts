import { zonedTimeToUtc } from '@bm/sim';
import type { OpeningHours, Weekday } from '@/lib/opening-hours';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The same local wall-clock time on `weeks` consecutive weeks (1–12), as UTC instants. */
export function weeklyStarts(first: { date: string; time: string }, weeks: number, timeZone: string): Date[] {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) throw new RangeError('weeks must be between 1 and 12');
  const day0 = Date.parse(`${first.date}T00:00:00Z`);
  return Array.from({ length: weeks }, (_, i) => {
    const date = new Date(day0 + i * 7 * DAY_MS).toISOString().slice(0, 10);
    return zonedTimeToUtc(date, first.time, timeZone);
  });
}

/** The local weekday (0 = Sunday) and minutes since local midnight of an instant. */
export function localDayAndMinutes(instant: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { weekday: WEEKDAY_INDEX[get('weekday')]!, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A day's window in minutes from that day's midnight; an overnight close runs past 1440. */
export function openingWindow(hours: OpeningHours, weekday: number): [number, number] | null {
  const day = hours[String(weekday) as Weekday];
  if (!day) return null;
  const open = toMinutes(day[0]);
  let close = toMinutes(day[1]);
  if (close <= open) close += 1440;
  return [open, close];
}

/**
 * Whether [start, start + duration) fits inside the opening window that contains its start: that
 * day's window, or the previous day's window when it runs past midnight.
 */
export function withinOpeningHours(hours: OpeningHours, start: Date, durationMin: number, timeZone: string): boolean {
  const { weekday, minutes } = localDayAndMinutes(start, timeZone);
  const end = minutes + durationMin;

  const today = openingWindow(hours, weekday);
  if (today && today[0] <= minutes && end <= today[1]) return true;

  const yesterday = openingWindow(hours, (weekday + 6) % 7);
  if (yesterday && yesterday[1] > 1440) {
    // Shift yesterday's overnight tail onto today's clock.
    return end <= yesterday[1] - 1440;
  }
  return false;
}
