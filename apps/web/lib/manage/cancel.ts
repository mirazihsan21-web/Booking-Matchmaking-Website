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
