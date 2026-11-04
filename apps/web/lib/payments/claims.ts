import type { SupabaseClient } from '@supabase/supabase-js';
import { parseTstzRange } from '@/lib/bookings/bookings';
import type { PaymentMethod } from '@/lib/forms/payment-claim';
import { paymentNumbers, type PaymentNumbers } from './numbers';

// Paying for an online booking by bKash or Nagad: the player's pay page, sending the details, and the team's list
// to check. Writes go through the database's functions (service role); reads are filtered to the brand and, for
// the team, to the sections they run.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SubmitResult = 'submitted' | 'not_yours' | 'hold_over' | 'not_pending' | 'trx_used' | 'method_closed' | 'invalid';
export type DecideResult = 'confirmed' | 'rejected' | 'not_allowed' | 'not_pending' | 'nothing_sent' | 'invalid';

export interface PayView {
  bookingId: string;
  resourceId: string;
  resourceName: string;
  sectionId: string;
  sectionName: string;
  start: Date;
  end: Date;
  amountPoisha: number;
  holdUntil: Date | null;
  /**
   * hold: send money and the details; sent: waiting for the team; ended: the hold ran out (or the player dropped
   * it); cancelled: the venue cancelled it (before or after it was paid).
   */
  status: 'hold' | 'sent' | 'confirmed' | 'rejected' | 'ended' | 'cancelled';
  rejectReason: string | null;
  numbers: PaymentNumbers;
}

export interface ClaimToCheck {
  bookingId: string;
  playerName: string;
  playerPhone: string | null;
  resourceName: string;
  sectionId: string;
  sectionName: string;
  start: Date;
  end: Date;
  amountPoisha: number;
  method: PaymentMethod;
  senderPhone: string;
  trxId: string;
  submittedAt: Date;
  /** Its time has begun and nobody has decided yet. */
  started: boolean;
}

type Resource = { name: string; section_id: string; sections: { name: string } | null } | null;

