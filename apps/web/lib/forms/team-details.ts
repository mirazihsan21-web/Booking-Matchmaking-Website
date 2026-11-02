import { z } from 'zod';
import { m } from '@/messages';
import { normalizePhone } from './profile';
import { fieldErrors, text, type FormResult } from './result';

export interface TeamDetailsInput {
  displayName: string;
  /** +E.164, or null for none. */
  phone: string | null;
}

const schema = z.object({
  displayName: z.string().min(1, m.forms.required).max(60, m.forms.tooLong),
  phone: z.string().refine((p) => p === '' || normalizePhone(p) !== null, m.profile.phoneFormat),
});

/** My account's form: the team member's own name (1–60) and optional mobile, in the players' phone format. */
export function parseTeamDetailsForm(formData: FormData): FormResult<TeamDetailsInput> {
  const parsed = schema.safeParse({ displayName: text(formData, 'displayName'), phone: text(formData, 'phone') });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const { displayName, phone } = parsed.data;
  return { ok: true, value: { displayName, phone: phone === '' ? null : normalizePhone(phone) } };
}
