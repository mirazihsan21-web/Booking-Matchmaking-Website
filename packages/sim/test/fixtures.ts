import type { Catalogue } from '../src/catalogue';

export const OWNER_ID = '00000000-0000-4000-8000-000000000001';

export const catalogue: Catalogue = {
  games: [
    { name: 'Catan', minPlayers: 3, maxPlayers: 4, durationMin: 90, popularity: 10 },
    { name: 'Ticket to Ride', minPlayers: 2, maxPlayers: 5, durationMin: 60, popularity: 9 },
    { name: 'Codenames', minPlayers: 4, maxPlayers: 8, durationMin: 20, popularity: 8 },
    { name: 'Azul', minPlayers: 2, maxPlayers: 4, durationMin: 40, popularity: 7 },
  ],
  tables: [
    { name: 'Table 1', capacity: 4, x: 0, y: 0 },
    { name: 'Table 2', capacity: 4, x: 1, y: 0 },
    { name: 'Table 3', capacity: 4, x: 2, y: 0 },
    { name: 'Table 4', capacity: 6, x: 0, y: 1 },
  ],
  nights: [
    { weekday: 2, start: '18:00', end: '22:00', seatPriceCents: 600 },
    { weekday: 5, start: '18:00', end: '23:00', seatPriceCents: 800 },
    { weekday: 6, start: '14:00', end: '23:00', seatPriceCents: 1000 },
  ],
};
