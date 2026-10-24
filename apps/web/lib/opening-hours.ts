import { m } from '@/messages';

export const WEEKDAYS = ['0', '1', '2', '3', '4', '5', '6'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Keys "0"–"6" (0 = Sunday). [open, close] local times; close ≤ open means closing after midnight. null = closed. */
export type OpeningHours = Record<Weekday, [string, string] | null>;

/** Matches the database default for sections.opening_hours. */
export const DEFAULT_OPENING_HOURS: OpeningHours = {
  '0': ['10:00', '23:00'],
  '1': ['10:00', '23:00'],
  '2': ['10:00', '23:00'],
  '3': ['10:00', '23:00'],
  '4': ['10:00', '23:00'],
  '5': ['10:00', '23:00'],
  '6': ['10:00', '23:00'],
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Reads `hours.<d>.open`, `hours.<d>.close` and `hours.<d>.closed` (checkbox) for every weekday. */
export function parseOpeningHours(
  formData: FormData,
): { ok: true; value: OpeningHours } | { ok: false; errors: Record<string, string> } {
  const value = {} as OpeningHours;
  const errors: Record<string, string> = {};
  for (const d of WEEKDAYS) {
    if (formData.get(`hours.${d}.closed`) === 'on') {
      value[d] = null;
      continue;
    }
    const open = String(formData.get(`hours.${d}.open`) ?? '');
    const close = String(formData.get(`hours.${d}.close`) ?? '');
    if (!TIME.test(open) || !TIME.test(close)) errors[`hours.${d}`] = m.forms.timeFormat;
    else if (open === close) errors[`hours.${d}`] = m.forms.openEqualsClose;
    else value[d] = [open, close];
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}
