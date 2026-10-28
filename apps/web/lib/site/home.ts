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

/** What the landing page says about a section: its active spaces, its lowest hourly price (null = priced at the venue), its top games. */
export interface SectionFacts {
  spaces: number;
  fromPoisha: number | null;
  games: string[];
}

/** Facts for every section of a brand, by section id. Games are the four most popular active ones. */
export async function loadSectionFacts(db: SupabaseClient, organizationId: string): Promise<Map<string, SectionFacts>> {
  const [spaces, games] = await Promise.all([
    db.from('resources').select('section_id, price_per_hour_poisha').eq('organization_id', organizationId).eq('active', true),
    db
      .from('activities')
      .select('section_id, name')
      .eq('organization_id', organizationId)
      .eq('active', true)
      .order('popularity', { ascending: false })
      .order('name'),
  ]);
  if (spaces.error) throw spaces.error;
  if (games.error) throw games.error;
  const facts = new Map<string, SectionFacts>();
  const of = (sectionId: string) => facts.get(sectionId) ?? facts.set(sectionId, { spaces: 0, fromPoisha: null, games: [] }).get(sectionId)!;
  for (const r of spaces.data) {
    const f = of(r.section_id);
    f.spaces += 1;
    if (r.price_per_hour_poisha !== null) f.fromPoisha = f.fromPoisha === null ? r.price_per_hour_poisha : Math.min(f.fromPoisha, r.price_per_hour_poisha);
  }
  for (const a of games.data) {
    const f = of(a.section_id);
    if (f.games.length < 4) f.games.push(a.name);
  }
  return facts;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The section an old venue booking link (`/book?section=<id>&resource=<id>&date=…`) meant: its space's
 * section, else its section, else null. Only this brand's rows count.
 */
export async function oldBookSection(db: SupabaseClient, organizationId: string, query: URLSearchParams): Promise<string | null> {
  const resource = query.get('resource');
  if (resource && UUID.test(resource)) {
    const { data, error } = await db.from('resources').select('sections(slug)').eq('id', resource).eq('organization_id', organizationId).maybeSingle();
    if (error) throw error;
    const slug = (data?.sections as unknown as { slug: string } | null)?.slug;
    if (slug) return slug;
  }
  const section = query.get('section');
  if (section && UUID.test(section)) {
    const { data, error } = await db.from('sections').select('slug').eq('id', section).eq('organization_id', organizationId).maybeSingle();
    if (error) throw error;
    if (data) return data.slug;
  }
  return null;
}
