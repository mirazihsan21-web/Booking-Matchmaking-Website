import { canHost, formGroups } from '@bm/engine';
import { generatePlayers, generateVenue, toEngineGames, toEnginePlayer, toEngineTables } from '@bm/sim';
import { describe, expect, it } from 'vitest';
import { skinToCssVars } from '../lib/theme';
import { getSkin } from '../skins';
import { boardgame } from '../skins/boardgame';

const { catalogue } = boardgame;

describe('board-game skin', () => {
  it('getSkin returns the board-game skin and rejects unknown keys', () => {
    expect(getSkin('boardgame')).toBe(boardgame);
    expect(() => getSkin('nope')).toThrow('Unknown skin nope');
  });

  it('every game has min ≤ max and positive popularity', () => {
    for (const g of catalogue.games) {
      expect(g.minPlayers).toBeLessThanOrEqual(g.maxPlayers);
      expect(g.popularity).toBeGreaterThan(0);
    }
  });

  it('every game can be hosted by at least one table', () => {
    for (const g of catalogue.games) {
      const game = { id: g.name, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers };
      expect(catalogue.tables.some((t) => canHost(game, { id: t.name, capacity: t.capacity }))).toBe(true);
    }
  });

  it('the floor has 32 seats', () => {
    expect(catalogue.tables.reduce((sum, t) => sum + t.capacity, 0)).toBe(32);
  });

  it('night weekdays are unique', () => {
    const weekdays = catalogue.nights.map((n) => n.weekday);
    expect(new Set(weekdays).size).toBe(weekdays.length);
  });

  it('skinToCssVars maps the palette', () => {
    expect(skinToCssVars(boardgame)).toEqual({
      '--primary': '#0F766E',
      '--accent': '#F59E0B',
      '--background': '#FFFBF5',
      '--foreground': '#1C1917',
    });
  });

  it('a 40-player demo night leaves a waitlist', () => {
    const venue = generateVenue({ catalogue, name: boardgame.brand.name, timezone: boardgame.timezone, ownerId: 'owner', seed: 2026 });
    const sim = generatePlayers({ venue, count: 40, seed: 2026 });
    const players = sim.players.map((p, i) => toEnginePlayer(p, sim.player_games, 0, i));
    const result = formGroups({ players, games: toEngineGames(venue.games), tables: toEngineTables(venue.venue_tables), seed: 2026 });
    expect(result.waitlist.length).toBeGreaterThanOrEqual(4);
    expect(result.groups.length).toBeGreaterThanOrEqual(5);
  });
});