/** One of the player's own bookings, as its pay page shows it; null if it isn't theirs. */
export async function payBooking(db: SupabaseClient, input: { bookingId: string; profileId: string; now?: Date }): Promise<PayView | null> {
  if (!UUID.test(input.bookingId)) return null;
  const { data, error } = await db
    .from('resource_bookings')
    .select('id, organization_id, resource_id, period, status, hold_until, price_poisha, cancelled_by, resources(name, section_id, sections(name)), player_profiles(user_id)')
    .eq('id', input.bookingId)
    .eq('profile_id', input.profileId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [{ data: claim, error: claimError }, numbers] = await Promise.all([
    db.from('payment_claims').select('status, reason').eq('booking_id', input.bookingId).maybeSingle(),
    paymentNumbers(db, data.organization_id as string),
  ]);
  if (claimError) throw claimError;
  const now = input.now ?? new Date();
  const holdUntil = data.hold_until ? new Date(data.hold_until as string) : null;
  const resource = data.resources as unknown as Resource;
  const { start, end } = parseTstzRange(data.period as string);
  const rejected = claim?.status === 'rejected' && claim.reason !== 'cancelled';
  let status: PayView['status'];
  if (data.status === 'pending') status = holdUntil ? (holdUntil > now ? 'hold' : 'ended') : 'sent';
  else if (data.status === 'cancelled') {
    // Nobody (the hold ran out) or the player themselves: ended. Anyone else is the venue.
    const player = (data.player_profiles as unknown as { user_id: string } | null)?.user_id ?? null;
    const byVenue = data.cancelled_by !== null && data.cancelled_by !== player;
    status = rejected ? 'rejected' : byVenue ? 'cancelled' : 'ended';
  }
  else status = 'confirmed';
  return {
    bookingId: data.id as string,
    resourceId: data.resource_id as string,
    resourceName: resource?.name ?? '',
    sectionId: resource?.section_id ?? '',
    sectionName: resource?.sections?.name ?? '',
    start,
    end,
    amountPoisha: data.price_poisha as number,
    holdUntil,
    status,
    rejectReason: rejected ? ((claim!.reason as string | null) ?? null) : null,
    numbers,
  };
}

/** The player sends what they paid with. Takes the service client; the database checks it's their booking and its hold. */
export async function submitClaim(
  db: SupabaseClient,
  input: { bookingId: string; userId: string; method: PaymentMethod; senderPhone: string; trxId: string },
): Promise<SubmitResult> {
  if (!UUID.test(input.bookingId)) return 'not_yours';
  const { data, error } = await db.rpc('submit_payment_claim', {
    p_booking_id: input.bookingId,
    p_user_id: input.userId,
    p_method: input.method,
    p_sender_phone: input.senderPhone,
    p_trx_id: input.trxId,
  });
  if (error) throw error;
  return data as SubmitResult;
}

/** An owner or the section's staff confirms or rejects (reason optional). Takes the service client. */
export async function decideClaim(
  db: SupabaseClient,
  input: { bookingId: string; userId: string; decision: 'confirm' | 'reject'; reason: string | null },
): Promise<DecideResult> {
  if (!UUID.test(input.bookingId)) return 'not_pending';
  const { data, error } = await db.rpc('decide_payment_claim', {
    p_booking_id: input.bookingId,
    p_user_id: input.userId,
    p_decision: input.decision,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data as DecideResult;
}

/** Payments waiting for the team, in these sections, oldest first. */
export async function claimsToCheck(db: SupabaseClient, input: { organizationId: string; sectionIds: string[]; now?: Date }): Promise<ClaimToCheck[]> {
  if (input.sectionIds.length === 0) return [];
  const { data, error } = await db
    .from('payment_claims')
    .select(
      'booking_id, amount_poisha, method, sender_phone, trx_id, submitted_at, resource_bookings!inner(period, resources(name, section_id, sections(name)), player_profiles(display_name, phone))',
    )
    .eq('organization_id', input.organizationId)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  const now = input.now ?? new Date();
  return (data ?? [])
    .map((row): ClaimToCheck => {
      const booking = row.resource_bookings as unknown as {
        period: string;
        resources: Resource;
        player_profiles: { display_name: string; phone: string | null } | null;
      };
      const { start, end } = parseTstzRange(booking.period);
      return {
        bookingId: row.booking_id as string,
        playerName: booking.player_profiles?.display_name ?? '',
        playerPhone: booking.player_profiles?.phone ?? null,
        resourceName: booking.resources?.name ?? '',
        sectionId: booking.resources?.section_id ?? '',
        sectionName: booking.resources?.sections?.name ?? '',
        start,
        end,
        amountPoisha: row.amount_poisha as number,
        method: row.method as PaymentMethod,
        senderPhone: row.sender_phone as string,
        trxId: row.trx_id as string,
        submittedAt: new Date(row.submitted_at as string),
        started: start <= now,
      };
    })
    .filter((claim) => input.sectionIds.includes(claim.sectionId));
}

/** How many payments wait for the team in these sections (the Manage menu's "Payments (n)"). */
export async function claimsToCheckCount(db: SupabaseClient, input: { organizationId: string; sectionIds: string[] }): Promise<number> {
  return (await claimsToCheck(db, input)).length;
}

/** Requests still inside their 15 minutes (no details yet), so the team knows why those slots are taken. */
export async function holdsWaiting(
  db: SupabaseClient,
  input: { organizationId: string; sectionIds: string[] },
): Promise<Array<{ bookingId: string; playerName: string; resourceName: string; sectionId: string; start: Date; holdUntil: Date }>> {
  if (input.sectionIds.length === 0) return [];
  const { data, error } = await db
    .from('resource_bookings')
    .select('id, period, hold_until, resources(name, section_id), player_profiles(display_name)')
    .eq('organization_id', input.organizationId)
    .eq('status', 'pending')
    .not('hold_until', 'is', null)
    .order('hold_until', { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .map((b) => {
      const resource = b.resources as unknown as { name: string; section_id: string } | null;
      return {
        bookingId: b.id as string,
        playerName: (b.player_profiles as unknown as { display_name: string } | null)?.display_name ?? '',
        resourceName: resource?.name ?? '',
        sectionId: resource?.section_id ?? '',
        start: parseTstzRange(b.period as string).start,
        holdUntil: new Date(b.hold_until as string),
      };
    })
    .filter((hold) => input.sectionIds.includes(hold.sectionId));
}
