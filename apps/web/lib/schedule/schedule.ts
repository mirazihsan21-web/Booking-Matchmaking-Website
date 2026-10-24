import type { SupabaseClient } from '@supabase/supabase-js';
import { formatNight } from '@/lib/format';
import type { OpeningHours } from '@/lib/opening-hours';
import { weeklyStarts, withinOpeningHours } from './time';

export interface ScheduleInput {
  organizationId: string;
  sectionId: string;
  activityId: string | null;
  resourceIds: string[];
  first: { date: string; time: string };
  weeks: number;
  durationMin: number;
  seatPricePoisha: number;
  timeZone: string;
  openingHours: OpeningHours;
}

export type ScheduleResult =
  | { status: 'scheduled'; sessionIds: string[] }
  | { status: 'outside_hours'; at: string }
  | { status: 'clash'; at: string }
  | { status: 'invalid' };

const INVALID = new Set(['invalid_reference', 'no_resources', 'no_starts']);

/**
 * Schedules one open-play session per week (all-or-nothing, via the schedule_open_play RPC).
 * Opening hours are checked first, so an out-of-hours request never touches the database; a clash
 * with already-reserved time is reported as the first week that collides.
 */
export async function scheduleOpenPlay(db: SupabaseClient, input: ScheduleInput): Promise<ScheduleResult> {
  const starts = weeklyStarts(input.first, input.weeks, input.timeZone);
  const outside = starts.find((s) => !withinOpeningHours(input.openingHours, s, input.durationMin, input.timeZone));
  if (outside) return { status: 'outside_hours', at: formatNight(outside.toISOString(), input.timeZone) };

  const { data, error } = await db.rpc('schedule_open_play', {
    p_organization_id: input.organizationId,
    p_section_id: input.sectionId,
    p_activity_id: input.activityId,
    p_resource_ids: input.resourceIds,
    p_starts_at: starts.map((s) => s.toISOString()),
    p_duration_min: input.durationMin,
    p_seat_price_poisha: input.seatPricePoisha,
  });
  if (!error) return { status: 'scheduled', sessionIds: data as string[] };
  if (error.code === 'P0001' && INVALID.has(error.message)) return { status: 'invalid' };
  if (error.code === '22P02') return { status: 'invalid' }; // a malformed id
  if (error.code !== '23P01') throw error;

  for (const start of starts) {
    const end = new Date(start.getTime() + input.durationMin * 60_000);
    const { data: overlap } = await db
      .from('resource_reservations')
      .select('id')
      .in('resource_id', input.resourceIds)
      .overlaps('period', `[${start.toISOString()},${end.toISOString()})`)
      .limit(1);
    if (overlap?.length) return { status: 'clash', at: formatNight(start.toISOString(), input.timeZone) };
  }
  return { status: 'clash', at: formatNight(starts[0]!.toISOString(), input.timeZone) };
}

export async function cancelOpenPlay(db: SupabaseClient, sessionId: string): Promise<'cancelled' | 'not_open' | 'not_found'> {
  const { data, error } = await db.rpc('cancel_open_play_session', { p_session_id: sessionId });
  if (error) throw error;
  return data as 'cancelled' | 'not_open' | 'not_found';
}
