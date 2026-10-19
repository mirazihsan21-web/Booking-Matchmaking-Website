import type { Catalogue } from '@bm/sim';

/**
 * Everything that changes when the engine is re-skinned for a client vertical:
 * brand, domain words, colours and the seed catalogue. Code reads labels from here
 * instead of hard-coding "table" / "game" / "night".
 */
export interface Skin {
  key: 'boardgame';
  brand: { name: string; tagline: string };
  /** ISO 4217; prices are stored in minor units. */
  currency: string;
  timezone: string;
  labels: {
    resource: string;
    resourcePlural: string;
    activity: string;
    activityPlural: string;
    session: string;
    sessionPlural: string;
    participant: string;
    participantPlural: string;
  };
  palette: { primary: string; accent: string; background: string; foreground: string };
  catalogue: Catalogue;
}
