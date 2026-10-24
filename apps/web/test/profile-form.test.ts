import { describe, expect, it } from 'vitest';
import { parseProfileForm } from '../lib/forms/profile';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b1';
const C = '00000000-0000-4000-8000-0000000000c1';
const D = '00000000-0000-4000-8000-0000000000d1';
// Section ids (the brand's turf and café).
const TURF = '00000000-0000-4000-8000-0000000000e1';
const CAFE = '00000000-0000-4000-8000-0000000000e2';
const SECTIONS = [TURF, CAFE];

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const item of [v].flat()) fd.append(k, item);
  return fd;
}

describe('parseProfileForm', () => {
  it('reads a full profile and normalises a Bangladeshi mobile number', () => {
    const result = parseProfileForm(
      form({
        displayName: '  Rafi ',
        phone: '01712345678',
        [`rating.${TURF}`]: '4',
        [`rating.${CAFE}`]: '2',
        favourites: [A, '', B],
        'avail.5.on': 'on',
        'avail.5.start': '18:00',
        'avail.5.end': '23:00',
        emailOptIn: 'on',
      }),
      SECTIONS,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        displayName: 'Rafi',
        phone: '+8801712345678',
        ratings: { [TURF]: 4, [CAFE]: 2 },
        favourites: [A, B],
        availability: [{ weekday: 5, start: '18:00', end: '23:00' }],
        emailOptIn: true,
      },
    });
  });

  it('keeps an international number and allows no phone', () => {
    const intl = parseProfileForm(form({ displayName: 'Mia', phone: '+447700900123' }), SECTIONS);
    expect(intl.ok && intl.value.phone).toBe('+447700900123');
    const none = parseProfileForm(form({ displayName: 'Mia', phone: '' }), SECTIONS);
    expect(none.ok && none.value.phone).toBeNull();
  });

  it('rejects a malformed phone', () => {
    const result = parseProfileForm(form({ displayName: 'Rafi', phone: '12345' }), SECTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveProperty('phone');
  });

  it('allows at most three favourites', () => {
    const result = parseProfileForm(form({ displayName: 'Rafi', favourites: [A, B, C, D] }), SECTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveProperty('favourites');
  });

  it('rejects the same favourite twice', () => {
    const result = parseProfileForm(form({ displayName: 'Rafi', favourites: [A, A] }), SECTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveProperty('favourites');
  });

  it('needs a name, and each rating given must be 1 to 5', () => {
    const result = parseProfileForm(form({ displayName: ' ', [`rating.${TURF}`]: '7' }), SECTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['displayName', `rating.${TURF}`]);
  });

  it("skips a section left as Not rated and ignores ids that are not this brand's sections", () => {
    const result = parseProfileForm(form({ displayName: 'Rafi', [`rating.${TURF}`]: '', [`rating.${CAFE}`]: '5', [`rating.${D}`]: '3' }), SECTIONS);
    expect(result.ok && result.value.ratings).toEqual({ [CAFE]: 5 });
  });
});
