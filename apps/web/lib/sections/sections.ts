import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpeningHours } from '@/lib/opening-hours';
import type { BusinessType } from '@/presets/types';

/**
 * A brand's sections (turf, board-game café, gaming lounge). Each has its own opening hours and booking
 * rules; spaces, games and scheduled games belong to one section. Pass any client: section rows are
 * public for live brands, and callers check who is asking.
 */

export interface SectionRules {
  bookingHorizonDays: number;
  cancelCutoffMinutes: number;
  matchCutoffMinutes: number;
  maxUpcomingBookings: number;
  offerTtlSeconds: number;
}

export interface Section {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  kind: BusinessType;
  accent: string;
  position: number;
  openingHours: OpeningHours;
  rules: SectionRules;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SECTION_COLUMNS =
  'id, organization_id, slug, name, kind, accent, position, opening_hours, booking_horizon_days, cancel_cutoff_minutes, match_cutoff_minutes, max_upcoming_bookings, offer_ttl_seconds';

interface SectionRow {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  kind: BusinessType;
  accent: string;
  position: number;
  opening_hours: OpeningHours;
  booking_horizon_days: number;
  cancel_cutoff_minutes: number;
  match_cutoff_minutes: number;
  max_upcoming_bookings: number;
  offer_ttl_seconds: number;
}

/** A sections row (selected with SECTION_COLUMNS) as a Section. */
export function toSection(row: SectionRow): Section {
  return {
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    accent: row.accent,
    position: row.position,
    openingHours: row.opening_hours,
    rules: {
      bookingHorizonDays: row.booking_horizon_days,
      cancelCutoffMinutes: row.cancel_cutoff_minutes,
      matchCutoffMinutes: row.match_cutoff_minutes,
      maxUpcomingBookings: row.max_upcoming_bookings,
      offerTtlSeconds: row.offer_ttl_seconds,
    },
  };
}

/** The brand's sections in display order (then by name). */
export async function loadSections(db: SupabaseClient, organizationId: string): Promise<Section[]> {
  if (!UUID.test(organizationId)) return [];
  const { data, error } = await db.from('sections').select(SECTION_COLUMNS).eq('organization_id', organizationId).order('position').order('name');
  if (error) throw error;
  return (data as SectionRow[]).map(toSection);
}

/** One section of this brand; null for another brand's section or a malformed id. */
export async function loadSection(db: SupabaseClient, input: { organizationId: string; sectionId: string }): Promise<Section | null> {
  if (!UUID.test(input.organizationId) || !UUID.test(input.sectionId)) return null;
  const { data, error } = await db.from('sections').select(SECTION_COLUMNS).eq('id', input.sectionId).eq('organization_id', input.organizationId).maybeSingle();
  if (error) throw error;
  return data ? toSection(data as SectionRow) : null;
}

/** The section a space belongs to. */
export async function sectionOfResource(db: SupabaseClient, resourceId: string): Promise<Section | null> {
  if (!UUID.test(resourceId)) return null;
  const { data, error } = await db.from('resources').select(`sections(${SECTION_COLUMNS})`).eq('id', resourceId).maybeSingle();
  if (error) throw error;
  const row = (data as { sections: SectionRow | null } | null)?.sections;
  return row ? toSection(row) : null;
}

/** The section a scheduled game belongs to. */
export async function sectionOfSession(db: SupabaseClient, sessionId: string): Promise<Section | null> {
  if (!UUID.test(sessionId)) return null;
  const { data, error } = await db.from('open_play_sessions').select(`sections(${SECTION_COLUMNS})`).eq('id', sessionId).maybeSingle();
  if (error) throw error;
  const row = (data as { sections: SectionRow | null } | null)?.sections;
  return row ? toSection(row) : null;
}
