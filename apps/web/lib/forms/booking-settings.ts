import { z } from 'zod';
import { m } from '@/messages';
import { fieldErrors, text, type FormResult } from './result';

/** A venue's booking rules (organizations columns; spec §2.2). Cut-offs are stored in minutes. */
export interface BookingSettings {
  bookingHorizonDays: number;
  cancelCutoffMinutes: number;
  matchCutoffMinutes: number;
  maxUpcomingBookings: number;
}

const whole = (min: number, max: number, message: string) =>
  z.coerce.number({ error: m.forms.wholeNumber }).int(m.forms.wholeNumber).min(min, message).max(max, message);

const schema = z
  .object({
    horizonDays: whole(1, 90, m.forms.horizonRange),
    cancelCutoffHours: whole(0, 168, m.forms.cutoffRange),
    matchCutoffHours: whole(0, 168, m.forms.cutoffRange),
    maxUpcoming: whole(1, 20, m.forms.maxUpcomingRange),
  })
  .refine((v) => v.matchCutoffHours > v.cancelCutoffHours, { path: ['matchCutoffHours'], message: m.forms.matchAfterCancel });

/** Owners type the cut-offs in hours; they are stored in minutes. */
export function parseBookingSettingsForm(formData: FormData): FormResult<BookingSettings> {
  const fields = ['horizonDays', 'cancelCutoffHours', 'matchCutoffHours', 'maxUpcoming'] as const;
  const raw = Object.fromEntries(fields.map((f) => [f, text(formData, f)]));
  // Blank inputs are "not a number", not 0.
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === '' ? Number.NaN : v])));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const v = parsed.data;
  return {
    ok: true,
    value: {
      bookingHorizonDays: v.horizonDays,
      cancelCutoffMinutes: v.cancelCutoffHours * 60,
      matchCutoffMinutes: v.matchCutoffHours * 60,
      maxUpcomingBookings: v.maxUpcoming,
    },
  };
}
