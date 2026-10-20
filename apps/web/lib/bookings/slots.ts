import { zonedTimeToUtc } from '@bm/sim';
import type { OpeningHours } from '@/lib/opening-hours';
import { openingWindow } from '@/lib/schedule/time';

/** One bookable slot of a space. */
export interface Slot {
  start: Date;
  end: Date;
}

export type SlotState = 'free' | 'taken' | 'open_play' | 'past';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A `?date=` query value if it is a real calendar date, otherwise `today` (never throws). */
export function parseDateParam(value: string | undefined, today: string): string {
  if (!value || !DATE.test(value)) return today;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : today;
}

/** Local minutes from the business day's midnight (may exceed 1440 overnight) → an instant. */
function instantAt(date: string, minutes: number, timeZone: string): Date {
  const day = addDays(date, Math.floor(minutes / 1440));
  const m = minutes % 1440;
  const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return zonedTimeToUtc(day, hhmm, timeZone);
}

/**
 * A business day's slots for a space: from that date's opening time in steps of `slotMinutes`, each
 * ending by closing time. Overnight hours (close ≤ open, e.g. 14:00–02:00) run past midnight but still
 * belong to this business day. A closed day has no slots.
 */
export function businessDaySlots(hours: OpeningHours, date: string, slotMinutes: number, timeZone: string): Slot[] {
  const window = openingWindow(hours, new Date(`${date}T00:00:00Z`).getUTCDay());
  if (!window) return [];
  const [open, close] = window;
  const slots: Slot[] = [];
  for (let m = open; m + slotMinutes <= close; m += slotMinutes) {
    slots.push({ start: instantAt(date, m, timeZone), end: instantAt(date, m + slotMinutes, timeZone) });
  }
  return slots;
}

/**
 * What each slot looks like to someone booking: `past` once it has started, `open_play` if a session
 * holds any of its time, `taken` if a booking does, else `free`. Overlap is by time, so bookings made
 * before a slot length or opening hours changed still block the right slots.
 */
export function slotStates(
  slots: Slot[],
  busy: Array<{ start: Date; end: Date; source: 'booking' | 'session' }>,
  now: Date,
): Array<Slot & { state: SlotState }> {
  return slots.map((slot) => {
    if (slot.start <= now) return { ...slot, state: 'past' };
    const overlapping = busy.filter((b) => b.start < slot.end && b.end > slot.start);
    if (overlapping.some((b) => b.source === 'session')) return { ...slot, state: 'open_play' };
    if (overlapping.length > 0) return { ...slot, state: 'taken' };
    return { ...slot, state: 'free' };
  });
}

/**
 * Whether a booking of `slots` consecutive slots may start at `startsAt`: on the grid of its business
 * day (the start's local date, or the day before when it falls in that day's overnight tail), ending
 * by closing time, not started yet, and — for players — within the venue's booking window.
 * `horizonDays: null` (staff) skips the window.
 */
export function checkBookingStart(input: {
  hours: OpeningHours;
  slotMinutes: number;
  timeZone: string;
  startsAt: Date;
  slots: number;
  now: Date;
  horizonDays: number | null;
}): { ok: true; endsAt: Date; businessDate: string } | { ok: false; reason: 'bad_count' | 'past' | 'off_grid' | 'outside_hours' | 'beyond_horizon' } {
  const { hours, slotMinutes, timeZone, startsAt, slots, now, horizonDays } = input;
  if (!Number.isInteger(slots) || slots < 1 || slots > 4) return { ok: false, reason: 'bad_count' };
  if (startsAt <= now) return { ok: false, reason: 'past' };

  const sameDay = localDate(startsAt, timeZone);
  for (const businessDate of [sameDay, addDays(sameDay, -1)]) {
    const grid = businessDaySlots(hours, businessDate, slotMinutes, timeZone);
    const first = grid.findIndex((s) => s.start.getTime() === startsAt.getTime());
    if (first === -1) continue;
    const last = grid[first + slots - 1];
    if (!last) return { ok: false, reason: 'outside_hours' };
    if (horizonDays !== null && businessDate > addDays(localDate(now, timeZone), horizonDays)) return { ok: false, reason: 'beyond_horizon' };
    return { ok: true, endsAt: last.end, businessDate };
  }
  return { ok: false, reason: 'off_grid' };
}
