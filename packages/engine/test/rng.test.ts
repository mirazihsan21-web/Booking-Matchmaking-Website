import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createRng', () => {
  it('replays the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it('differs across seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('next() is in [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('int() is inclusive at both ends', () => {
    const r = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(r.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('pick() returns an element of the list', () => {
    const items = ['a', 'b', 'c'] as const;
    const r = createRng(11);
    for (let i = 0; i < 100; i++) expect(items).toContain(r.pick(items));
  });

  it('shuffle() returns a permutation and leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5];
    const out = createRng(5).shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual(input);
    expect(createRng(5).shuffle(input)).toEqual(out);
  });

  it('uuid() is deterministic RFC 4122 v4', () => {
    expect(createRng(9).uuid()).toBe(createRng(9).uuid());
    expect(createRng(9).uuid()).toMatch(UUID_V4);
  });
});
