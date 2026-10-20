import { describe, expect, it } from 'vitest';
import { renderNotification } from '../lib/notifications/render';

const zone = 'Asia/Dhaka';
const when = { resource_name: 'Pitch 1', starts_at: '2026-10-23T14:00:00Z', ends_at: '2026-10-23T15:00:00Z' };

describe('renderNotification', () => {
  it('confirms a booking with what to pay at the venue', () => {
    expect(renderNotification({ kind: 'booking_confirmed', payload: { ...when, price_poisha: 250000 } }, zone)).toEqual({
      title: 'Booking confirmed',
      body: 'Pitch 1, Fri 23 Oct, 8pm–9pm. Pay ৳2,500 at the venue.',
    });
  });

  it('leaves the price to the venue when the space has none', () => {
    expect(renderNotification({ kind: 'booking_confirmed', payload: { ...when, price_poisha: 0 } }, zone).body).toBe(
      'Pitch 1, Fri 23 Oct, 8pm–9pm. Pay at the venue.',
    );
  });

  it('says who cancelled', () => {
    expect(renderNotification({ kind: 'booking_cancelled', payload: { ...when, by_venue: true } }, zone)).toEqual({
      title: 'The venue cancelled your booking',
      body: 'Pitch 1, Fri 23 Oct, 8pm–9pm.',
    });
    expect(renderNotification({ kind: 'booking_cancelled', payload: { ...when, by_venue: false } }, zone).title).toBe('Booking cancelled');
  });

  it('shows open-play kinds generically until Stage B2', () => {
    expect(renderNotification({ kind: 'offer', payload: {} }, zone)).toEqual({ title: 'Update', body: '' });
  });
});
