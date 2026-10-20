import { describe, expect, it } from 'vitest';
import { parseWalkInForm } from '../lib/forms/walk-in';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('parseWalkInForm (Review Focus 4)', () => {
  it.each(['01712-345678', '+880 1712 345678', '01712345678'])('normalises %j', (guestPhone) => {
    expect(parseWalkInForm(form({ guestName: ' Karim ', guestPhone, slots: '1' }))).toEqual({
      ok: true,
      value: { guestName: 'Karim', guestPhone: '+8801712345678', slots: 1 },
    });
  });

  it('refuses a number that is not a phone', () => {
    const result = parseWalkInForm(form({ guestName: 'Karim', guestPhone: '12345', slots: '1' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['guestPhone']);
  });

  it('needs a name and a phone', () => {
    const result = parseWalkInForm(form({ guestName: '', guestPhone: '', slots: '1' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['guestName', 'guestPhone']);
  });

  it('books 1 to 4 slots', () => {
    expect(parseWalkInForm(form({ guestName: 'Karim', guestPhone: '01712345678', slots: '5' })).ok).toBe(false);
  });
});
