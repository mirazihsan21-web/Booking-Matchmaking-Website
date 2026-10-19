import { describe, expect, it } from 'vitest';
import { explainScore } from '../src/explain';
import type { MatchInput, MatchResult } from '../src/types';

const input: MatchInput = {
  players: [
    { id: 'p1', skill: 1, favourites: ['g1'], priority: 0, requestedAt: 0 },
    { id: 'p2', skill: 3, favourites: ['x', 'g1'], priority: 0, requestedAt: 1 },
    { id: 'p3', skill: 2, favourites: ['g1'], priority: 0, requestedAt: 2 },
  ],
  games: [{ id: 'g1', minPlayers: 2, maxPlayers: 4 }],
  tables: [{ id: 't1', capacity: 4 }],
  seed: 1,
};

const result: MatchResult = {
  groups: [{ tableId: 't1', gameId: 'g1', playerIds: ['p1', 'p2'] }],
  waitlist: ['p3'],
  score: { preference: 5, skillSpread: 2, filledSeats: 2, underMin: 0, total: 7 },
  diagnostics: { iterations: 0, acceptedSwaps: 0 },
};

describe('explainScore', () => {
  it('explains a seated player', () => {
    expect(explainScore(result, input, 'p2')).toEqual({
      playerId: 'p2',
      status: 'seated',
      tableId: 't1',
      gameId: 'g1',
      favouriteRank: 1,
      preferencePoints: 2,
      tableSkillRange: [1, 3],
      reason: 'Seated for your #2 pick with players of skill 1–3',
    });
  });

  it('explains a waitlisted player', () => {
    expect(explainScore(result, input, 'p3')).toEqual({
      playerId: 'p3',
      status: 'waitlisted',
      waitlistPosition: 1,
      reason: 'Waitlisted at position 1: every table running one of your games is full',
    });
  });

  it('throws for unknown players', () => {
    expect(() => explainScore(result, input, 'nope')).toThrow('Unknown player nope');
  });
});
