import { canHost, groupCapacity, resolveConfig } from './config';
import { createRng } from './rng';
import { createScorer } from './score';
import type { EngineGame, EnginePlayer, EngineTable, Group, Id, MatchInput, MatchResult } from './types';

interface Seating {
  table: EngineTable;
  game: EngineGame;
  capacity: number;
  playerIds: Id[];
}

/**
 * Turns one session's seat requests into table groups plus an ordered waitlist.
 *
 * 1. Greedy: players in service order join an open group of their best available favourite,
 *    or open one at the smallest free table that can host it.
 * 2. Repair: groups below their game's minimum are dissolved, that table+game pair is banned,
 *    and everyone unseated gets another pass.
 * 3. Within each game, tables are refilled in skill order so similar players sit together.
 * 4. Seeded swap search: swap two players across groups when both like the other's game and
 *    the score strictly improves. Group sizes never change, so no seat that could be filled is left empty.
 */
export function formGroups(input: MatchInput): MatchResult {
  const cfg = resolveConfig(input.config);
  const gameById = new Map(input.games.map((g) => [g.id, g]));
  const playerById = new Map(input.players.map((p) => [p.id, p]));
  const favs = new Map<Id, Id[]>(
    input.players.map((p) => [p.id, [...new Set(p.favourites)].filter((id) => gameById.has(id))]),
  );
  const favSets = new Map<Id, Set<Id>>([...favs].map(([id, list]) => [id, new Set(list)]));

  const serviceOrder = (a: EnginePlayer, b: EnginePlayer) =>
    b.priority - a.priority || a.requestedAt - b.requestedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const tables = [...input.tables].sort((a, b) => a.capacity - b.capacity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const tableOrder = new Map(tables.map((t, i) => [t.id, i]));

  let seatings: Seating[] = [];
  const freeTables = new Set(tables.map((t) => t.id));
  const banned = new Set<string>();

  const seatPass = (pool: EnginePlayer[]): EnginePlayer[] => {
    const unseated: EnginePlayer[] = [];
    for (const player of pool) {
      let seated = false;
      for (const gameId of favs.get(player.id) ?? []) {
        const open = seatings.find((s) => s.game.id === gameId && s.playerIds.length < s.capacity);
        if (open) {
          open.playerIds.push(player.id);
          seated = true;
          break;
        }
        const game = gameById.get(gameId) as EngineGame;
        const table = tables.find((t) => freeTables.has(t.id) && canHost(game, t) && !banned.has(`${t.id}|${gameId}`));
        if (table) {
          freeTables.delete(table.id);
          seatings.push({ table, game, capacity: groupCapacity(game, table), playerIds: [player.id] });
          seated = true;
          break;
        }
      }
      if (!seated) unseated.push(player);
    }
    return unseated;
  };

  // 1–2. Greedy seating with repair of under-minimum groups.
  let unseated = seatPass([...input.players].sort(serviceOrder));
  for (;;) {
    const under = seatings.filter((s) => s.playerIds.length < s.game.minPlayers);
    if (under.length === 0) break;
    for (const s of under) {
      banned.add(`${s.table.id}|${s.game.id}`);
      freeTables.add(s.table.id);
      for (const id of s.playerIds) unseated.push(playerById.get(id) as EnginePlayer);
    }
    seatings = seatings.filter((s) => !under.includes(s));
    unseated = seatPass(unseated.sort(serviceOrder));
  }
  seatings.sort((a, b) => (tableOrder.get(a.table.id) as number) - (tableOrder.get(b.table.id) as number));

  // 3. Skill chunking within each game.
  const byGame = new Map<Id, Seating[]>();
  for (const s of seatings) byGame.set(s.game.id, [...(byGame.get(s.game.id) ?? []), s]);
  for (const group of byGame.values()) {
    if (group.length < 2) continue;
    const members = group
      .flatMap((s) => s.playerIds)
      .map((id) => playerById.get(id) as EnginePlayer)
      .sort((a, b) => a.skill - b.skill || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let cursor = 0;
    for (const s of group) {
      const size = s.playerIds.length;
      s.playerIds = members.slice(cursor, cursor + size).map((p) => p.id);
      cursor += size;
    }
  }

  // 4. Seeded swap search. The score is a sum over groups, so only the two touched groups are re-scored.
  const groups: Group[] = seatings.map((s) => ({ tableId: s.table.id, gameId: s.game.id, playerIds: s.playerIds }));
  const scorer = createScorer(input);
  const seats: Array<[group: number, slot: number]> = groups.flatMap((g, gi) =>
    g.playerIds.map((_, si) => [gi, si] as [number, number]),
  );
  const rng = createRng(input.seed);
  let acceptedSwaps = 0;

  if (groups.length >= 2) {
    for (let i = 0; i < cfg.iterations; i++) {
      const [ga, sa] = seats[rng.int(0, seats.length - 1)] as [number, number];
      const [gb, sb] = seats[rng.int(0, seats.length - 1)] as [number, number];
      if (ga === gb) continue;
      const A = groups[ga] as Group;
      const B = groups[gb] as Group;
      const a = A.playerIds[sa] as Id;
      const b = B.playerIds[sb] as Id;
      if (!favSets.get(a)?.has(B.gameId) || !favSets.get(b)?.has(A.gameId)) continue;

      const before = scorer([A, B]).total;
      A.playerIds[sa] = b;
      B.playerIds[sb] = a;
      if (scorer([A, B]).total > before) {
        acceptedSwaps++;
      } else {
        A.playerIds[sa] = a;
        B.playerIds[sb] = b;
      }
    }
  }

  return {
    groups,
    waitlist: unseated.sort(serviceOrder).map((p) => p.id),
    score: scorer(groups),
    diagnostics: { iterations: cfg.iterations, acceptedSwaps },
  };
}
