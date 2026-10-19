import { createRng, type Rng } from '@bm/engine';
import { FIRST_NAMES, SURNAME_INITIALS } from './names';
import type { AvailabilityRow, PlayerGameRow, PlayerRow } from './rows';
import type { SimVenue } from './venue';

export interface SimPlayers {
  players: PlayerRow[];
  player_games: PlayerGameRow[];
  availability: AvailabilityRow[];
}

/** Share of players at skill 1..5. */
const SKILL_WEIGHTS = [10, 25, 35, 20, 10];
const MAX_PLAYERS = 1000;

function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i] as number;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Fake players for a venue. Phones use the Ofcom drama range +447700900000–999,
 * so a simulated number can never reach a real person.
 */
export function generatePlayers(o: { venue: SimVenue; count: number; seed: number }): SimPlayers {
  if (o.count > MAX_PLAYERS) throw new RangeError(`generatePlayers supports at most ${MAX_PLAYERS} players`);
  const rng = createRng(o.seed);
  const venueId = o.venue.venue.id;
  const out: SimPlayers = { players: [], player_games: [], availability: [] };

  for (let i = 0; i < o.count; i++) {
    const id = rng.uuid();
    out.players.push({
      id,
      venue_id: venueId,
      user_id: null,
      name: `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAME_INITIALS)}.`,
      phone: `+447700900${String(i).padStart(3, '0')}`,
      skill: weightedIndex(rng, SKILL_WEIGHTS) + 1,
      sms_opt_in: true,
    });

    const pool = [...o.venue.games];
    const favouriteCount = rng.int(1, Math.min(3, pool.length));
    for (let rank = 1; rank <= favouriteCount; rank++) {
      const [game] = pool.splice(weightedIndex(rng, pool.map((g) => g.popularity)), 1);
      out.player_games.push({ venue_id: venueId, player_id: id, game_id: game!.id, rank });
    }

    const nights = rng.shuffle(o.venue.nights).slice(0, rng.int(1, Math.min(3, o.venue.nights.length)));
    for (const night of nights) {
      out.availability.push({
        id: rng.uuid(),
        venue_id: venueId,
        player_id: id,
        weekday: night.weekday,
        start_time: night.start,
        end_time: night.end,
      });
    }
  }
  return out;
}
