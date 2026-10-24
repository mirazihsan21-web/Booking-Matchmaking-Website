import { z } from 'zod';
import { m } from '@/messages';
import { parseOpeningHours, type OpeningHours } from '@/lib/opening-hours';
import { parseBookingSettingsForm, type BookingSettings } from './booking-settings';
import { fieldErrors, text, type FormResult } from './result';

export interface SectionForm extends BookingSettings {
  name: string;
  openingHours: OpeningHours;
}

const schema = z.object({ name: z.string().min(1, m.forms.required).max(80, m.forms.tooLong) });

/** A section's name, opening hours and booking rules. */
export function parseSectionForm(formData: FormData): FormResult<SectionForm> {
  const fields = schema.safeParse({ name: text(formData, 'name') });
  const hours = parseOpeningHours(formData);
  const rules = parseBookingSettingsForm(formData);
  const errors = {
    ...(fields.success ? {} : fieldErrors(fields.error)),
    ...(hours.ok ? {} : hours.errors),
    ...(rules.ok ? {} : rules.errors),
  };
  if (!fields.success || !hours.ok || !rules.ok) return { ok: false, errors };
  return { ok: true, value: { name: fields.data.name, openingHours: hours.value, ...rules.value } };
}
