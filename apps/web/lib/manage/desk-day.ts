import type { SupabaseClient } from '@supabase/supabase-js';
import { sectionDay } from '@/lib/bookings/bookings';
import { businessDayWindow } from '@/lib/bookings/slots';
import { seatCounts } from '@/lib/open-play/open-play';
import { livePayments } from '@/lib/payments/payments';
import { takingsDay } from '@/lib/payments/takings';
import { loadSections, type Section } from '@/lib/sections/sections';
import { deskWindow, freeGaps } from './today';

/** A space booking as the desk sees it: who, when, its state, its price and any cash taken. */
export interface DeskBooking {
  kind: 'space';
  id: string;
  resourceId: string;
  name: string;
  phone: string | null;
  status: string;
  start: Date;
  end: Date;
  pricePoisha: number;
  payment: { id: string; amountPoisha: number } | null;
}

/** A game that day: the spaces it holds and how full it is. `name` is null when players pick the game. */
export interface DeskGame {
  sessionId: string;
  sectionId: string;
  name: string | null;
  start: Date;
  end: Date;
  resourceIds: string[];
  seats: { left: number; total: number };
}

export interface DeskSpace {
  id: string;
  name: string;
  active: boolean;
  bookings: DeskBooking[];
  gaps: Array<{ start: Date; end: Date }>;
}

/**
 * One business day at the desk across the given sections: every space with its bookings (switched-off
 * spaces and closed days included when they have bookings) and free gaps, the games and the spaces they
 * hold, and the day's counts — cash being what was taken that business day in those sections.
 */
export async function loadDeskDay(
  db: SupabaseClient,
  input: { organizationId: string; sectionIds: string[]; date: string; now: Date; timeZone: string },
): Promise<{
  window: { start: Date; end: Date } | null;
  sections: Array<{ section: Section; spaces: DeskSpace[] }>;
  games: DeskGame[];
  counts: { bookings: number; arrived: number; noShows: number; cashPoisha: number };
}> {
  const sections = (await loadSections(db, input.organizationId)).filter((s) => input.sectionIds.includes(s.id));
  const days = await Promise.all(sections.map((s) => sectionDay(db, { organizationId: input.organizationId, sectionId: s.id, date: input.date, now: input.now })));

  const raw = sections.map((section, i) => ({
    section,
    spaces: (days[i] ?? []).map((day) => {
      const seen = new Map<string, Omit<DeskBooking, 'pricePoisha' | 'payment'>>();
      for (const b of [...day.slots.flatMap((slot) => slot.bookings ?? []), ...(day.extra ?? [])]) {
        if (!seen.has(b.id)) seen.set(b.id, { kind: 'space', id: b.id, resourceId: day.resource.id, name: b.name, phone: b.phone, status: b.status, start: b.start, end: b.end });
      }
      return { id: day.resource.id, name: day.resource.name, active: day.resource.active, bookings: [...seen.values()], gaps: day.resource.active ? freeGaps(day.slots, input.now) : [] };
    }),
  }));
  const bookingIds = raw.flatMap((s) => s.spaces.flatMap((sp) => sp.bookings.map((b) => b.id)));
  const [prices, payments] = await Promise.all([
    bookingIds.length ? db.from('resource_bookings').select('id, price_poisha').in('id', bookingIds) : Promise.resolve({ data: [], error: null }),
    livePayments(db, { spaceBookingIds: bookingIds, seatBookingIds: [] }),
  ]);
  if (prices.error) throw prices.error;
  const priceOf = new Map((prices.data ?? []).map((r) => [r.id as string, r.price_poisha as number]));
  const result = raw.map(({ section, spaces }) => ({
    section,
    spaces: spaces.map((sp) => ({
      ...sp,
      bookings: sp.bookings
        .map((b): DeskBooking => ({ ...b, pricePoisha: priceOf.get(b.id) ?? 0, payment: payments.get(b.id) ?? null }))
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    })),
  }));

  const games = await loadGames(db, { organizationId: input.organizationId, sections, date: input.date, timeZone: input.timeZone });
  const bookings = result.flatMap((s) => s.spaces.flatMap((sp) => sp.bookings)).filter((b) => b.status !== 'cancelled');
  const takings = await takingsDay(db, { organizationId: input.organizationId, date: input.date, timeZone: input.timeZone });
  return {
    window: deskWindow(sections, input.date, input.timeZone),
    sections: result,
    games,
    counts: {
      bookings: bookings.length,
      arrived: bookings.filter((b) => b.status === 'attended').length,
      noShows: bookings.filter((b) => b.status === 'no_show').length,
      cashPoisha: takings.rows.filter((r) => input.sectionIds.includes(r.sectionId)).reduce((sum, r) => sum + r.cashPoisha, 0),
    },
  };
}

/** The games starting on each section's business day (not cancelled), with the spaces they reserve and their seats. */
async function loadGames(
  db: SupabaseClient,
  input: { organizationId: string; sections: Section[]; date: string; timeZone: string },
): Promise<DeskGame[]> {
  if (input.sections.length === 0) return [];
  const windows = new Map(input.sections.map((s) => [s.id, businessDayWindow(s.openingHours, input.date, input.timeZone)]));
  const from = new Date(Math.min(...[...windows.values()].map((w) => w.start.getTime()))).toISOString();
  const to = new Date(Math.max(...[...windows.values()].map((w) => w.end.getTime()))).toISOString();
  const { data: sessions, error } = await db
    .from('open_play_sessions')
    .select('id, section_id, starts_at, ends_at, status, activities(name)')
    .eq('organization_id', input.organizationId)
    .in('section_id', [...windows.keys()])
    .neq('status', 'cancelled')
    .gte('starts_at', from)
    .lt('starts_at', to);
  if (error) throw error;
  const inDay = (sessions ?? []).filter((s) => {
    const w = windows.get(s.section_id as string)!;
    const start = new Date(s.starts_at as string);
    return start >= w.start && start < w.end;
  });
  if (inDay.length === 0) return [];
  const sessionIds = inDay.map((s) => s.id as string);
  const [{ data: holds, error: holdError }, seats] = await Promise.all([
    db.from('resource_reservations').select('source_id, resource_id').eq('source', 'session').in('source_id', sessionIds),
    seatCounts(db, { organizationId: input.organizationId, sessionIds }),
  ]);
  if (holdError) throw holdError;
  return inDay
    .map((s) => ({
      sessionId: s.id as string,
      sectionId: s.section_id as string,
      name: (s.activities as unknown as { name: string } | null)?.name ?? null,
      start: new Date(s.starts_at as string),
      end: new Date(s.ends_at as string),
      resourceIds: (holds ?? []).filter((h) => h.source_id === s.id).map((h) => h.resource_id as string),
      seats: seats.get(s.id as string) ?? { left: 0, total: 0 },
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
