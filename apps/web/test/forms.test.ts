import { describe, expect, it } from 'vitest';
import { parseActivityForm } from '../lib/forms/activity';
import { parseResourceForm } from '../lib/forms/resource';
import { parseSectionForm } from '../lib/forms/section';
import { DEFAULT_OPENING_HOURS, parseOpeningHours } from '../lib/opening-hours';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const allDays = (open: string, close: string) =>
  Object.fromEntries([0, 1, 2, 3, 4, 5, 6].flatMap((d) => [[`hours.${d}.open`, open], [`hours.${d}.close`, close]]));

describe('parseOpeningHours', () => {
  it('reads every weekday', () => {
    expect(parseOpeningHours(form(allDays('10:00', '23:00')))).toEqual({ ok: true, value: DEFAULT_OPENING_HOURS });
  });

  it('accepts overnight hours (closing after midnight)', () => {
    const result = parseOpeningHours(form(allDays('23:00', '02:00')));
    expect(result.ok && result.value['5']).toEqual(['23:00', '02:00']);
  });

  it('marks a day closed', () => {
    const result = parseOpeningHours(form({ ...allDays('10:00', '23:00'), 'hours.1.closed': 'on' }));
    expect(result.ok && result.value['1']).toBeNull();
  });

  it('rejects bad times and equal open/close', () => {
    const result = parseOpeningHours(form({ ...allDays('10:00', '23:00'), 'hours.2.open': '25:00', 'hours.3.close': '10:00' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['hours.2', 'hours.3']);
  });
});

describe('parseSectionForm', () => {
  const rules = { horizonDays: '3', cancelCutoffHours: '1', matchCutoffHours: '4', maxUpcoming: '2' };

  it('reads the name, hours and booking rules (cut-offs typed in hours, kept in minutes)', () => {
    expect(parseSectionForm(form({ name: 'Board-game café', ...allDays('10:00', '23:00'), ...rules }))).toEqual({
      ok: true,
      value: {
        name: 'Board-game café',
        openingHours: DEFAULT_OPENING_HOURS,
        bookingHorizonDays: 3,
        cancelCutoffMinutes: 60,
        matchCutoffMinutes: 240,
        maxUpcomingBookings: 2,
      },
    });
  });

  it('reports a missing name and bad rules together', () => {
    const result = parseSectionForm(form({ name: ' ', ...allDays('10:00', '23:00'), ...rules, horizonDays: '0' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['horizonDays', 'name']);
  });
});

describe('parseResourceForm', () => {
  it('reads price in taka', () => {
    expect(parseResourceForm(form({ name: 'Pitch 3', kind: 'pitch', capacity: '14', price: '2,500', slotMinutes: '60' }))).toEqual({
      ok: true,
      value: { name: 'Pitch 3', kind: 'pitch', capacity: 14, pricePerHourPoisha: 250000, slotMinutes: 60 },
    });
  });

  it('treats an empty price as no price', () => {
    const result = parseResourceForm(form({ name: 'Table 9', kind: 'table', capacity: '4', price: '', slotMinutes: '120' }));
    expect(result.ok && result.value.pricePerHourPoisha).toBeNull();
  });

  it('rejects capacity 31 and unknown kinds', () => {
    const result = parseResourceForm(form({ name: 'Huge', kind: 'stadium', capacity: '31', price: '', slotMinutes: '60' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['capacity', 'kind']);
  });

  it.each([
    ['90', true],
    ['15', true],
    ['240', true],
    ['50', false],
    ['255', false],
    ['0', false],
    ['', false],
  ])('slot length %j minutes → ok %s', (slotMinutes, ok) => {
    const result = parseResourceForm(form({ name: 'Pitch 3', kind: 'pitch', capacity: '14', price: '', slotMinutes }));
    expect(result.ok).toBe(ok);
    if (result.ok) expect(result.value.slotMinutes).toBe(Number(slotMinutes));
    else expect(Object.keys(result.errors)).toEqual(['slotMinutes']);
  });
});

describe('parseActivityForm', () => {
  it('derives min and max from the team size', () => {
    expect(parseActivityForm(form({ name: '5-a-side', teamMode: 'two_teams', teamSize: '5', durationMin: '60' }))).toEqual({
      ok: true,
      value: { name: '5-a-side', teamMode: 'two_teams', teamSize: 5, minPlayers: 10, maxPlayers: 10, durationMin: 60 },
    });
  });

  it('needs a team size for two teams', () => {
    const result = parseActivityForm(form({ name: '5-a-side', teamMode: 'two_teams', teamSize: '', durationMin: '60' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveProperty('teamSize');
  });

  it('needs min ≤ max without teams', () => {
    const result = parseActivityForm(form({ name: 'Catan', teamMode: 'none', minPlayers: '5', maxPlayers: '4', durationMin: '90' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveProperty('maxPlayers');
  });

  it('reads a free-for-all activity', () => {
    expect(parseActivityForm(form({ name: 'Catan', teamMode: 'none', minPlayers: '3', maxPlayers: '4', durationMin: '90' }))).toEqual({
      ok: true,
      value: { name: 'Catan', teamMode: 'none', teamSize: null, minPlayers: 3, maxPlayers: 4, durationMin: 90 },
    });
  });
});
