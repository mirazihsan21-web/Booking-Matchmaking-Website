import type { Preset } from './types';

const teams = (name: string, teamSize: number, durationMin: number, popularity: number) => ({
  name,
  minPlayers: 2 * teamSize,
  maxPlayers: 2 * teamSize,
  durationMin,
  popularity,
  teamMode: 'two_teams' as const,
  teamSize,
});

export const turf: Preset = {
  businessType: 'turf',
  labels: {
    resource: 'pitch',
    resourcePlural: 'pitches',
    activity: 'format',
    activityPlural: 'formats',
    session: 'open match',
    sessionPlural: 'open matches',
    participant: 'player',
    participantPlural: 'players',
  },
  palette: { primary: '#15803D', accent: '#FACC15' },
  resources: [
    { name: 'Pitch 1', kind: 'pitch', capacity: 14, pricePerHourPoisha: 250000 },
    { name: 'Pitch 2', kind: 'pitch', capacity: 14, pricePerHourPoisha: 250000 },
    { name: 'Badminton Court 1', kind: 'court', capacity: 4, pricePerHourPoisha: 60000 },
  ],
  activities: [teams('5-a-side futsal', 5, 60, 10), teams('7-a-side', 7, 60, 6), teams('Badminton doubles', 2, 60, 5)],
  seatPricePoisha: 30000,
};
