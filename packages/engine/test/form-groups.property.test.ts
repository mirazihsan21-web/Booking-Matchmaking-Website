import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { groupCapacity } from '../src/config';
import { formGroups } from '../src/form-groups';
import type { MatchInput } from '../src/types';
import { arbMatchInput } from './arbitraries';

const runs = { numRuns: 300 };

function lookups(input: MatchInput) {
  return {
    game: new Map(input.games.map((g) => [g.id, g])),
    table: new Map(input.tables.map((t) => [t.id, t])),
    player: new Map(input.players.map((p) => [p.id, p])),
  };
}

describe('formGroups invariants', () => {
  it('every player is seated exactly once or waitlisted exactly once', () => {
    fc.assert(
      fc.property(arbMatchInput(), (input) => {
        const result = formGroups(input);
        const placed = [...result.groups.flatMap((g) => g.playerIds), ...result.waitlist];
        expect(placed.length).toBe(input.players.length);
        expect(new Set(placed)).toEqual(new Set(input.players.map((p) => p.id)));
      }),
      runs,
    );
  });

  it('groups use distinct tables and sizes stay within [game.minPlayers, groupCapacity]', () => {
    fc.assert(
      fc.property(arbMatchInput(), (input) => {
        const { game, table } = lookups(input);
        const result = formGroups(input);
        expect(new Set(result.groups.map((g) => g.tableId)).size).toBe(result.groups.length);
        for (const g of result.groups) {
          const gm = game.get(g.gameId)!;
          expect(g.playerIds.length).toBeGreaterThanOrEqual(gm.minPlayers);
          expect(g.playerIds.length).toBeLessThanOrEqual(groupCapacity(gm, table.get(g.tableId)!));
        }
      }),
      runs,
    );
  });

  it('seated players only play a favourite game', () => {
    fc.assert(
      fc.property(arbMatchInput(), (input) => {
        const { player } = lookups(input);
        for (const g of formGroups(input).groups) {
          for (const id of g.playerIds) expect(player.get(id)!.favourites).toContain(g.gameId);
        }
      }),
      runs,
    );
  });

  it('same input gives the same result', () => {
    fc.assert(
      fc.property(arbMatchInput(), (input) => {
        expect(formGroups(input)).toEqual(formGroups(structuredClone(input)));
      }),
      runs,
    );
  });

  it('no waitlisted player fits a free seat in a group running one of their favourites', () => {
    fc.assert(
      fc.property(arbMatchInput(), (input) => {
        const { game, table, player } = lookups(input);
        const result = formGroups(input);
        const withSpace = result.groups.filter(
          (g) => g.playerIds.length < groupCapacity(game.get(g.gameId)!, table.get(g.tableId)!),
        );
        for (const id of result.waitlist) {
          for (const g of withSpace) expect(player.get(id)!.favourites).not.toContain(g.gameId);
        }
      }),
      runs,
    );
  });

  it('swap search never lowers the score', () => {
    fc.assert(
      fc.property(arbMatchInput(), (input) => {
        const searched = formGroups(input).score.total;
        const greedy = formGroups({ ...input, config: { iterations: 0 } }).score.total;
        expect(searched).toBeGreaterThanOrEqual(greedy);
      }),
      runs,
    );
  });

  it('when everyone wants one game, every seated player has priority ≥ every waitlisted player', () => {
    fc.assert(
      fc.property(arbMatchInput({ singleGame: true }), (input) => {
        const { player } = lookups(input);
        const result = formGroups(input);
        const seated = result.groups.flatMap((g) => g.playerIds).map((id) => player.get(id)!.priority);
        const waiting = result.waitlist.map((id) => player.get(id)!.priority);
        if (seated.length && waiting.length) expect(Math.min(...seated)).toBeGreaterThanOrEqual(Math.max(...waiting));
      }),
      runs,
    );
  });
});
