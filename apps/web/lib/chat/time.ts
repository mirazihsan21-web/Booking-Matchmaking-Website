import { formatNight, formatShortTime } from '@/lib/format';
import { m } from '@/messages';

/** `YYYY-MM-DD` of an instant in the venue's time zone. */
const dayIn = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/** The calendar day before `YYYY-MM-DD`. */
function dayBefore(day: string): string {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d! - 1)).toISOString().slice(0, 10);
}

/** When a message was sent, in the venue's time zone: "Today, 8:14pm", "Yesterday, 11:59pm" or "Wed 21 Oct, 9am". */
export function chatTime(iso: string, timeZone: string, now: Date): string {
  const sent = dayIn(new Date(iso), timeZone);
  const today = dayIn(now, timeZone);
  if (sent === today) return `${m.chat.today}, ${formatShortTime(iso, timeZone)}`;
  if (sent === dayBefore(today)) return `${m.chat.yesterday}, ${formatShortTime(iso, timeZone)}`;
  return formatNight(iso, timeZone);
}

/** A card's game in the venue's time zone: "Fri 23 Oct, 8pm–9pm". */
export function cardWhen(card: { startsAt: string; endsAt: string }, timeZone: string): string {
  return `${formatNight(card.startsAt, timeZone)}–${formatShortTime(card.endsAt, timeZone)}`;
}
