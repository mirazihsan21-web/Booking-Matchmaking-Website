import type { Preset } from './types';

export const lounge: Preset = {
  businessType: 'gaming_lounge',
  labels: {
    resource: 'zone',
    resourcePlural: 'zones',
    activity: 'game',
    activityPlural: 'games',
    session: 'squad session',
    sessionPlural: 'squad sessions',
    participant: 'gamer',
    participantPlural: 'gamers',
  },
  palette: { primary: '#7C3AED', accent: '#22D3EE' },
  resources: [
    { name: 'PC Zone A', kind: 'zone', capacity: 10, pricePerHourPoisha: 150000, slotMinutes: 60 },
    { name: 'PC Zone B', kind: 'zone', capacity: 10, pricePerHourPoisha: 150000, slotMinutes: 60 },
    { name: 'Console Pod 1', kind: 'pod', capacity: 4, pricePerHourPoisha: 40000, slotMinutes: 60 },
    { name: 'Console Pod 2', kind: 'pod', capacity: 4, pricePerHourPoisha: 40000, slotMinutes: 60 },
  ],
  activities: [
    { name: 'Valorant 5v5', minPlayers: 10, maxPlayers: 10, durationMin: 60, popularity: 10, teamMode: 'two_teams', teamSize: 5 },
    { name: 'CS2 5v5', minPlayers: 10, maxPlayers: 10, durationMin: 60, popularity: 8, teamMode: 'two_teams', teamSize: 5 },
    { name: 'EA FC 1v1', minPlayers: 2, maxPlayers: 2, durationMin: 20, popularity: 9, teamMode: 'two_teams', teamSize: 1 },
    { name: 'PUBG squad', minPlayers: 2, maxPlayers: 4, durationMin: 30, popularity: 7, teamMode: 'none', teamSize: null },
  ],
  seatPricePoisha: 15000,
};
