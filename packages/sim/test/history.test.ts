import { describe, expect, it } from 'vitest';
import { generateHistory } from '../src/history';
import { generatePlayers } from '../src/players';
import { generateVenue } from '../src/venue';
import { OWNER_ID, catalogue } from './fixtures';

const venue = generateVenue({ catalogue, name: 'Test Café', timezone: 'Europe/London', ownerId: OWNER_ID, seed: 1 });
const players = generatePlayers({ venue, count: 60, seed: 2 });
const options = { venue, players, weeks: 12, endDate: '2026-10-19', seed: 7 };
const history = generateHistory(options);

describe('generateHistory', () => {
  it('is deterministic for a seed', () => {
    expect(generateHistory(options)).toEqual(history);
  });

  it('creates weeks × nights sessions, all before endDate, ordered by starts_at', () => {
    expect(history.sessions).toHaveLength(12 * catalogue.nights.length);
    const starts = history.sessions.map((s) => s.starts_at);
    expect([...starts].sort()).toEqual(starts);
    for (const s of history.sessions) {
      expect(s.starts_at < '2026-10-19T00:00:00.000Z').toBe(true);
      expect(s.starts_at < s.ends_at).toBe(true);
      expect(s.status).toBe('closed');
    }
  });

  it('references only existing sessions, groups and players', () => {
    const sessions = new Set(history.sessions.map((s) => s.id));
    const groups = new Set(history.groups.map((g) => g.id));
    const people = new Set(players.players.map((p) => p.id));
    const tables = new Set(venue.venue_tables.map((t) => t.id));
    const games = new Set(venue.games.map((g) => g.id));
    for (const g of history.groups) {
      expect(sessions.has(g.session_id)).toBe(true);
      expect(tables.has(g.table_id)).toBe(true);
      expect(games.has(g.game_id)).toBe(true);
    }
    for (const b of history.bookings) {
      expect(sessions.has(b.session_id)).toBe(true);
      expect(groups.has(b.group_id)).toBe(true);
      expect(people.has(b.player_id)).toBe(true);
    }
    for (const r of [...history.seat_requests, ...history.waitlist_entries]) {
      expect(sessions.has(r.session_id)).toBe(true);
      expect(people.has(r.player_id)).toBe(true);
    }
    const entries = new Set(history.waitlist_entries.map((w) => w.id));
    for (const o of history.seat_offers) {
      expect(groups.has(o.group_id)).toBe(true);
      expect(entries.has(o.waitlist_entry_id)).toBe(true);
    }
  });

  it('never puts two live bookings in one seat or one player twice in a session', () => {
    const live = history.bookings.filter((b) => b.status !== 'cancelled');
    const seats = live.map((b) => `${b.group_id}|${b.seat_no}`);
    const playerSessions = live.map((b) => `${b.session_id}|${b.player_id}`);
    expect(new Set(seats).size).toBe(seats.length);
    expect(new Set(playerSessions).size).toBe(playerSessions.length);
  });

  it('backs every seat_filled event with a waitlist-sourced booking and positive seconds_since_cancel', () => {
    const filled = history.events.filter((e) => e.type === 'seat_filled');
    expect(filled.length).toBeGreaterThan(0);
    for (const e of filled) {
      const booking = history.bookings.find((b) => b.id === e.payload.booking_id);
      expect(booking?.source).toBe('waitlist');
      expect(e.payload.seconds_since_cancel).toBeGreaterThan(0);
    }
  });

  it('keeps the cancellation share between 5% and 20%', () => {
    const matched = history.bookings.filter((b) => b.source === 'matched');
    const share = matched.filter((b) => b.status === 'cancelled').length / matched.length;
    expect(share).toBeGreaterThanOrEqual(0.05);
    expect(share).toBeLessThanOrEqual(0.2);
  });

  it('leaves no waitlist entry waiting or offered on a closed session', () => {
    for (const w of history.waitlist_entries) expect(['promoted', 'expired']).toContain(w.status);
  });

  it('answers every accepted offer before it expires', () => {
    const accepted = history.seat_offers.filter((o) => o.status === 'accepted');
    expect(accepted.length).toBeGreaterThan(0);
    for (const o of accepted) expect(o.responded_at! <= o.expires_at).toBe(true);
  });
});
