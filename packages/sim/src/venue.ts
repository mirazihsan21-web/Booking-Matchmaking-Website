import { createRng } from '@bm/engine';
import type { Catalogue, SeedNight } from './catalogue';
import type { GameRow, VenueRow, VenueTableRow } from './rows';

export interface SimVenue {
  venue: VenueRow;
  venue_tables: VenueTableRow[];
  games: GameRow[];
  /** Weekly nights the venue runs; sessions are generated from these. */
  nights: SeedNight[];
}

export function generateVenue(o: {
  catalogue: Catalogue;
  name: string;
  timezone: string;
  ownerId: string;
  seed: number;
  skin?: string;
}): SimVenue {
  const rng = createRng(o.seed);
  const venueId = rng.uuid();
  return {
    venue: {
      id: venueId,
      name: o.name,
      timezone: o.timezone,
      skin: o.skin ?? 'boardgame',
      offer_ttl_seconds: 900,
      owner_id: o.ownerId,
      is_demo: false,
      expires_at: null,
    },
    venue_tables: o.catalogue.tables.map((t) => ({ id: rng.uuid(), venue_id: venueId, ...t })),
    games: o.catalogue.games.map((g) => ({
      id: rng.uuid(),
      venue_id: venueId,
      name: g.name,
      min_players: g.minPlayers,
      max_players: g.maxPlayers,
      duration_min: g.durationMin,
      popularity: g.popularity,
    })),
    nights: o.catalogue.nights.map((n) => ({ ...n })),
  };
}
