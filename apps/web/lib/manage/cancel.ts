import { formatBdt } from '@/lib/money';
import { m } from '@/messages';

/**
 * What the desk is asked before cancelling a booking, a seat or a whole game: plainly, or — when cash was taken
 * (`count` live payments, `poisha` in all) — to give it back first, because cancelling voids the payment.
 */
export function cancelQuestion(what: 'booking' | 'seat' | 'game', paid: { count: number; poisha: number }): string {
  const c = m.manage.cancel;
  if (paid.count === 0) return c[what];
  return what === 'game' ? c.paidSeats(paid.count, formatBdt(paid.poisha)) : m.manage.desk.paidCancelWarning(formatBdt(paid.poisha));
}
