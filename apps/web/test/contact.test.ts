import { describe, expect, it } from 'vitest';
import { contactEmail } from '../lib/site/contact';

describe('contactEmail', () => {
  it('is the address the site sends email from (EMAIL_FROM, with or without a name)', () => {
    expect(contactEmail('Chattoturf <venue@gmail.com>')).toBe('venue@gmail.com');
    expect(contactEmail('venue@gmail.com')).toBe('venue@gmail.com');
    expect(contactEmail('  Chattoturf <Venue@Gmail.com>  ')).toBe('Venue@Gmail.com');
    expect(contactEmail('Booking & Matchmaking <bookings@localhost>')).toBe('bookings@localhost');
  });

  it('is null when there is no usable address', () => {
    expect(contactEmail(undefined)).toBeNull();
    expect(contactEmail('')).toBeNull();
    expect(contactEmail('Chattoturf <not an address>')).toBeNull();
    expect(contactEmail('Chattoturf')).toBeNull();
  });
});
