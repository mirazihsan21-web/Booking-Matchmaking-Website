import fc from 'fast-check';
import type { MatchInput } from '../src/types';

/**
 * Random sessions: 1–6 games, 0–10 tables, 0–80 players with 0–3 favourites
 * (plus an unknown game id 10% of the time). With `singleGame`, there is one game and everyone wants it.
 */
export function arbMatchInput(opts: { singleGame?: boolean } = {}): fc.Arbitrary<MatchInput> {
  const arbGame = fc
    .integer({ min: 1, max: 4 })
    .chain((minPlayers) => fc.integer({ min: minPlayers, max: 8 }).map((maxPlayers) => ({ minPlayers, maxPlayers })));

  return fc
    .record({
      games: fc.array(arbGame, { minLength: 1, maxLength: opts.singleGame ? 1 : 6 }),
      capacities: fc.array(fc.integer({ min: 1, max: 10 }), { maxLength: 10 }),
      playerCount: fc.integer({ min: 0, max: 80 }),
      seed: fc.integer(),
    })
    .chain(({ games, capacities, playerCount, seed }) => {
      const gameIds = games.map((_, i) => `g${i}`);
      const arbPlayer = fc.record({
        skill: fc.integer({ min: 1, max: 5 }),
        priority: fc.integer({ min: 0, max: 3 }),
        favourites: opts.singleGame ? fc.constant(gameIds) : fc.shuffledSubarray(gameIds, { maxLength: Math.min(3, gameIds.length) }),
        unknown: opts.singleGame ? fc.constant(false) : fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
      });
      return fc.array(arbPlayer, { minLength: playerCount, maxLength: playerCount }).map(
        (players): MatchInput => ({
          players: players.map((p, i) => ({
            id: `p${i}`,
            skill: p.skill,
            priority: p.priority,
            requestedAt: i,
            favourites: p.unknown ? [...p.favourites, 'unknown'] : p.favourites,
          })),
          games: games.map((g, i) => ({ id: `g${i}`, ...g })),
          tables: capacities.map((capacity, i) => ({ id: `t${i}`, capacity })),
          seed,
        }),
      );
    });
}
