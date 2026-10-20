import { describe, expect, it } from 'vitest';
import { formatDay, formatNight, formatShortTime } from '../lib/format';

describe('time formatting (Asia/Dhaka)', () => {
  it('formats a night', () => expect(formatNight('2026-10-24T14:00:00Z', 'Asia/Dhaka')).toBe('Sat 24 Oct, 8pm'));
  it('keeps minutes when present', () => expect(formatShortTime('2026-10-24T14:30:00Z', 'Asia/Dhaka')).toBe('8:30pm'));
  it('formats mornings', () => expect(formatShortTime('2026-10-24T04:00:00Z', 'Asia/Dhaka')).toBe('10am'));
  it('formats a calendar day (no time zone shift)', () => expect(formatDay('2026-10-23')).toBe('Fri 23 Oct'));
});
