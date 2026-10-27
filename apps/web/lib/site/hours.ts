import type { OpeningHours } from '@/lib/opening-hours';
import { localDayAndMinutes, openingWindow } from '@/lib/schedule/time';

export type OpenStatus = { state: 'open'; until: string } | { state: 'later'; opens: string } | { state: 'closed' };

const hhmm = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Whether a place with these hours (one entry per section) is open now: open until the latest
 * closing time among the sections open now (last night's overnight hours count after midnight), else
 * the earliest opening later today, else closed. Times are local `HH:MM`.
 */
export function statusNow(hours: OpeningHours[], timeZone: string, now: Date): OpenStatus {
  const { weekday, minutes } = localDayAndMinutes(now, timeZone);
  let until: number | null = null;
  let opens: number | null = null;
  for (const h of hours) {
    const today = openingWindow(h, weekday);
    const lastNight = openingWindow(h, (weekday + 6) % 7);
    // Minutes are counted from today's midnight, so an overnight close today is past 1440.
    if (lastNight && minutes < lastNight[1] - 1440) until = Math.max(until ?? 0, lastNight[1] - 1440);
    if (today && minutes >= today[0] && minutes < today[1]) until = Math.max(until ?? 0, today[1]);
    if (today && minutes < today[0]) opens = Math.min(opens ?? Infinity, today[0]);
  }
  if (until !== null) return { state: 'open', until: hhmm(until) };
  if (opens !== null) return { state: 'later', opens: hhmm(opens) };
  return { state: 'closed' };
}

/** A local `HH:MM` the way people say it: "11 PM", "2 AM", "10:30 AM". */
export function clockLabel(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
