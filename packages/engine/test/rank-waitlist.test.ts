import { describe, expect, it } from 'vitest';
import { rankWaitlist, type WaitlistCandidate } from '../src/rank-waitlist';

function candidate(id: string, skill: number, priority = 0, requestedAt = 0, extra: Partial<WaitlistCandidate> = {}): WaitlistCandidate {
  return { id, skill, priority, requestedAt, favourites: ['catan'], available: true, ...extra };
}

describe('rankWaitlist', () => {
  it('drops unavailable candidates and those who do not want the game', () => {
    const ranked = rankWaitlist({ gameId: 'catan', tableSkills: [3] }, [
      candidate('busy', 3, 0, 0, { available: false }),
      candidate('azulOnly', 3, 0, 0, { favourites: ['azul'] }),
      candidate('keen', 3),
    ]);
    expect(ranked).toEqual(['keen']);
  });

  it('ranks skill fit above priority', () => {
    const ranked = rankWaitlist({ gameId: 'catan', tableSkills: [4, 4, 5] }, [candidate('c2', 1, 9), candidate('c1', 4, 0)]);
    expect(ranked).toEqual(['c1', 'c2']);
  });

  it('breaks fit ties by priority', () => {
    const ranked = rankWaitlist({ gameId: 'catan', tableSkills: [4, 4, 5] }, [candidate('c1', 4, 0), candidate('c2', 4, 2)]);
    expect(ranked).toEqual(['c2', 'c1']);
  });

  it('breaks remaining ties by requestedAt', () => {
    const ranked = rankWaitlist({ gameId: 'catan', tableSkills: [3] }, [candidate('late', 3, 0, 20), candidate('early', 3, 0, 10)]);
    expect(ranked).toEqual(['early', 'late']);
  });

  it('ranks by priority at an empty table', () => {
    const ranked = rankWaitlist({ gameId: 'catan', tableSkills: [] }, [candidate('low', 1, 0), candidate('high', 5, 3)]);
    expect(ranked).toEqual(['high', 'low']);
  });
});
