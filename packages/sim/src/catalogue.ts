/** What a skin seeds a venue with. Times are local wall-clock 'HH:MM' in the venue's timezone. */

export interface SeedGame {
  name: string;
  minPlayers: number;
  maxPlayers: number;
  durationMin: number;
  /** Relative weight (> 0) for how often players pick it as a favourite. */
  popularity: number;
}

export interface SeedTable {
  name: string;
  capacity: number;
  x: number;
  y: number;
}

export interface SeedNight {
  /** 0 = Sunday. */
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start: string;
  end: string;
  seatPriceCents: number;
}

export interface Catalogue {
  games: SeedGame[];
  tables: SeedTable[];
  nights: SeedNight[];
}
