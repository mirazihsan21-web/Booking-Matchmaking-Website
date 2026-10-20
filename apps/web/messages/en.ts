/**
 * All user-facing copy. Components read from `m` (see ./index.ts) instead of hard-coding strings,
 * so a Bangla `bn.ts` with the same shape can be added later.
 */
export const en = {
  platform: {
    // Working name until the product is named (see memory.md).
    name: 'Booking & Matchmaking',
    tagline: 'Bookings and fair matchmaking for cafés, turfs and gaming lounges.',
    businessTypes: 'Built for board-game cafés, futsal turfs and gaming lounges in Bangladesh.',
  },
};

export type Messages = typeof en;
