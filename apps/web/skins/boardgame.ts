import type { Skin } from './types';

const tables = [4, 4, 4, 4, 4, 6, 6].map((capacity, i) => ({
  name: `Table ${i + 1}`,
  capacity,
  x: i % 3,
  y: Math.floor(i / 3),
}));

/** 32 seats on purpose: the 40-player demo night always leaves a waitlist to refill from. */
export const boardgame: Skin = {
  key: 'boardgame',
  brand: { name: 'Meeple House', tagline: 'Find your table. Meet your game-night crew.' },
  currency: 'GBP',
  timezone: 'Europe/London',
  labels: {
    resource: 'table',
    resourcePlural: 'tables',
    activity: 'game',
    activityPlural: 'games',
    session: 'night',
    sessionPlural: 'nights',
    participant: 'player',
    participantPlural: 'players',
  },
  palette: { primary: '#0F766E', accent: '#F59E0B', background: '#FFFBF5', foreground: '#1C1917' },
  catalogue: {
    games: [
      { name: 'Catan', minPlayers: 3, maxPlayers: 4, durationMin: 90, popularity: 10 },
      { name: 'Ticket to Ride', minPlayers: 2, maxPlayers: 5, durationMin: 60, popularity: 9 },
      { name: 'Codenames', minPlayers: 4, maxPlayers: 8, durationMin: 20, popularity: 8 },
      { name: 'Carcassonne', minPlayers: 2, maxPlayers: 5, durationMin: 45, popularity: 7 },
      { name: 'Azul', minPlayers: 2, maxPlayers: 4, durationMin: 40, popularity: 7 },
      { name: 'Wingspan', minPlayers: 1, maxPlayers: 5, durationMin: 70, popularity: 6 },
      { name: 'Pandemic', minPlayers: 2, maxPlayers: 4, durationMin: 60, popularity: 6 },
      { name: '7 Wonders', minPlayers: 3, maxPlayers: 7, durationMin: 30, popularity: 5 },
    ],
    tables,
    nights: [
      { weekday: 2, start: '18:00', end: '22:00', seatPriceCents: 600 },
      { weekday: 4, start: '18:00', end: '22:00', seatPriceCents: 600 },
      { weekday: 5, start: '18:00', end: '23:00', seatPriceCents: 800 },
      { weekday: 6, start: '14:00', end: '23:00', seatPriceCents: 1000 },
      { weekday: 0, start: '13:00', end: '19:00', seatPriceCents: 700 },
    ],
  },
};
