import { formatNight, formatShortTime } from '@/lib/format';
import { formatBdt } from '@/lib/money';
import { m } from '@/messages';

/** Mirrors the `notification_kind` enum. The open-play kinds are used from Stage B2. */
export type NotificationKind =
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'seat_confirmed'
  | 'waitlisted'
  | 'offer'
  | 'offer_expired'
  | 'seat_cancelled'
  | 'session_cancelled'
  | 'no_seat';

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** "Pitch 1, Fri 23 Oct, 8pm–9pm" in the venue's time zone; "Pitch 1 (Gulshan), …" when it has several branches. */
function spaceAndTime(payload: Record<string, unknown>, timeZone: string): string {
  const branch = payload.multi_branch && str(payload.branch_name) ? ` (${str(payload.branch_name)})` : '';
  return `${str(payload.resource_name)}${branch}, ${formatNight(str(payload.starts_at), timeZone)}–${formatShortTime(str(payload.ends_at), timeZone)}`;
}

/** The words for a notification, from its kind and data. Used by the inbox and the email. */
export function renderNotification(n: { kind: NotificationKind; payload: Record<string, unknown> }, timeZone: string): { title: string; body: string } {
  const t = m.notifications;
  switch (n.kind) {
    case 'booking_confirmed': {
      const price = Number(n.payload.price_poisha ?? 0);
      return { title: t.bookingConfirmed, body: `${spaceAndTime(n.payload, timeZone)}. ${price > 0 ? t.payAtVenue(formatBdt(price)) : t.payAtVenueNoPrice}` };
    }
    case 'booking_cancelled':
      return { title: n.payload.by_venue ? t.cancelledByVenue : t.bookingCancelled, body: `${spaceAndTime(n.payload, timeZone)}.` };
    default:
      return { title: t.update, body: '' };
  }
}
