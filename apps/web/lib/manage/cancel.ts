import { formatBdt } from '@/lib/money';
import { m } from '@/messages';

/**
 * What the desk is asked before cancelling a booking, a seat or a whole game: plainly, or — when it was paid
 * (`count` live payments, `poisha` in all) — to give the money back first, because cancelling voids the payment:
 * cash in cash, and a booking paid online (`method` bKash or Nagad) sent back the same way.
 */
export function cancelQuestion(what: 'booking' | 'seat' | 'game', paid: { count: number; poisha: number; method?: 'cash' | 'bkash' | 'nagad' }): string {
  const c = m.manage.cancel;
  if (paid.count === 0) return c[what];
  if (paid.method === 'bkash' || paid.method === 'nagad') return m.manage.desk.paidOnlineCancelWarning(formatBdt(paid.poisha), m.payments[paid.method]);
  return what === 'game' ? c.paidSeats(paid.count, formatBdt(paid.poisha)) : m.manage.desk.paidCancelWarning(formatBdt(paid.poisha));
}

/**
 * The warning above Today's "Cancel this booking?": money taken (cash, or a payment confirmed online — given back
 * the same way), or a player's payment details the team hasn't checked yet (they may well have sent it). Null when
 * nothing was paid or sent.
 */
export function deskCancelWarning(booking: {
  paidPoisha: number | null;
  paidMethod: 'cash' | 'bkash' | 'nagad' | null;
  pricePoisha: number;
  claim: { method: 'bkash' | 'nagad'; trxId: string } | null;
}): string | null {
  const desk = m.manage.desk;
  if (booking.paidPoisha !== null) {
    return booking.paidMethod === 'bkash' || booking.paidMethod === 'nagad'
      ? desk.paidOnlineCancelWarning(formatBdt(booking.paidPoisha), m.payments[booking.paidMethod])
      : desk.paidCancelWarning(formatBdt(booking.paidPoisha));
  }
  if (booking.claim) return desk.sentCancelWarning(formatBdt(booking.pricePoisha), m.payments[booking.claim.method], booking.claim.trxId);
  return null;
}
