import { splitTeams } from '@bm/engine';
import { describe, expect, it } from 'vitest';
import { planMatch, seedFromId, type MatchActivity, type MatchPlan, type MatchRequest } from '../lib/open-play/match';

const fiveASide: MatchActivity = { id: 'futsal', minPlayers: 10, maxPlayers: 10, teamMode: 'two_teams', teamSize: 5 };
const catan: MatchActivity = { id: 'catan', minPlayers: 3, maxPlayers: 4, teamMode: 'none', teamSize: null };
const azul: MatchActivity = { id: 'azul', minPlayers: 2, maxPlayers: 4, teamMode: 'none', teamSize: null };
const pitches = [
  { id: 'pitch-1', capacity: 14 },
  { id: 'pitch-2', capacity: 14 },
];

const request = (n: number, skill: number, favourites: string[] = []): MatchRequest => ({
  profileId: `p${String(n).padStart(2, '0')}`,
  skill,
  favourites,
  priority: 0,
  requestedAt: 1_000 + n,
});
const requests = (count: number, skills = [1, 2, 3, 4, 5]) =>
  Array.from({ length: count }, (_, i) => request(i + 1, skills[i % skills.length]));
const futsal = (reqs: MatchRequest[], resources = pitches) =>
  planMatch({ sessionId: 'session-1', fixedActivityId: 'futsal', activities: [fiveASide], resources, requests: reqs });
const everyone = (plan: MatchPlan) => [...plan.groups.flatMap((g) => g.seats.map((s) => s.profileId)), ...plan.waitlist];

describe('planMatch', () => {
  it('seats ten of twelve as two balanced teams of five and waitlists two', () => {
    const reqs = requests(12, [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 3, 3]);
    const plan = futsal(reqs);

    expect(plan.groups).toHaveLength(1);
    const [group] = plan.groups;
    expect(group.activityId).toBe('futsal');
    expect(group.capacity).toBe(10);
    expect(group.seats.map((s) => s.seatNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(group.seats.filter((s) => s.team === 1).map((s) => s.seatNo)).toEqual([1, 2, 3, 4, 5]);
    expect(group.seats.filter((s) => s.team === 2).map((s) => s.seatNo)).toEqual([6, 7, 8, 9, 10]);

    const skill = new Map(reqs.map((r) => [r.profileId, r.skill]));
    const total = (team: 1 | 2) => group.seats.filter((s) => s.team === team).reduce((sum, s) => sum + skill.get(s.profileId)!, 0);
    const optimum = splitTeams(group.seats.map((s) => ({ id: s.profileId, skill: skill.get(s.profileId)! })), 5).skillGap;
    expect(Math.abs(total(1) - total(2))).toBe(optimum);

    expect(plan.waitlist).toHaveLength(2);
    expect(everyone(plan).sort()).toEqual(reqs.map((r) => r.profileId).sort());
  });

  it('fills both pitches when twenty ask', () => {
    const plan = futsal(requests(20));
    expect(plan.groups.map((g) => g.resourceId).sort()).toEqual(['pitch-1', 'pitch-2']);
    expect(plan.groups.every((g) => g.seats.length === 10)).toBe(true);
    expect(plan.waitlist).toEqual([]);
  });

  it('forms no group from seven requests and waitlists them all', () => {
    const plan = futsal(requests(7));
    expect(plan.groups).toEqual([]);
    expect(plan.waitlist).toHaveLength(7);
  });

  it('forms no group on a pitch too small for two teams', () => {
    expect(futsal(requests(10), [{ id: 'small', capacity: 8 }]).groups).toEqual([]);
  });

  it('seats café players only at games they picked, and anyone without favourites anywhere', () => {
    const reqs = [
      ...[1, 2, 3, 4].map((n) => request(n, 3, ['catan'])),
      ...[5, 6, 7].map((n) => request(n, 3, ['azul'])),
      request(8, 3, []),
    ];
    const plan = planMatch({
      sessionId: 'cafe-night',
      fixedActivityId: null,
      activities: [catan, azul],
      resources: [
        { id: 'table-1', capacity: 4 },
        { id: 'table-2', capacity: 4 },
      ],
      requests: reqs,
    });

    const favourites = new Map(reqs.map((r) => [r.profileId, r.favourites]));
    for (const group of plan.groups) {
      expect(group.capacity).toBe(4);
      for (const seat of group.seats) {
        expect(seat.team).toBeNull();
        const picked = favourites.get(seat.profileId)!;
        expect(picked.length === 0 || picked.includes(group.activityId)).toBe(true);
      }
    }
    expect(plan.groups.flatMap((g) => g.seats.map((s) => s.profileId))).toContain('p08');
    expect(everyone(plan).sort()).toEqual(reqs.map((r) => r.profileId).sort());
  });

  it('gives the same plan for the same session every time', () => {
    const reqs = requests(13, [5, 1, 4, 2, 3]);
    expect(futsal(reqs)).toEqual(futsal(reqs));
  });
});

describe('seedFromId', () => {
  it('is stable per id and differs between ids', () => {
    expect(seedFromId('a')).toBe(seedFromId('a'));
    expect(seedFromId('a')).not.toBe(seedFromId('b'));
    expect(Number.isInteger(seedFromId('session-1'))).toBe(true);
  });
});
