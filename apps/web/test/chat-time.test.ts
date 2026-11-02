import { describe, expect, it } from 'vitest';
import { cardWhen, chatTime } from '../lib/chat/time';

const zone = 'Asia/Dhaka';
// Fri 23 Oct 2026, 10pm in Dhaka.
const now = new Date('2026-10-23T16:00:00Z');

describe('chatTime', () => {
  it('says Today for a message sent today in Dhaka', () => {
    expect(chatTime('2026-10-23T14:14:00Z', zone, now)).toBe('Today, 8:14pm');
  });

  it('says Yesterday for one sent before midnight in Dhaka (even though it was the same day in UTC)', () => {
    expect(chatTime('2026-10-22T17:59:00Z', zone, now)).toBe('Yesterday, 11:59pm');
  });

  it('gives the date for anything older', () => {
    expect(chatTime('2026-10-21T03:00:00Z', zone, now)).toBe('Wed 21 Oct, 9am');
  });
});

describe('cardWhen', () => {
  it('shows the game in Dhaka time, whatever the server or browser zone', () => {
    expect(cardWhen({ startsAt: '2026-10-23T14:00:00Z', endsAt: '2026-10-23T15:00:00Z' }, zone)).toBe('Fri 23 Oct, 8pm–9pm');
  });
});
