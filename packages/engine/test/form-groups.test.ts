import { describe, expect, it } from 'vitest';
import { formGroups } from '../src/form-groups';
import type { EngineGame, EnginePlayer, EngineTable, MatchInput } from '../src/types';

const catan: EngineGame = { id: 'catan', minPlayers: 3, maxPlayers: 4 };
const azul: EngineGame = { id: 'azul', minPlayers: 2, maxPlayers: 4 };

/** Players in list order get requestedAt = their index. */
function players(specs: Array<[id: string, skill: number, favourites: string[], priority?: number]>): EnginePlayer[] {
  return specs.map(([id, skill, favourites, priority = 0], index) => ({ id, skill, favourites, priority, requestedAt: index }));
}

function table(id: string, capacity: number): EngineTable {
  return { id, capacity };
}

function input(p: EnginePlayer[], games: EngineGame[], tables: EngineTable[]): MatchInput {
  return { players: p, games, tables, seed: 1 };
}

describe('formGroups', () => {
  it('seats everyone when seats suffice', () => {
    const p = players([['p1', 3, ['catan']], ['p2', 3, ['catan']], ['p3', 3, ['catan']], ['p4', 3, ['catan']]]);
    const result = formGroups(input(p, [catan], [table('t1', 4)]));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.playerIds).toHaveLength(4);
    expect(result.waitlist).toEqual([]);
  });

  it('waitlists overflow in service order', () => {
    const p = players([
      ['p1', 3, ['catan'], 0],
      ['p2', 3, ['catan'], 5],
      ['p3', 3, ['catan'], 0],
      ['p4', 3, ['catan'], 0],
      ['p5', 3, ['catan'], 1],
      ['p6', 3, ['catan'], 0],
    ]);
    const result = formGroups(input(p, [catan], [table('t1', 4)]));
    expect(new Set(result.groups.flatMap((g) => g.playerIds))).toEqual(new Set(['p2', 'p5', 'p1', 'p3']));
    expect(result.waitlist).toEqual(['p4', 'p6']);
  });

  it('groups similar skills at the same table', () => {
    const skills = [1, 5, 1, 5, 2, 4, 2, 4];
    const p = players(skills.map((s, i) => [`p${i + 1}`, s, ['azul']] as [string, number, string[]]));
    const skillOf = new Map(p.map((x) => [x.id, x.skill]));
    const result = formGroups(input(p, [azul], [table('t1', 4), table('t2', 4)]));
    const perGroup = result.groups.map((g) => g.playerIds.map((id) => skillOf.get(id)).sort());
    expect(perGroup.sort()).toEqual([
      [1, 1, 2, 2],
      [4, 4, 5, 5],
    ]);
  });

  it('dissolves under-minimum groups and falls back to the next favourite', () => {
    const p = players([['p1', 3, ['catan', 'azul']], ['p2', 3, ['catan', 'azul']]]);
    const result = formGroups(input(p, [catan, azul], [table('t1', 4)]));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.gameId).toBe('azul');
    expect(result.waitlist).toEqual([]);
  });

  it('waitlists players whose only game cannot reach its minimum', () => {
    const p = players([['p1', 3, ['catan']], ['p2', 3, ['catan']]]);
    const result = formGroups(input(p, [catan], [table('t1', 4)]));
    expect(result.groups).toEqual([]);
    expect(result.waitlist).toEqual(['p1', 'p2']);
  });

  it('swaps players across games when it tightens skill spread', () => {
    // Greedy leaves azul {1,1,5} and catan {5,5,1}; swapping x and y costs 2 preference points but removes 8 spread.
    const p = players([
      ['a1', 1, ['azul', 'catan']],
      ['a2', 1, ['azul', 'catan']],
      ['x', 5, ['azul', 'catan']],
      ['c1', 5, ['catan', 'azul']],
      ['c2', 5, ['catan', 'azul']],
      ['y', 1, ['catan', 'azul']],
    ]);
    const skillOf = new Map(p.map((q) => [q.id, q.skill]));
    const result = formGroups(input(p, [catan, azul], [table('t1', 3), table('t2', 3)]));
    const perGroup = result.groups.map((g) => g.playerIds.map((id) => skillOf.get(id)).sort());
    expect(perGroup.sort()).toEqual([
      [1, 1, 1],
      [5, 5, 5],
    ]);
    expect(result.diagnostics.acceptedSwaps).toBe(1);
  });

  it('skips the swap search when iterations is 0', () => {
    const p = players([
      ['a1', 1, ['azul', 'catan']],
      ['a2', 1, ['azul', 'catan']],
      ['x', 5, ['azul', 'catan']],
      ['c1', 5, ['catan', 'azul']],
      ['c2', 5, ['catan', 'azul']],
      ['y', 1, ['catan', 'azul']],
    ]);
    const result = formGroups({ ...input(p, [catan, azul], [table('t1', 3), table('t2', 3)]), config: { iterations: 0 } });
    expect(result.diagnostics).toEqual({ iterations: 0, acceptedSwaps: 0 });
    expect(result.score.skillSpread).toBe(8);
  });

  // Review Focus 1 & 2
  it('handles no players', () => {
    expect(formGroups(input([], [catan], [table('t1', 4)]))).toMatchObject({ groups: [], waitlist: [] });
  });

  it('handles no tables', () => {
    const p = players([['p1', 3, ['azul']], ['p2', 3, ['azul']]]);
    expect(formGroups(input(p, [azul], []))).toMatchObject({ groups: [], waitlist: ['p1', 'p2'] });
  });

  it('ignores tables too small for every game', () => {
    const p = players([['p1', 3, ['catan']], ['p2', 3, ['catan']], ['p3', 3, ['catan']]]);
    expect(formGroups(input(p, [catan], [table('t1', 2), table('t2', 2)])).groups).toEqual([]);
  });

  it('ignores favourites that reference unknown games', () => {
    const p = players([['p1', 3, ['ghost']]]);
    expect(formGroups(input(p, [azul], [table('t1', 4)]))).toMatchObject({ groups: [], waitlist: ['p1'] });
  });
});
