import { z } from 'zod';
import { m } from '@/messages';
import { parseOpeningHours, type OpeningHours } from '@/lib/opening-hours';
import { parseBookingSettingsForm, type BookingSettings } from './booking-settings';
import { fieldErrors, text, type FormResult } from './result';

export interface SectionForm extends BookingSettings {
  name: string;
  openingHours: OpeningHours;
  /** How long a seat offer waits for an answer. Typed in minutes. */
  offerTtlSeconds: number;
}

const schema = z.object({
  name: z.string().min(1, m.forms.required).max(80, m.forms.tooLong),
  offerMinutes: z.coerce.number({ error: m.forms.offerRange }).int(m.forms.offerRange).min(1, m.forms.offerRange).max(120, m.forms.offerRange),
});

/** A section's name, opening hours, booking rules and seat-offer time. */
export function parseSectionForm(formData: FormData): FormResult<SectionForm> {
  const offer = text(formData, 'offerMinutes');
  // A blank box is "not a number", not 0.
  const fields = schema.safeParse({ name: text(formData, 'name'), offerMinutes: offer === '' ? Number.NaN : offer });
  const hours = parseOpeningHours(formData);
  const rules = parseBookingSettingsForm(formData);
  const errors = {
    ...(fields.success ? {} : fieldErrors(fields.error)),
    ...(hours.ok ? {} : hours.errors),
    ...(rules.ok ? {} : rules.errors),
  };
  if (!fields.success || !hours.ok || !rules.ok) return { ok: false, errors };
  return { ok: true, value: { name: fields.data.name, openingHours: hours.value, ...rules.value, offerTtlSeconds: fields.data.offerMinutes * 60 } };
}
