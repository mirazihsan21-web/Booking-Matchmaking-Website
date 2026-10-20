import { describe, expect, it } from 'vitest';
import { parseBookingSettingsForm } from '../lib/forms/booking-settings';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const valid = { horizonDays: '14', cancelCutoffHours: '2', matchCutoffHours: '6', maxUpcoming: '3' };

describe('parseBookingSettingsForm', () => {
  it('reads hours as minutes', () => {
    expect(parseBookingSettingsForm(form(valid))).toEqual({
      ok: true,
      value: { bookingHorizonDays: 14, cancelCutoffMinutes: 120, matchCutoffMinutes: 360, maxUpcomingBookings: 3 },
    });
  });

  it('allows cancelling right up to the start when matching is earlier', () => {
    const result = parseBookingSettingsForm(form({ ...valid, cancelCutoffHours: '0', matchCutoffHours: '1' }));
    expect(result.ok && result.value).toMatchObject({ cancelCutoffMinutes: 0, matchCutoffMinutes: 60 });
  });

  it('requires matching before the cancellation cut-off', () => {
    const result = parseBookingSettingsForm(form({ ...valid, cancelCutoffHours: '2', matchCutoffHours: '2' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['matchCutoffHours']);
  });

  it('caps the booking window at 90 days', () => {
    const result = parseBookingSettingsForm(form({ ...valid, horizonDays: '91' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['horizonDays']);
  });

  it('rejects text where a number belongs', () => {
    const result = parseBookingSettingsForm(form({ ...valid, maxUpcoming: 'abc' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['maxUpcoming']);
  });
});
