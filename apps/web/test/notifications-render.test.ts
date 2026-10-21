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

  it('names the branch when the venue has more than one', () => {
    expect(renderNotification({ kind: 'booking_confirmed', payload: { ...when, branch_name: 'Gulshan', multi_branch: true, price_poisha: 0 } }, zone).body).toBe(
      'Pitch 1 (Gulshan), Fri 23 Oct, 8pm–9pm. Pay at the venue.',
    );
    expect(renderNotification({ kind: 'booking_cancelled', payload: { ...when, branch_name: 'Main', multi_branch: false } }, zone).body).toBe('Pitch 1, Fri 23 Oct, 8pm–9pm.');
  });

  it('says who cancelled', () => {
    expect(renderNotification({ kind: 'booking_cancelled', payload: { ...when, by_venue: true } }, zone)).toEqual({
      title: 'The venue cancelled your booking',
      body: 'Pitch 1, Fri 23 Oct, 8pm–9pm.',
    });
    expect(renderNotification({ kind: 'booking_cancelled', payload: { ...when, by_venue: false } }, zone).title).toBe('Booking cancelled');
  });

});

describe('renderNotification for open play', () => {
  const session = { activity_name: '5-a-side futsal', resource_name: 'Pitch 1', starts_at: '2026-10-23T14:00:00Z', ends_at: '2026-10-23T15:00:00Z' };
  const render = (kind: Parameters<typeof renderNotification>[0]['kind'], payload: Record<string, unknown>) => renderNotification({ kind, payload }, zone);

  it('confirms a seat with the space, team and price', () => {
    expect(render('seat_confirmed', { ...session, team: 1, price_poisha: 30000 })).toEqual({
      title: "You're in!",
      body: '5-a-side futsal, Fri 23 Oct, 8pm–9pm. Pitch 1, Team 1. Pay ৳300 at the venue.',
    });
    expect(render('seat_confirmed', { ...session, team: null, price_poisha: 30000 }).body).toBe('5-a-side futsal, Fri 23 Oct, 8pm–9pm. Pitch 1. Pay ৳300 at the venue.');
    expect(render('seat_confirmed', { ...session, team: 2, branch_name: 'Gulshan', multi_branch: true, price_poisha: 0 }).body).toBe(
      '5-a-side futsal, Fri 23 Oct, 8pm–9pm. Pitch 1 (Gulshan), Team 2. Pay at the venue.',
    );
  });

  it('tells a waitlisted player their place', () => {
    expect(render('waitlisted', { ...session, position: 2 })).toEqual({
      title: "You're on the waitlist",
      body: "5-a-side futsal, Fri 23 Oct, 8pm. You're #2 — we'll offer you a seat if one opens.",
    });
  });

  it('offers a free seat with when the offer ends', () => {
    expect(render('offer', { ...session, team: 2, expires_at: '2026-10-23T13:15:00Z' })).toEqual({
      title: 'A seat is free — want it?',
      body: '5-a-side futsal, Fri 23 Oct, 8pm–9pm. Pitch 1, Team 2. The offer ends at 7:15pm.',
    });
  });

  it('says an offer expired', () => {
    expect(render('offer_expired', session)).toEqual({
      title: 'Your seat offer expired',
      body: '5-a-side futsal, Fri 23 Oct, 8pm. We offered the seat to the next player.',
    });
  });

  it('says who cancelled a seat', () => {
    expect(render('seat_cancelled', { ...session, by_venue: true })).toEqual({ title: 'The venue cancelled your seat', body: '5-a-side futsal, Fri 23 Oct, 8pm.' });
    expect(render('seat_cancelled', { ...session, by_venue: false }).title).toBe('Seat cancelled');
  });

  it('says the venue cancelled the session', () => {
    expect(render('session_cancelled', session)).toEqual({ title: 'Session cancelled', body: '5-a-side futsal, Fri 23 Oct, 8pm was cancelled by the venue.' });
  });

  it('says why there was no seat', () => {
    expect(render('no_seat', { ...session, reason: 'waitlist' })).toEqual({ title: 'No seat this time', body: '5-a-side futsal, Fri 23 Oct, 8pm.' });
    expect(render('no_seat', { ...session, reason: 'not_enough_players' }).title).toBe("The match didn't fill");
  });

  it('calls a session without a fixed game open play', () => {
    expect(render('session_cancelled', { ...session, activity_name: null }).body).toBe('Open play, Fri 23 Oct, 8pm was cancelled by the venue.');
  });
});
