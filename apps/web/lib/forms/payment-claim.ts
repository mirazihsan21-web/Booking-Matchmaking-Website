import { m } from '@/messages';
import { text, type FormResult } from './result';

export type PaymentMethod = 'bkash' | 'nagad';

const PHONE = /^01[3-9][0-9]{8}$/;
const TRX = /^[A-Z0-9]{6,20}$/;

/** A transaction ID as the database keeps it: no spaces, upper case ("9jk7 abc123" → "9JK7ABC123"). */
export const normaliseTrxId = (raw: string) => raw.replace(/\s/g, '').toUpperCase();

/**
 * The pay page's form: bKash or Nagad, the 11-digit number the money was sent from, and the transaction ID
 * (6–20 letters and numbers once tidied). One message per field that's wrong.
 */
export function parsePaymentClaimForm(formData: FormData): FormResult<{ method: PaymentMethod; senderPhone: string; trxId: string }> {
  const method = text(formData, 'method');
  const senderPhone = text(formData, 'senderPhone').replace(/\s/g, '');
  const trxId = normaliseTrxId(text(formData, 'trxId'));
  const errors: Record<string, string> = {};
  if (method !== 'bkash' && method !== 'nagad') errors.method = m.payments.errors.method;
  if (!PHONE.test(senderPhone)) errors.senderPhone = m.payments.errors.senderPhone;
  if (!TRX.test(trxId)) errors.trxId = m.payments.errors.trxId;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { method: method as PaymentMethod, senderPhone, trxId } };
}
