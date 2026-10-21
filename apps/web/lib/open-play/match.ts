import { formGroups, splitTeams, type EngineGame, type EnginePlayer } from '@bm/engine';

export interface MatchRequest {
  profileId: string;
  skill: number;
  /** Activity ids, most preferred first. */
  favourites: string[];
  priority: number;
  /** Epoch ms of the request. */
  requestedAt: number;
}

export interface MatchActivity {
  id: string;
  minPlayers: number;
  maxPlayers: number;
  teamMode: 'none' | 'two_teams';
  teamSize: number | null;
}

export interface MatchResource {
  id: string;
  capacity: number;
}

export interface MatchSeat {
  profileId: string;
  seatNo: number;
  team: 1 | 2 | null;
}

export interface MatchPlan {
  groups: Array<{ resourceId: string; activityId: string; capacity: number; seats: MatchSeat[] }>;
  /** In queue order. */
  waitlist: string[];
}

/**
 * Turns a session's seat requests into the plan apply_match writes: groups via the engine's
 * formGroups, and for team games two balanced teams via splitTeams (team 1 in seats 1…n, team 2 in
 * n+1…2n). A fixed-activity session gives every player that activity; when players choose, someone
 * with no (usable) favourites can play anything. Seeded from the session id, so it is repeatable.
 */
export function planMatch(input: {
  sessionId: string;
  fixedActivityId: string | null;
  activities: MatchActivity[];
  resources: MatchResource[];
  requests: MatchRequest[];
}): MatchPlan {
  const activities = input.fixedActivityId ? input.activities.filter((a) => a.id === input.fixedActivityId) : input.activities;
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const resourceById = new Map(input.resources.map((r) => [r.id, r]));
  const skillById = new Map(input.requests.map((r) => [r.profileId, r.skill]));

  const games: EngineGame[] = activities.map((a) => {
    const players = teamPlayers(a);
    return { id: a.id, minPlayers: players ?? a.minPlayers, maxPlayers: players ?? a.maxPlayers };
  });
  const allIds = activities.map((a) => a.id);
  const players: EnginePlayer[] = input.requests.map((r) => {
    const usable = r.favourites.filter((id) => activityById.has(id));
    return {
      id: r.profileId,
      skill: r.skill,
      priority: r.priority,
      requestedAt: r.requestedAt,
      favourites: input.fixedActivityId ? [input.fixedActivityId] : usable.length > 0 ? usable : allIds,
    };
  });

  const result = formGroups({ players, games, tables: input.resources, seed: seedFromId(input.sessionId) });

  return {
    groups: result.groups.map((g) => {
      const activity = activityById.get(g.gameId)!;
      const teamSize = activity.teamMode === 'two_teams' ? activity.teamSize : null;
      if (teamSize) {
        const { teams } = splitTeams(g.playerIds.map((id) => ({ id, skill: skillById.get(id)! })), teamSize);
        const seats: MatchSeat[] = [
          ...teams[0].map((profileId, i) => ({ profileId, seatNo: i + 1, team: 1 as const })),
          ...teams[1].map((profileId, i) => ({ profileId, seatNo: teamSize + i + 1, team: 2 as const })),
        ];
        return { resourceId: g.tableId, activityId: g.gameId, capacity: 2 * teamSize, seats };
      }
      return {
        resourceId: g.tableId,
        activityId: g.gameId,
        capacity: Math.min(resourceById.get(g.tableId)!.capacity, activity.maxPlayers),
        seats: g.playerIds.map((profileId, i) => ({ profileId, seatNo: i + 1, team: null })),
      };
    }),
    waitlist: result.waitlist,
  };
}

/** Players a two-team game needs (both teams), or null for a free-for-all game. */
function teamPlayers(activity: MatchActivity): number | null {
  return activity.teamMode === 'two_teams' && activity.teamSize ? 2 * activity.teamSize : null;
}

/** FNV-1a (32-bit) of the id: a stable engine seed per session. */
export function seedFromId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
