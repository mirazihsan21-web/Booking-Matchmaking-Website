/** Offset (local − UTC, in ms) of `timeZone` at the given instant. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return local - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant of a local wall-clock time in `timeZone`, DST-safe.
 * Guesses with the offset at the naive instant, then corrects once if the offset differs there.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetAt(naive, timeZone);
  let utc = naive - first;
  const second = offsetAt(utc, timeZone);
  if (second !== first) utc = naive - second;
  return new Date(utc);
}
