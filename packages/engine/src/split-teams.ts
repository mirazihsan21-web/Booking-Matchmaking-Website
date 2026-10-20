import type { Id } from './types';

export interface TeamPlayer {
  id: Id;
  skill: number;
}

export interface TeamSplit {
  /** Each team's ids, sorted. */
  teams: [Id[], Id[]];
  /** |total skill of team 0 − total skill of team 1| */
  skillGap: number;
}

const EXHAUSTIVE_LIMIT = 12;
const byId = (a: TeamPlayer, b: TeamPlayer) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function lexLess(a: readonly Id[], b: readonly Id[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return (a[i] as Id) < (b[i] as Id);
  }
  return a.length < b.length;
}

function result(team0: TeamPlayer[], team1: TeamPlayer[]): TeamSplit {
  const total = (t: TeamPlayer[]) => t.reduce((s, p) => s + p.skill, 0);
  return {
    teams: [team0.map((p) => p.id).sort(), team1.map((p) => p.id).sort()],
    skillGap: Math.abs(total(team0) - total(team1)),
  };
}

/** Every split with the lowest-id player fixed in team 0 (skips mirror images). */
function exhaustive(sorted: TeamPlayer[], teamSize: number): TeamSplit {
  const total = sorted.reduce((s, p) => s + p.skill, 0);
  const rest = sorted.slice(1);
  let best: { gap: number; ids: Id[]; mask: boolean[] } | null = null;
  const chosen: boolean[] = new Array(rest.length).fill(false);

  const visit = (start: number, picked: number, sum0: number) => {
    if (picked === teamSize - 1) {
      const gap = Math.abs(total - 2 * sum0);
      const ids = [sorted[0]!.id, ...rest.filter((_, i) => chosen[i]).map((p) => p.id)].sort();
      if (!best || gap < best.gap || (gap === best.gap && lexLess(ids, best.ids))) best = { gap, ids, mask: [...chosen] };
      return;
    }
    for (let i = start; i < rest.length; i++) {
      chosen[i] = true;
      visit(i + 1, picked + 1, sum0 + rest[i]!.skill);
      chosen[i] = false;
    }
  };
  visit(0, 0, sorted[0]!.skill);

  const mask = (best as { mask: boolean[] } | null)?.mask ?? chosen;
  return result([sorted[0]!, ...rest.filter((_, i) => mask[i])], rest.filter((_, i) => !mask[i]));
}

/** Greedy (strongest first, into the weaker team with room), then best-improving swaps until none help. */
function greedyWithSwaps(sorted: TeamPlayer[], teamSize: number): TeamSplit {
  const order = [...sorted].sort((a, b) => b.skill - a.skill || byId(a, b));
  const teams: [TeamPlayer[], TeamPlayer[]] = [[], []];
  const totals = [0, 0];
  for (const p of order) {
    const t = teams[0].length < teamSize && (totals[0]! <= totals[1]! || teams[1].length >= teamSize) ? 0 : 1;
    teams[t].push(p);
    totals[t]! += p.skill;
  }

  for (;;) {
    const gap = Math.abs(totals[0]! - totals[1]!);
    let bestSwap: { i: number; j: number; gap: number } | null = null;
    for (let i = 0; i < teams[0].length; i++) {
      for (let j = 0; j < teams[1].length; j++) {
        const delta = teams[0][i]!.skill - teams[1][j]!.skill;
        const newGap = Math.abs(totals[0]! - delta - (totals[1]! + delta));
        if (newGap < gap && (!bestSwap || newGap < bestSwap.gap)) bestSwap = { i, j, gap: newGap };
      }
    }
    if (!bestSwap) break;
    const a = teams[0][bestSwap.i]!;
    const b = teams[1][bestSwap.j]!;
    teams[0][bestSwap.i] = b;
    teams[1][bestSwap.j] = a;
    totals[0] = totals[0]! - a.skill + b.skill;
    totals[1] = totals[1]! - b.skill + a.skill;
  }
  return result(teams[0], teams[1]);
}

/**
 * Two teams of `teamSize` whose total skills differ as little as possible.
 * Exact for up to 12 players; greedy plus swap improvement above that. Deterministic.
 */
export function splitTeams(players: TeamPlayer[], teamSize: number): TeamSplit {
  if (teamSize < 1 || players.length !== 2 * teamSize) {
    throw new RangeError('splitTeams needs exactly 2 × teamSize players');
  }
  const sorted = [...players].sort(byId);
  return players.length <= EXHAUSTIVE_LIMIT ? exhaustive(sorted, teamSize) : greedyWithSwaps(sorted, teamSize);
}
