import type { EngineGame, EngineTable, MatchConfig } from './types';

export const DEFAULT_CONFIG: MatchConfig = {
  preferenceWeights: [3, 2, 1],
  skillWeight: 1,
  fillWeight: 2,
  iterations: 2000,
};

/** Subtracted per group below its game's minimum; large enough to dominate every other term. */
export const UNDER_MIN_PENALTY = 1000;

export function resolveConfig(partial?: Partial<MatchConfig>): MatchConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}

/** Seats a group of this game gets at this table. */
export function groupCapacity(game: EngineGame, table: EngineTable): number {
  return Math.min(table.capacity, game.maxPlayers);
}

export function canHost(game: EngineGame, table: EngineTable): boolean {
  return groupCapacity(game, table) >= game.minPlayers;
}
