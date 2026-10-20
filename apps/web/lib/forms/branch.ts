import { z } from 'zod';
import { m } from '@/messages';
import { parseOpeningHours, type OpeningHours } from '@/lib/opening-hours';
import { fieldErrors, text, type FormResult } from './result';

const schema = z.object({
  name: z.string().min(1, m.forms.required).max(80, m.forms.tooLong),
  address: z.string().max(200, m.forms.tooLong),
});

export function parseBranchForm(formData: FormData): FormResult<{ name: string; address: string; openingHours: OpeningHours }> {
  const fields = schema.safeParse({ name: text(formData, 'name'), address: text(formData, 'address') });
  const hours = parseOpeningHours(formData);
  const errors = { ...(fields.success ? {} : fieldErrors(fields.error)), ...(hours.ok ? {} : hours.errors) };
  if (!fields.success || !hours.ok) return { ok: false, errors };
  return { ok: true, value: { ...fields.data, openingHours: hours.value } };
}
