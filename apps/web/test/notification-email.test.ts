import { describe, expect, it } from 'vitest';
import { notificationEmail } from '../lib/email/notification-email';

const base = {
  kind: 'booking_confirmed' as const,
  payload: { resource_name: 'Pitch 1', starts_at: '2026-10-23T14:00:00Z', ends_at: '2026-10-23T15:00:00Z', price_poisha: 250000 },
  venueName: 'Dhanmondi Turf',
  primaryColour: '#15803D',
  siteUrl: 'http://localhost:3000',
  link: '/me/bookings',
  timeZone: 'Asia/Dhaka',
};

describe('notificationEmail', () => {
  it('names the venue and what happened in the subject', () => {
    expect(notificationEmail(base).subject).toBe('Dhanmondi Turf: Booking confirmed');
  });

  it('links to the page on the venue site, and to email settings', () => {
    const { html, text } = notificationEmail(base);
    expect(html).toContain('href="http://localhost:3000/me/bookings"');
    expect(text).toContain('http://localhost:3000/me/bookings');
    expect(text).toContain('http://localhost:3000/me');
    expect(text).toContain('Pitch 1, Fri 23 Oct, 8pm–9pm. Pay ৳2,500 at the venue.');
  });

  it('escapes venue data in the HTML', () => {
    const { html } = notificationEmail({ ...base, venueName: '<b>X</b>' });
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).not.toContain('<b>X</b>');
  });

  it('keeps the plain-text part free of HTML', () => {
    expect(notificationEmail(base).text).not.toMatch(/<[a-z]/i);
  });
});
