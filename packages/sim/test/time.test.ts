import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '../src/time';

describe('zonedTimeToUtc', () => {
  it('converts BST wall time', () => {
    expect(zonedTimeToUtc('2026-07-11', '14:00', 'Europe/London').toISOString()).toBe('2026-07-11T13:00:00.000Z');
  });

  it('converts GMT wall time', () => {
    expect(zonedTimeToUtc('2026-01-10', '14:00', 'Europe/London').toISOString()).toBe('2026-01-10T14:00:00.000Z');
  });

  it('handles the spring-forward day', () => {
    expect(zonedTimeToUtc('2026-03-29', '19:00', 'Europe/London').toISOString()).toBe('2026-03-29T18:00:00.000Z');
  });

  it('handles the autumn-back day', () => {
    expect(zonedTimeToUtc('2026-10-25', '19:00', 'Europe/London').toISOString()).toBe('2026-10-25T19:00:00.000Z');
  });

  it('handles zones east of UTC', () => {
    expect(zonedTimeToUtc('2026-07-11', '19:00', 'Asia/Dhaka').toISOString()).toBe('2026-07-11T13:00:00.000Z');
  });
});
