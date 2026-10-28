import type { SupabaseClient } from '@supabase/supabase-js';

/** A space booking or a seat in a game. */
export type PaymentKind = 'space' | 'seat';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POISHA = 10_000_000;
const bookingTable = (kind: PaymentKind) => (kind === 'space' ? 'resource_bookings' : 'bookings');
const bookingColumn = (kind: PaymentKind) => (kind === 'space' ? 'resource_booking_id' : 'seat_booking_id');

/**
 * Records cash taken at the desk. Pass the signed-in person's own client: the database decides who may
 * (staff of the booking's section, or an owner) and fills the section from the booking.
 */
export async function recordPayment(
  db: SupabaseClient,
  input: { kind: PaymentKind; bookingId: string; amountPoisha: number },
): Promise<'recorded' | 'already_paid' | 'not_payable' | 'invalid_amount' | 'not_found'> {
  if (!UUID.test(input.bookingId)) return 'not_found';
  if (!Number.isInteger(input.amountPoisha) || input.amountPoisha <= 0 || input.amountPoisha > MAX_POISHA) return 'invalid_amount';
  const { data: booking, error } = await db.from(bookingTable(input.kind)).select('status').eq('id', input.bookingId).maybeSingle();
  if (error) throw error;
  if (!booking) return 'not_found';
  if (booking.status === 'cancelled') return 'not_payable';

  const { error: insertError } = await db.from('payments').insert({ [bookingColumn(input.kind)]: input.bookingId, amount_poisha: input.amountPoisha });
  if (!insertError) return 'recorded';
  if (insertError.code === '23505') return 'already_paid';
  if (insertError.code === '23514') return 'invalid_amount';
  // Cancelled in the moment between the check above and the insert.
  if (insertError.message.includes('booking_not_payable')) return 'not_payable';
  if (insertError.code === '42501') return 'not_found';
  throw insertError;
}

/** Undoes a payment by voiding it (it stays on record). Pass the signed-in person's own client. */
export async function voidPayment(db: SupabaseClient, input: { paymentId: string }): Promise<'voided' | 'already_voided' | 'not_found'> {
  if (!UUID.test(input.paymentId)) return 'not_found';
  const { data: payment, error } = await db.from('payments').select('voided_at').eq('id', input.paymentId).maybeSingle();
  if (error) throw error;
  if (!payment) return 'not_found';
  if (payment.voided_at) return 'already_voided';
  const { error: updateError } = await db.from('payments').update({ voided_at: new Date().toISOString() }).eq('id', input.paymentId);
  if (!updateError) return 'voided';
  if (updateError.message.includes('payment_is_void_only')) return 'already_voided';
  throw updateError;
}

/** The live (not voided) payment of each booking or seat that has one, keyed by booking id. */
export async function livePayments(
  db: SupabaseClient,
  input: { spaceBookingIds: string[]; seatBookingIds: string[] },
): Promise<Map<string, { id: string; amountPoisha: number }>> {
  const live = new Map<string, { id: string; amountPoisha: number }>();
  for (const [column, ids] of [
    ['resource_booking_id', input.spaceBookingIds],
    ['seat_booking_id', input.seatBookingIds],
  ] as const) {
    const valid = ids.filter((id) => UUID.test(id));
    if (valid.length === 0) continue;
    const { data, error } = await db.from('payments').select(`id, amount_poisha, ${column}`).in(column, valid).is('voided_at', null);
    if (error) throw error;
    for (const row of data as unknown as Array<Record<string, string | number>>) {
      live.set(String(row[column]), { id: String(row.id), amountPoisha: Number(row.amount_poisha) });
    }
  }
  return live;
}
