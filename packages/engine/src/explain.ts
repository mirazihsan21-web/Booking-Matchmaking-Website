import { resolveConfig } from './config';
import type { Id, MatchInput, MatchResult } from './types';

export interface PlayerExplanation {
  playerId: Id;
  status: 'seated' | 'waitlisted';
  tableId?: Id;
  gameId?: Id;
  /** 0-based index of the seated game in the player's favourites. */
  favouriteRank?: number;
  preferencePoints?: number;
  tableSkillRange?: [number, number];
  /** 1-based. */
  waitlistPosition?: number;
  reason: string;
}

/** The "why am I at this table?" breakdown shown to players. */
export function explainScore(result: MatchResult, input: MatchInput, playerId: Id): PlayerExplanation {
  const player = input.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`Unknown player ${playerId}`);

  const group = result.groups.find((g) => g.playerIds.includes(playerId));
  if (group) {
    const skillById = new Map(input.players.map((p) => [p.id, p.skill]));
    const skills = group.playerIds.map((id) => skillById.get(id) ?? player.skill);
    const range: [number, number] = [Math.min(...skills), Math.max(...skills)];
    const rank = player.favourites.indexOf(group.gameId);
    return {
      playerId,
      status: 'seated',
      tableId: group.tableId,
      gameId: group.gameId,
      favouriteRank: rank,
      preferencePoints: resolveConfig(input.config).preferenceWeights[rank] ?? 0,
      tableSkillRange: range,
      reason: `Seated for your #${rank + 1} pick with players of skill ${range[0]}–${range[1]}`,
    };
  }

  const position = result.waitlist.indexOf(playerId) + 1;
  return {
    playerId,
    status: 'waitlisted',
    waitlistPosition: position,
    reason: `Waitlisted at position ${position}: every table running one of your games is full`,
  };
}
