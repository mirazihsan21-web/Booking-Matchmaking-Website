export type BusinessType = 'boardgame_cafe' | 'turf' | 'gaming_lounge';
export type ResourceKind = 'table' | 'pitch' | 'court' | 'zone' | 'pod';
export type TeamMode = 'none' | 'two_teams';

/**
 * What a venue gets when it picks a business type: the words used across its site, a default
 * palette, and a starter catalogue. Owners can edit everything after onboarding.
 */
export interface Preset {
  businessType: BusinessType;
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
  palette: { primary: string; accent: string };
  /** `slotMinutes`: the booking slot length (120 for café tables, 60 otherwise). */
  resources: Array<{ name: string; kind: ResourceKind; capacity: number; pricePerHourPoisha: number | null; slotMinutes: number }>;
  activities: Array<{
    name: string;
    minPlayers: number;
    maxPlayers: number;
    durationMin: number;
    popularity: number;
    teamMode: TeamMode;
    teamSize: number | null;
  }>;
  /** Default open-play seat price. */
  seatPricePoisha: number;
}
