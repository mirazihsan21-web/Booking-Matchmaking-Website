import type { SupabaseClient } from '@supabase/supabase-js';
import { seatCounts } from '@/lib/open-play/open-play';
import type { Section } from '@/lib/sections/sections';

/** A game on the board: when, where, what, and how full. */
export interface UpcomingGame {
  id: string;
  sectionId: string;
  startsAt: string;
  endsAt: string;
  /** Null when players choose at the table. */
  activityName: string | null;
  pricePoisha: number;
  left: number;
  total: number;
}

const DAY = 86_400_000;

/**
 * Open and matched games of the brand starting after `now` and before `now + days` (14 by default),
 * soonest first, with their seat counts. Pass the service client: only counts leave the database.
 */
export async function loadComingUp(
  db: SupabaseClient,
  input: { organizationId: string; now?: Date; days?: number },
): Promise<UpcomingGame[]> {
  const now = input.now ?? new Date();
  const { data, error } = await db
    .from('open_play_sessions')
    .select('id, section_id, starts_at, ends_at, seat_price_poisha, activities(name)')
    .eq('organization_id', input.organizationId)
    .in('status', ['open', 'matched'])
    .gt('starts_at', now.toISOString())
    .lt('starts_at', new Date(now.getTime() + (input.days ?? 14) * DAY).toISOString())
    .order('starts_at')
    .order('id');
  if (error) throw error;
  const rows = data as unknown as Array<{
    id: string;
    section_id: string;
    starts_at: string;
    ends_at: string;
    seat_price_poisha: number;
    activities: { name: string } | null;
  }>;
  const counts = await seatCounts(db, { organizationId: input.organizationId, sessionIds: rows.map((r) => r.id) });
  return rows.map((r) => ({
    id: r.id,
    sectionId: r.section_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    activityName: r.activities?.name ?? null,
    pricePoisha: r.seat_price_poisha,
    left: counts.get(r.id)?.left ?? 0,
    total: counts.get(r.id)?.total ?? 0,
  }));
}

/** The brand's section at this address (its slug), or null. */
export function findSection(sections: Section[], slug: string): Section | null {
  return sections.find((s) => s.slug === slug) ?? null;
}
