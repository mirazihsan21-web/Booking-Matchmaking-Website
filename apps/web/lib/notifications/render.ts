import { formatNight, formatShortTime } from '@/lib/format';
import { formatBdt } from '@/lib/money';
import { m } from '@/messages';

/** Mirrors the `notification_kind` enum. */
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

/** "Pitch 1 (Turf)": the space and its section (rows from before sections have no section name). */
function space(payload: Record<string, unknown>): string {
  const section = str(payload.section_name) ? ` (${str(payload.section_name)})` : '';
  return `${str(payload.resource_name)}${section}`;
}

/** "Fri 23 Oct, 8pm–9pm" in the venue's time zone. */
function span(payload: Record<string, unknown>, timeZone: string): string {
  return `${formatNight(str(payload.starts_at), timeZone)}–${formatShortTime(str(payload.ends_at), timeZone)}`;
}

/** "Pitch 1, Fri 23 Oct, 8pm–9pm". */
function spaceAndTime(payload: Record<string, unknown>, timeZone: string): string {
  return `${space(payload)}, ${span(payload, timeZone)}`;
}

const activity = (payload: Record<string, unknown>) => str(payload.activity_name) || m.notifications.openPlay;

/** "5-a-side futsal, Fri 23 Oct, 8pm" — "Open play, …" when players choose the game. */
function sessionAt(payload: Record<string, unknown>, timeZone: string): string {
  return `${activity(payload)}, ${formatNight(str(payload.starts_at), timeZone)}`;
}

/** "5-a-side futsal, Fri 23 Oct, 8pm–9pm". */
function sessionSpan(payload: Record<string, unknown>, timeZone: string): string {
  return `${activity(payload)}, ${span(payload, timeZone)}`;
}

/** "Pitch 1, Team 2" — just the space for a free-for-all game. */
function seat(payload: Record<string, unknown>): string {
  return typeof payload.team === 'number' ? `${space(payload)}, ${m.notifications.team(payload.team)}` : space(payload);
}

function price(payload: Record<string, unknown>): string {
  const poisha = Number(payload.price_poisha ?? 0);
  return poisha > 0 ? m.notifications.payAtVenue(formatBdt(poisha)) : m.notifications.payAtVenueNoPrice;
}

/** The words for a notification, from its kind and data. Used by the inbox and the email. */
export function renderNotification(n: { kind: NotificationKind; payload: Record<string, unknown> }, timeZone: string): { title: string; body: string } {
  const t = m.notifications;
  switch (n.kind) {
    case 'booking_confirmed':
      return { title: t.bookingConfirmed, body: `${spaceAndTime(n.payload, timeZone)}. ${price(n.payload)}` };
    case 'booking_cancelled':
      return { title: n.payload.by_venue ? t.cancelledByVenue : t.bookingCancelled, body: `${spaceAndTime(n.payload, timeZone)}.` };
    case 'seat_confirmed':
      return { title: t.seatConfirmed, body: `${sessionSpan(n.payload, timeZone)}. ${seat(n.payload)}. ${price(n.payload)}` };
    case 'waitlisted':
      return { title: t.waitlisted, body: `${sessionAt(n.payload, timeZone)}. ${t.waitlistPlace(Number(n.payload.position ?? 1))}` };
    case 'offer':
      return {
        title: t.offer,
        body: `${sessionSpan(n.payload, timeZone)}. ${seat(n.payload)}. ${t.offerEnds(formatShortTime(str(n.payload.expires_at), timeZone))}`,
      };
    case 'offer_expired':
      return { title: t.offerExpired, body: `${sessionAt(n.payload, timeZone)}. ${t.offerPassedOn}` };
    case 'seat_cancelled':
      return { title: n.payload.by_venue ? t.seatCancelledByVenue : t.seatCancelled, body: `${sessionAt(n.payload, timeZone)}.` };
    case 'session_cancelled':
      return { title: t.sessionCancelled, body: t.sessionCancelledBody(sessionAt(n.payload, timeZone)) };
    case 'no_seat':
      return { title: n.payload.reason === 'not_enough_players' ? t.notEnoughPlayers : t.noSeat, body: `${sessionAt(n.payload, timeZone)}.` };
    default:
      return { title: t.update, body: '' };
  }
}
