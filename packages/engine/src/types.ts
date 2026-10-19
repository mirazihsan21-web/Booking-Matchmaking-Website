export type Id = string;

export interface EnginePlayer {
  id: Id;
  /** Integer 1–5. */
  skill: number;
  /** Game ids, most preferred first. */
  favourites: Id[];
  /** Higher is served first (e.g. 1 if waitlisted last time). */
  priority: number;
  /** Epoch ms; earlier wins ties. */
  requestedAt: number;
}

export interface EngineGame {
  id: Id;
  minPlayers: number;
  maxPlayers: number;
}

export interface EngineTable {
  id: Id;
  capacity: number;
}

export interface MatchConfig {
  /** Points for a seat at the player's favourite of rank 0, 1, 2… */
  preferenceWeights: number[];
  skillWeight: number;
  fillWeight: number;
  iterations: number;
}

export interface MatchInput {
  /** Only the players requesting a seat for this session. */
  players: EnginePlayer[];
  games: EngineGame[];
  tables: EngineTable[];
  config?: Partial<MatchConfig>;
  seed: number;
}

export interface Group {
  tableId: Id;
  gameId: Id;
  playerIds: Id[];
}

export interface ScoreBreakdown {
  preference: number;
  skillSpread: number;
  filledSeats: number;
  underMin: number;
  total: number;
}

export interface MatchResult {
  groups: Group[];
  /** Ordered: first is offered the next open seat. */
  waitlist: Id[];
  score: ScoreBreakdown;
  diagnostics: { iterations: number; acceptedSwaps: number };
}
