import { z } from 'zod';
import { m } from '@/messages';
import { normalizePhone } from './profile';
import { fieldErrors, text, type FormResult } from './result';

const schema = z.object({
  guestName: z.string().min(1, m.forms.required).max(60, m.forms.tooLong),
  guestPhone: z.string().min(1, m.forms.required).refine((p) => normalizePhone(p) !== null, m.profile.phoneFormat),
  slots: z.coerce.number({ error: m.forms.slotsRange }).int(m.forms.slotsRange).min(1, m.forms.slotsRange).max(4, m.forms.slotsRange),
});

/** A walk-in typed in by staff: name, phone (stored as +880…) and how many slots. */
export function parseWalkInForm(formData: FormData): FormResult<{ guestName: string; guestPhone: string; slots: number }> {
  const parsed = schema.safeParse({ guestName: text(formData, 'guestName'), guestPhone: text(formData, 'guestPhone'), slots: text(formData, 'slots') || '1' });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  return { ok: true, value: { guestName: parsed.data.guestName, guestPhone: normalizePhone(parsed.data.guestPhone)!, slots: parsed.data.slots } };
}
