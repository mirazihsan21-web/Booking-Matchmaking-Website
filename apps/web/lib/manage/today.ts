import type { SlotState } from '@/lib/bookings/slots';
import { currentBusinessDate, instantAt, localDate } from '@/lib/bookings/slots';
import type { OpeningHours } from '@/lib/opening-hours';
import { openingWindow } from '@/lib/schedule/time';

type WithHours = { openingHours: OpeningHours };

/**
 * The desk's business day: the earliest of the sections' own business days, so after midnight Today keeps
 * showing the night until the last section that is still open closes.
 */
export function brandBusinessDate(sections: WithHours[], now: Date, timeZone: string): string {
  const dates = sections.map((s) => currentBusinessDate(s.openingHours, now, timeZone));
  return dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : localDate(now, timeZone);
}

/** From the earliest opening to the latest close of the sections open on that business day; null if none is. */
export function deskWindow(sections: WithHours[], date: string, timeZone: string): { start: Date; end: Date } | null {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const windows = sections.map((s) => openingWindow(s.openingHours, weekday)).filter((w): w is [number, number] => w !== null);
  if (windows.length === 0) return null;
  const open = Math.min(...windows.map((w) => w[0]));
  const close = Math.max(...windows.map((w) => w[1]));
  return { start: instantAt(date, open, timeZone), end: instantAt(date, close, timeZone) };
}

/** Where a block sits on the timeline, as shares of the window (clipped to it); null when it falls outside. */
export function placeOnTimeline(window: { start: Date; end: Date }, start: Date, end: Date): { leftPct: number; widthPct: number } | null {
  const total = window.end.getTime() - window.start.getTime();
  const from = Math.max(start.getTime(), window.start.getTime());
  const to = Math.min(end.getTime(), window.end.getTime());
  if (total <= 0 || to <= from) return null;
  return { leftPct: ((from - window.start.getTime()) / total) * 100, widthPct: ((to - from) / total) * 100 };
}

type DeskSlot = { start: Date; end: Date; state: SlotState; bookings?: unknown[] };

/** Whether the desk can sell a slot: free, or (given `now`) the one already under way when nobody has it. */
export function isDeskFree(slot: DeskSlot, now?: Date): boolean {
  if (slot.state === 'free') return true;
  return now !== undefined && slot.state === 'past' && slot.start <= now && now < slot.end && !slot.bookings?.length;
}

/** Runs of neighbouring slots the desk can sell (see isDeskFree), as one gap each. */
export function freeGaps(slots: DeskSlot[], now?: Date): Array<{ start: Date; end: Date }> {
  const gaps: Array<{ start: Date; end: Date }> = [];
  for (const slot of slots) {
    if (!isDeskFree(slot, now)) continue;
    const last = gaps.at(-1);
    if (last && last.end.getTime() === slot.start.getTime()) last.end = slot.end;
    else gaps.push({ start: slot.start, end: slot.end });
  }
  return gaps;
}
