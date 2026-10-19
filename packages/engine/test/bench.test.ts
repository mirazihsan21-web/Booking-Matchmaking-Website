import { describe, expect, it } from 'vitest';
import { formGroups } from '../src/form-groups';
import { createRng } from '../src/rng';
import type { MatchInput } from '../src/types';

function bigSession(): MatchInput {
  const rng = createRng(1);
  const gameIds = Array.from({ length: 10 }, (_, i) => `g${i}`);
  return {
    games: gameIds.map((id) => ({ id, minPlayers: 2, maxPlayers: 6 })),
    tables: Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, capacity: rng.int(4, 6) })),
    players: Array.from({ length: 500 }, (_, i) => ({
      id: `p${i}`,
      skill: rng.int(1, 5),
      favourites: rng.shuffle(gameIds).slice(0, rng.int(1, 3)),
      priority: 0,
      requestedAt: i,
    })),
    seed: 1,
  };
}

describe('formGroups latency', () => {
  it('matches 500 players in under 100ms', () => {
    const input = bigSession();
    formGroups(input); // warm-up
    const timings = Array.from({ length: 5 }, () => {
      const start = performance.now();
      formGroups(input);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    const median = timings[2]!;
    console.log(`formGroups 500 players median: ${median.toFixed(2)}ms`);
    expect(median).toBeLessThan(100);
  });
});
