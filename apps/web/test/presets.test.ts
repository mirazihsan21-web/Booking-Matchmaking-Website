import { canHost } from '@bm/engine';
import { describe, expect, it } from 'vitest';
import { PRESETS, getPreset } from '../presets';

const types = ['boardgame_cafe', 'turf', 'gaming_lounge'] as const;

describe('business-type presets', () => {
  it('has a preset for every business type', () => {
    expect(Object.keys(PRESETS).sort()).toEqual([...types].sort());
    for (const t of types) expect(getPreset(t).businessType).toBe(t);
  });

  it('rejects unknown business types', () => {
    expect(() => getPreset('nope')).toThrow('Unknown business type nope');
  });

  it.each(types)('%s activities obey the database team rule', (t) => {
    for (const a of getPreset(t).activities) {
      if (a.teamMode === 'two_teams') {
        expect(a.teamSize).not.toBeNull();
        expect(a.minPlayers).toBe(2 * a.teamSize!);
        expect(a.maxPlayers).toBe(2 * a.teamSize!);
      } else {
        expect(a.teamSize).toBeNull();
        expect(a.minPlayers).toBeLessThanOrEqual(a.maxPlayers);
      }
    }
  });

  it.each(types)('%s resources book in 120-minute slots for tables and 60 otherwise', (t) => {
    for (const r of getPreset(t).resources) expect(r.slotMinutes).toBe(r.kind === 'table' ? 120 : 60);
  });

  it.each(types)('%s activities each fit at least one preset resource', (t) => {
    const preset = getPreset(t);
    for (const a of preset.activities) {
      const game = { id: a.name, minPlayers: a.minPlayers, maxPlayers: a.maxPlayers };
      expect(preset.resources.some((r) => canHost(game, { id: r.name, capacity: r.capacity }))).toBe(true);
    }
  });

  it.each(types)('%s names are unique', (t) => {
    const { resources, activities } = getPreset(t);
    expect(new Set(resources.map((r) => r.name)).size).toBe(resources.length);
    expect(new Set(activities.map((a) => a.name)).size).toBe(activities.length);
  });

  it('prices a turf the way the spec says', () => {
    const turf = getPreset('turf');
    expect(turf.resources.find((r) => r.name === 'Pitch 1')).toEqual({ name: 'Pitch 1', kind: 'pitch', capacity: 14, pricePerHourPoisha: 250000, slotMinutes: 60 });
    expect(turf.activities.find((a) => a.name === '5-a-side futsal')).toMatchObject({ teamMode: 'two_teams', teamSize: 5, minPlayers: 10, maxPlayers: 10 });
    expect(turf.seatPricePoisha).toBe(30000);
  });
});
