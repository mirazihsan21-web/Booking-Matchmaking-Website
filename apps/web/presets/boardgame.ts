import type { Preset } from './types';

const game = (name: string, minPlayers: number, maxPlayers: number, durationMin: number, popularity: number) => ({
  name,
  minPlayers,
  maxPlayers,
  durationMin,
  popularity,
  teamMode: 'none' as const,
  teamSize: null,
});

export const boardgame: Preset = {
  businessType: 'boardgame_cafe',
  labels: {
    resource: 'table',
    resourcePlural: 'tables',
    activity: 'game',
    activityPlural: 'games',
    session: 'game night',
    sessionPlural: 'game nights',
    participant: 'player',
    participantPlural: 'players',
  },
  palette: { primary: '#0F766E', accent: '#F59E0B' },
  resources: [4, 4, 4, 4, 4, 6, 6].map((capacity, i) => ({
    name: `Table ${i + 1}`,
    kind: 'table' as const,
    capacity,
    pricePerHourPoisha: null,
  })),
  activities: [
    game('Catan', 3, 4, 90, 10),
    game('Ticket to Ride', 2, 5, 60, 9),
    game('Codenames', 4, 8, 20, 8),
    game('Carcassonne', 2, 5, 45, 7),
    game('Azul', 2, 4, 40, 7),
    game('Wingspan', 1, 5, 70, 6),
    game('Pandemic', 2, 4, 60, 6),
    game('7 Wonders', 3, 7, 30, 5),
  ],
  seatPricePoisha: 20000,
};
