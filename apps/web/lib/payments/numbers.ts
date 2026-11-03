import type { SupabaseClient } from '@supabase/supabase-js';

/** The brand's bKash and Nagad numbers for online bookings (either may be unset). */
export type PaymentNumbers = { bkash: string | null; nagad: string | null };

export async function paymentNumbers(db: SupabaseClient, organizationId: string): Promise<PaymentNumbers> {
  const { data, error } = await db.from('organizations').select('bkash_number, nagad_number').eq('id', organizationId).maybeSingle();
  if (error) throw error;
  return { bkash: (data?.bkash_number as string | null) ?? null, nagad: (data?.nagad_number as string | null) ?? null };
}

/** Owners only (the database checks); `old` is what they were, for the email to every owner. Takes the service client. */
export async function setPaymentNumbers(
  db: SupabaseClient,
  input: { organizationId: string; userId: string; bkash: string | null; nagad: string | null },
): Promise<{ status: 'saved' | 'not_allowed' | 'invalid'; old: PaymentNumbers }> {
  const { data, error } = await db.rpc('set_payment_numbers', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_bkash: input.bkash,
    p_nagad: input.nagad,
  });
  if (error) throw error;
  const row = (data as Array<{ status: 'saved' | 'not_allowed' | 'invalid'; old_bkash: string | null; old_nagad: string | null }>)[0]!;
  return { status: row.status, old: { bkash: row.old_bkash, nagad: row.old_nagad } };
}
