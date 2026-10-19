import { UNDER_MIN_PENALTY, resolveConfig } from './config';
import type { EngineGame, EnginePlayer, Group, Id, MatchInput, ScoreBreakdown } from './types';

export type Scorer = (groups: readonly Group[]) => ScoreBreakdown;

/** Precomputes lookups once so local search can re-score cheaply. */
export function createScorer(input: MatchInput): Scorer {
  const cfg = resolveConfig(input.config);
  const players = new Map<Id, EnginePlayer>(input.players.map((p) => [p.id, p]));
  const games = new Map<Id, EngineGame>(input.games.map((g) => [g.id, g]));

  return (groups) => {
    let preference = 0;
    let skillSpread = 0;
    let filledSeats = 0;
    let underMin = 0;

    for (const group of groups) {
      let min = Infinity;
      let max = -Infinity;
      for (const id of group.playerIds) {
        const player = players.get(id);
        if (!player) continue;
        const rank = player.favourites.indexOf(group.gameId);
        if (rank >= 0) preference += cfg.preferenceWeights[rank] ?? 0;
        min = Math.min(min, player.skill);
        max = Math.max(max, player.skill);
      }
      if (group.playerIds.length > 0) skillSpread += max - min;
      filledSeats += group.playerIds.length;
      const game = games.get(group.gameId);
      if (game && group.playerIds.length < game.minPlayers) underMin++;
    }

    const total =
      preference - cfg.skillWeight * skillSpread + cfg.fillWeight * filledSeats - UNDER_MIN_PENALTY * underMin;
    return { preference, skillSpread, filledSeats, underMin, total };
  };
}

export function scoreGroups(groups: readonly Group[], input: MatchInput): ScoreBreakdown {
  return createScorer(input)(groups);
}
