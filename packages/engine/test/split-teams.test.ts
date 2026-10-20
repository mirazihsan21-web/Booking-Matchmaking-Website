import { describe, expect, it } from 'vitest';
import { splitTeams } from '../src/split-teams';

const squad = (skills: number[]) => skills.map((skill, i) => ({ id: `p${i}`, skill }));

describe('splitTeams', () => {
  it('finds a perfectly balanced split when one exists', () => {
    expect(splitTeams(squad([5, 4, 3, 3, 2, 1]), 3).skillGap).toBe(0);
  });

  it('reports the unavoidable gap for one-versus-one', () => {
    expect(splitTeams(squad([5, 1]), 1)).toEqual({ teams: [['p0'], ['p1']], skillGap: 4 });
  });

  it('balances ten equal players', () => {
    const result = splitTeams(squad(Array(10).fill(3)), 5);
    expect(result.skillGap).toBe(0);
    expect(result.teams[0]).toHaveLength(5);
    expect(result.teams[1]).toHaveLength(5);
  });

  it('rejects the wrong number of players', () => {
    expect(() => splitTeams(squad([3, 3, 3]), 2)).toThrow(RangeError);
    expect(() => splitTeams(squad([3, 3, 3]), 2)).toThrow('splitTeams needs exactly 2 × teamSize players');
  });

  it('is deterministic', () => {
    const players = squad([5, 2, 4, 4, 1, 3, 2, 5]);
    expect(splitTeams(players, 4)).toEqual(splitTeams(structuredClone(players), 4));
  });

  it('returns each team sorted by id', () => {
    const { teams } = splitTeams(squad([1, 5, 2, 4]), 2);
    for (const team of teams) expect([...team].sort()).toEqual(team);
  });
});
