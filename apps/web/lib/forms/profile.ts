import { z } from 'zod';
import { m } from '@/messages';
import { WEEKDAYS } from '@/lib/opening-hours';
import type { ProfileInput } from '@/lib/profiles/save-profile';
import { fieldErrors, text, type FormResult } from './result';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const E164 = /^\+[1-9][0-9]{6,14}$/;
const BD_MOBILE = /^01[3-9]\d{8}$/;

/** Bangladeshi mobiles may be typed locally (01XXXXXXXXX); everything else must be E.164 (+…). */
export function normalizePhone(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '');
  if (BD_MOBILE.test(compact)) return `+88${compact}`;
  return E164.test(compact) ? compact : null;
}

const schema = z.object({
  displayName: z.string().min(1, m.forms.required).max(60, m.forms.tooLong),
  phone: z.string().refine((p) => p === '' || normalizePhone(p) !== null, m.profile.phoneFormat),
  favourites: z
    .array(z.uuid())
    .max(3, m.profile.tooManyFavourites)
    .refine((ids) => new Set(ids).size === ids.length, m.profile.duplicateFavourite),
});

const RATING = /^[1-5]$/;

/** `sectionIds` are the brand's sections; each may be rated 1–5 (`rating.<id>`) or left "Not rated" (''). */
export function parseProfileForm(formData: FormData, sectionIds: string[]): FormResult<ProfileInput> {
  const parsed = schema.safeParse({
    displayName: text(formData, 'displayName'),
    phone: text(formData, 'phone'),
    favourites: formData.getAll('favourites').map(String).filter(Boolean),
  });
  const errors: Record<string, string> = parsed.success ? {} : fieldErrors(parsed.error);

  const ratings: ProfileInput['ratings'] = {};
  for (const id of sectionIds) {
    const value = text(formData, `rating.${id}`);
    if (value === '') continue;
    if (RATING.test(value)) ratings[id] = Number(value);
    else errors[`rating.${id}`] = m.profile.pickSkill;
  }

  const availability: ProfileInput['availability'] = [];
  for (const d of WEEKDAYS) {
    if (formData.get(`avail.${d}.on`) !== 'on') continue;
    const start = text(formData, `avail.${d}.start`);
    const end = text(formData, `avail.${d}.end`);
    if (!TIME.test(start) || !TIME.test(end) || start >= end) errors[`avail.${d}`] = m.profile.availabilityRange;
    else availability.push({ weekday: Number(d), start, end });
  }

  if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };
  const { displayName, phone, favourites } = parsed.data;
  return {
    ok: true,
    value: { displayName, phone: phone === '' ? null : normalizePhone(phone), ratings, favourites, availability, emailOptIn: formData.get('emailOptIn') === 'on' },
  };
}
