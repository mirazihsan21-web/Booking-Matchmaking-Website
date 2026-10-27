import { addDays, parseDateParam } from '@/lib/bookings/slots';

const SHOWN = 7;

/**
 * The booking page's day strip: seven days at a time from `start` (today when missing, malformed or
 * outside the window), never past today + `horizonDays`. `prev`/`next` are the starts of the
 * neighbouring weeks, or null at either end.
 */
export function dayWindow(today: string, horizonDays: number, start?: string): { days: string[]; prev: string | null; next: string | null } {
  const last = addDays(today, horizonDays);
  const asked = parseDateParam(start, today);
  const from = asked < today || asked > last ? today : asked;
  const days: string[] = [];
  for (let d = from; d <= last && days.length < SHOWN; d = addDays(d, 1)) days.push(d);
  const back = addDays(from, -SHOWN);
  const forward = addDays(from, SHOWN);
  return { days, prev: from === today ? null : back < today ? today : back, next: forward <= last ? forward : null };
}
