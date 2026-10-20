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
  auth: {
    title: 'Sign in',
    tenantTitle: (venue: string) => `Sign in to ${venue}`,
    emailLabel: 'Email address',
    sendLink: 'Email me a sign-in link',
    sending: 'Sending…',
    checkEmail: 'Check your email — we sent you a link to sign in.',
    error: "We couldn't send the link. Check the address and try again.",
    linkFailed: 'That sign-in link has expired or was already used. Request a new one.',
    google: 'Continue with Google',
    or: 'or',
    signOut: 'Sign out',
  },
  unavailable: {
    title: 'Not available',
    body: "This venue isn't available right now.",
  },
};

export type Messages = typeof en;
