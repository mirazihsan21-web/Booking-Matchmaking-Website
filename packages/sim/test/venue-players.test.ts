import { describe, expect, it } from 'vitest';
import { toEngineGames, toEnginePlayer, toEngineTables } from '../src/engine-adapters';
import { generatePlayers } from '../src/players';
import type { PlayerGameRow, PlayerRow } from '../src/rows';
import { generateVenue } from '../src/venue';
import { OWNER_ID, catalogue } from './fixtures';

const venue = generateVenue({ catalogue, name: 'Test Café', timezone: 'Europe/London', ownerId: OWNER_ID, seed: 1 });
const sim = generatePlayers({ venue, count: 60, seed: 2 });

describe('generateVenue', () => {
  it('generates identical output for the same seed', () => {
    expect(generateVenue({ catalogue, name: 'Test Café', timezone: 'Europe/London', ownerId: OWNER_ID, seed: 1 })).toEqual(venue);
  });

  it('turns the catalogue into venue-scoped rows', () => {
    expect(venue.venue).toMatchObject({ name: 'Test Café', timezone: 'Europe/London', owner_id: OWNER_ID, offer_ttl_seconds: 900, is_demo: false });
    expect(venue.venue_tables.map((t) => [t.name, t.capacity, t.venue_id])).toEqual(
      catalogue.tables.map((t) => [t.name, t.capacity, venue.venue.id]),
    );
    expect(venue.games.map((g) => [g.name, g.min_players, g.max_players])).toEqual(
      catalogue.games.map((g) => [g.name, g.minPlayers, g.maxPlayers]),
    );
    expect(venue.nights).toEqual(catalogue.nights);
  });
});

describe('generatePlayers', () => {
  it('generates identical output for the same seed', () => {
    expect(generatePlayers({ venue, count: 60, seed: 2 })).toEqual(sim);
  });

  it('creates the requested number of players with unique ids and drama-range phones', () => {
    expect(sim.players).toHaveLength(60);
    expect(new Set(sim.players.map((p) => p.id)).size).toBe(60);
    expect(new Set(sim.players.map((p) => p.phone)).size).toBe(60);
    for (const p of sim.players) {
      expect(p.phone).toMatch(/^\+447700900\d{3}$/);
      expect(p.venue_id).toBe(venue.venue.id);
      expect(p.user_id).toBeNull();
    }
  });

  it("gives each player 1–3 distinct favourites from the venue's games, ranked from 1", () => {
    const gameIds = new Set(venue.games.map((g) => g.id));
    for (const p of sim.players) {
      const mine = sim.player_games.filter((pg) => pg.player_id === p.id);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.length).toBeLessThanOrEqual(3);
      expect(new Set(mine.map((pg) => pg.game_id)).size).toBe(mine.length);
      expect(mine.map((pg) => pg.rank).sort()).toEqual(Array.from({ length: mine.length }, (_, i) => i + 1));
      for (const pg of mine) expect(gameIds.has(pg.game_id)).toBe(true);
    }
  });

  it('keeps skills as integers 1–5', () => {
    for (const p of sim.players) {
      expect(Number.isInteger(p.skill)).toBe(true);
      expect(p.skill).toBeGreaterThanOrEqual(1);
      expect(p.skill).toBeLessThanOrEqual(5);
    }
  });

  it('only uses venue nights for availability', () => {
    const nights = new Set(catalogue.nights.map((n) => `${n.weekday} ${n.start} ${n.end}`));
    for (const p of sim.players) {
      const mine = sim.availability.filter((a) => a.player_id === p.id);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.length).toBeLessThanOrEqual(3);
      for (const a of mine) expect(nights.has(`${a.weekday} ${a.start_time} ${a.end_time}`)).toBe(true);
    }
  });

  it('rejects more than 1000 players', () => {
    expect(() => generatePlayers({ venue, count: 1001, seed: 1 })).toThrow(RangeError);
  });
});

describe('engine adapters', () => {
  it('toEnginePlayer orders favourites by rank', () => {
    const player: PlayerRow = { id: 'p', venue_id: 'v', user_id: null, name: 'Maya K.', phone: '+447700900001', skill: 3, sms_opt_in: true };
    const playerGames: PlayerGameRow[] = [
      { venue_id: 'v', player_id: 'p', game_id: 'g1', rank: 2 },
      { venue_id: 'v', player_id: 'other', game_id: 'g3', rank: 1 },
      { venue_id: 'v', player_id: 'p', game_id: 'g2', rank: 1 },
    ];
    expect(toEnginePlayer(player, playerGames, 1, 500)).toEqual({ id: 'p', skill: 3, favourites: ['g2', 'g1'], priority: 1, requestedAt: 500 });
  });

  it('maps games and tables', () => {
    expect(toEngineGames(venue.games)[0]).toEqual({ id: venue.games[0]!.id, minPlayers: 3, maxPlayers: 4 });
    expect(toEngineTables(venue.venue_tables)[3]).toEqual({ id: venue.venue_tables[3]!.id, capacity: 6 });
  });
});
