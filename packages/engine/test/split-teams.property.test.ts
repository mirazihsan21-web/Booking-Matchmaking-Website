import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { splitTeams } from '../src/split-teams';

type P = { id: string; skill: number };

const arbSquad = (minSize: number, maxSize: number) =>
  fc
    .integer({ min: minSize, max: maxSize })
    .chain((teamSize) =>
      fc
        .array(fc.integer({ min: 1, max: 5 }), { minLength: 2 * teamSize, maxLength: 2 * teamSize })
        .map((skills) => ({ teamSize, players: skills.map((skill, i): P => ({ id: `p${i}`, skill })) })),
    );

const sum = (ids: string[], players: P[]) => ids.reduce((s, id) => s + players.find((p) => p.id === id)!.skill, 0);

function bruteForceGap(players: P[], teamSize: number): number {
  const total = players.reduce((s, p) => s + p.skill, 0);
  let best = Infinity;
  const n = players.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    let bits = 0;
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        bits++;
        s += players[i]!.skill;
      }
    }
    if (bits === teamSize) best = Math.min(best, Math.abs(total - 2 * s));
  }
  return best;
}

function greedyGap(players: P[], teamSize: number): number {
  const order = [...players].sort((a, b) => b.skill - a.skill || (a.id < b.id ? -1 : 1));
  const totals = [0, 0];
  const sizes = [0, 0];
  for (const p of order) {
    const t = sizes[0]! < teamSize && (totals[0]! <= totals[1]! || sizes[1]! >= teamSize) ? 0 : 1;
    totals[t]! += p.skill;
    sizes[t]!++;
  }
  return Math.abs(totals[0]! - totals[1]!);
}

describe('splitTeams invariants', () => {
  it('places every player exactly once in two teams of teamSize', () => {
    fc.assert(
      fc.property(arbSquad(1, 7), ({ players, teamSize }) => {
        const { teams } = splitTeams(players, teamSize);
        expect(teams[0]).toHaveLength(teamSize);
        expect(teams[1]).toHaveLength(teamSize);
        expect(new Set([...teams[0], ...teams[1]])).toEqual(new Set(players.map((p) => p.id)));
      }),
      { numRuns: 300 },
    );
  });

  it('reports the true skill gap', () => {
    fc.assert(
      fc.property(arbSquad(1, 7), ({ players, teamSize }) => {
        const { teams, skillGap } = splitTeams(players, teamSize);
        expect(skillGap).toBe(Math.abs(sum(teams[0], players) - sum(teams[1], players)));
      }),
      { numRuns: 300 },
    );
  });

  it('is optimal for 12 players or fewer', () => {
    fc.assert(
      fc.property(arbSquad(1, 6), ({ players, teamSize }) => {
        expect(splitTeams(players, teamSize).skillGap).toBe(bruteForceGap(players, teamSize));
      }),
      { numRuns: 300 },
    );
  });

  it('is never worse than plain greedy for 14 players', () => {
    fc.assert(
      fc.property(arbSquad(7, 7), ({ players, teamSize }) => {
        expect(splitTeams(players, teamSize).skillGap).toBeLessThanOrEqual(greedyGap(players, teamSize));
      }),
      { numRuns: 300 },
    );
  });
});
