import type { EngineGame, EnginePlayer, EngineTable } from '@bm/engine';
import type { GameRow, PlayerGameRow, PlayerRow, VenueTableRow } from './rows';

export function toEngineGames(games: GameRow[]): EngineGame[] {
  return games.map((g) => ({ id: g.id, minPlayers: g.min_players, maxPlayers: g.max_players }));
}

export function toEngineTables(tables: VenueTableRow[]): EngineTable[] {
  return tables.map((t) => ({ id: t.id, capacity: t.capacity }));
}

/** `playerGames` may hold every player's rows; only this player's are used, ordered by rank. */
export function toEnginePlayer(
  player: PlayerRow,
  playerGames: PlayerGameRow[],
  priority: number,
  requestedAt: number,
): EnginePlayer {
  const favourites = playerGames
    .filter((pg) => pg.player_id === player.id)
    .sort((a, b) => a.rank - b.rank)
    .map((pg) => pg.game_id);
  return { id: player.id, skill: player.skill, favourites, priority, requestedAt };
}
