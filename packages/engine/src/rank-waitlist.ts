import type { EnginePlayer, Id } from './types';

export interface OpenSeat {
  gameId: Id;
  /** Skills of the players still at the table. */
  tableSkills: number[];
}

export type WaitlistCandidate = EnginePlayer & { available: boolean };

/**
 * Who gets offered a freed seat, best first: available players who want the game,
 * ranked by rounded skill distance to the table's mean, then priority, then request time.
 */
export function rankWaitlist(seat: OpenSeat, candidates: WaitlistCandidate[]): Id[] {
  const mean = seat.tableSkills.length ? seat.tableSkills.reduce((a, b) => a + b, 0) / seat.tableSkills.length : null;
  const fit = (c: WaitlistCandidate) => (mean === null ? 0 : Math.round(Math.abs(c.skill - mean)));

  return candidates
    .filter((c) => c.available && c.favourites.includes(seat.gameId))
    .map((c) => ({ c, fit: fit(c) }))
    .sort(
      (a, b) =>
        a.fit - b.fit ||
        b.c.priority - a.c.priority ||
        a.c.requestedAt - b.c.requestedAt ||
        (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0),
    )
    .map(({ c }) => c.id);
}
