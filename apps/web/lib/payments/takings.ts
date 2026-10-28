import type { SupabaseClient } from '@supabase/supabase-js';
import { parseTstzRange } from '@/lib/bookings/bookings';
import { addDays, businessDayWindow } from '@/lib/bookings/slots';
import { loadSections, type Section } from '@/lib/sections/sections';

/** One section's day: space bookings and game seats that start that business day (not cancelled), who came, and the cash taken. */
export interface TakingsRow {
  sectionId: string;
  bookings: number;
  seats: number;
  arrived: number;
  noShows: number;
  cashPoisha: number;
}

type Totals = Omit<TakingsRow, 'sectionId'>;
type Timed = { sectionId: string; start: Date; status: string };

/**
 * Sorts a day's rows into its sections. Each section uses its own business day (a lounge open till 02:00
 * counts a 01:00 payment toward the night before); `payments` are live ones only.
 */
export function takingsFromRows(input: {
  sections: Array<Pick<Section, 'id' | 'openingHours'>>;
  date: string;
  timeZone: string;
  spaceBookings: Timed[];
  seats: Timed[];
  payments: Array<{ sectionId: string; takenAt: Date; amountPoisha: number }>;
}): { rows: TakingsRow[]; total: Totals } {
  const rows = input.sections.map((section): TakingsRow => {
    const { start, end } = businessDayWindow(section.openingHours, input.date, input.timeZone);
    const within = (t: Date) => t >= start && t < end;
    const counted = (list: Timed[]) => list.filter((b) => b.sectionId === section.id && within(b.start) && b.status !== 'cancelled');
    const bookings = counted(input.spaceBookings);
    const seats = counted(input.seats);
    const both = [...bookings, ...seats];
    return {
      sectionId: section.id,
      bookings: bookings.length,
      seats: seats.length,
      arrived: both.filter((b) => b.status === 'attended').length,
      noShows: both.filter((b) => b.status === 'no_show').length,
      cashPoisha: input.payments.filter((p) => p.sectionId === section.id && within(p.takenAt)).reduce((sum, p) => sum + p.amountPoisha, 0),
    };
  });
  const total = rows.reduce<Totals>(
    (t, r) => ({ bookings: t.bookings + r.bookings, seats: t.seats + r.seats, arrived: t.arrived + r.arrived, noShows: t.noShows + r.noShows, cashPoisha: t.cashPoisha + r.cashPoisha }),
    { bookings: 0, seats: 0, arrived: 0, noShows: 0, cashPoisha: 0 },
  );
  return { rows, total };
}

/** A business day's takings for the whole brand, one row per section (owner only: uses the service client). */
export async function takingsDay(
  db: SupabaseClient,
  input: { organizationId: string; date: string; timeZone: string },
): Promise<{ rows: TakingsRow[]; total: Totals }> {
  const sections = await loadSections(db, input.organizationId);
  const windows = sections.map((s) => businessDayWindow(s.openingHours, input.date, input.timeZone));
  if (windows.length === 0) return takingsFromRows({ ...input, sections, spaceBookings: [], seats: [], payments: [] });
  const from = new Date(Math.min(...windows.map((w) => w.start.getTime()))).toISOString();
  const to = new Date(Math.max(...windows.map((w) => w.end.getTime()))).toISOString();

  const [spaces, sessions, payments] = await Promise.all([
    db.from('resource_bookings').select('period, status, resources!inner(section_id)').eq('organization_id', input.organizationId).overlaps('period', `[${from},${to})`),
    db.from('open_play_sessions').select('id, section_id, starts_at').eq('organization_id', input.organizationId).gte('starts_at', from).lt('starts_at', to),
    db.from('payments').select('section_id, taken_at, amount_poisha').eq('organization_id', input.organizationId).is('voided_at', null).gte('taken_at', from).lt('taken_at', to),
  ]);
  for (const r of [spaces, sessions, payments]) if (r.error) throw r.error;
  const sessionOf = new Map((sessions.data ?? []).map((s) => [s.id as string, { sectionId: s.section_id as string, start: new Date(s.starts_at as string) }]));
  const seatRows = sessionOf.size
    ? await db.from('bookings').select('session_id, status').in('session_id', [...sessionOf.keys()])
    : { data: [], error: null };
  if (seatRows.error) throw seatRows.error;

  return takingsFromRows({
    sections,
    date: input.date,
    timeZone: input.timeZone,
    spaceBookings: (spaces.data ?? []).map((b) => ({
      sectionId: (b.resources as unknown as { section_id: string }).section_id,
      start: parseTstzRange(b.period as string).start,
      status: b.status as string,
    })),
    seats: (seatRows.data ?? []).map((b) => ({ ...sessionOf.get(b.session_id as string)!, status: b.status as string })),
    payments: (payments.data ?? []).map((p) => ({ sectionId: p.section_id as string, takenAt: new Date(p.taken_at as string), amountPoisha: p.amount_poisha as number })),
  });
}

/** The cash taken on each of the seven business days ending `endDate`, newest first. */
export async function takingsWeek(
  db: SupabaseClient,
  input: { organizationId: string; endDate: string; timeZone: string },
): Promise<Array<{ date: string; cashPoisha: number }>> {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(input.endDate, -i));
  const days = await Promise.all(dates.map((date) => takingsDay(db, { organizationId: input.organizationId, date, timeZone: input.timeZone })));
  return dates.map((date, i) => ({ date, cashPoisha: days[i]!.total.cashPoisha }));
}
