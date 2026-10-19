import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, canHost, groupCapacity, resolveConfig } from '../src/config';
import { scoreGroups } from '../src/score';
import type { MatchInput } from '../src/types';

const input: MatchInput = {
  players: [
    { id: 'p1', skill: 1, favourites: ['g1'], priority: 0, requestedAt: 0 },
    { id: 'p2', skill: 3, favourites: ['x', 'g1'], priority: 0, requestedAt: 1 },
  ],
  games: [{ id: 'g1', minPlayers: 2, maxPlayers: 4 }],
  tables: [{ id: 't1', capacity: 4 }],
  seed: 1,
};

describe('scoreGroups', () => {
  it('scores a group', () => {
    expect(scoreGroups([{ tableId: 't1', gameId: 'g1', playerIds: ['p1', 'p2'] }], input)).toEqual({
      preference: 5,
      skillSpread: 2,
      filledSeats: 2,
      underMin: 0,
      total: 7,
    });
  });

  it('penalises groups under the game minimum', () => {
    expect(scoreGroups([{ tableId: 't1', gameId: 'g1', playerIds: ['p1'] }], input).underMin).toBe(1);
  });

  it('applies configured weights', () => {
    const weighted = { ...input, config: { skillWeight: 2, fillWeight: 0 } };
    expect(scoreGroups([{ tableId: 't1', gameId: 'g1', playerIds: ['p1', 'p2'] }], weighted).total).toBe(1);
  });
});

describe('config', () => {
  it('caps capacity at the game maximum', () => {
    expect(groupCapacity({ id: 'g', minPlayers: 2, maxPlayers: 4 }, { id: 't', capacity: 6 })).toBe(4);
  });

  it('rejects tables too small for the game minimum', () => {
    expect(canHost({ id: 'g', minPlayers: 3, maxPlayers: 4 }, { id: 't', capacity: 2 })).toBe(false);
  });

  it('merges partial config over defaults', () => {
    expect(resolveConfig({ iterations: 0 })).toEqual({ ...DEFAULT_CONFIG, iterations: 0 });
  });

  it('uses the defaults when no config is given', () => {
    expect(resolveConfig()).toEqual({ preferenceWeights: [3, 2, 1], skillWeight: 1, fillWeight: 2, iterations: 2000 });
  });
});
