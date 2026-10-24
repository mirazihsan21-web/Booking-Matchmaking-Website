import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpeningHours } from '@/lib/opening-hours';
import { businessDaySlots, businessDayWindow, checkBookingStart, slotStates, type Slot, type SlotState } from './slots';

/**
 * Whole-space bookings for players (tenant site) and staff (manage). Pass the service client: callers
 * have already checked who is asking. The clock- and calendar-based rules live here (via slots.ts);
 * overlaps, the booking limit and the notifications live in the SQL functions (spec §3).
 */

export type BookSpaceInput = {
  organizationId: string;
  resourceId: string;
  startsAt: Date;
  slots: number;
  who: { profileId: string } | { guestName: string; guestPhone: string };
  createdBy: string;
  actor: 'player' | 'staff';
  now?: Date;
};

export type BookSpaceResult =
  | { status: 'booked'; bookingId: string }
  | { status: 'taken' }
  | { status: 'already_yours' }
  | { status: 'limit_reached' }
  | { status: 'invalid'; reason: 'not_bookable' | 'bad_count' | 'past' | 'off_grid' | 'outside_hours' | 'beyond_horizon' };

/** A booking as staff see it: a player's display name (no phone), or a walk-in's name and phone. */
export interface SlotBooking {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  start: Date;
  end: Date;
}

export interface SpaceDay {
  resource: { id: string; name: string; slotMinutes: number; pricePerHourPoisha: number | null; active: boolean };
  /** `bookings` (staff only) lists every booking overlapping the slot. */
  slots: Array<Slot & { state: SlotState; bookings?: SlotBooking[] }>;
  /** Staff only: bookings on this business day that no current slot covers (hours changed, day closed). */
  extra?: SlotBooking[];
}

export interface MyBooking {
  id: string;
  resourceName: string;
  sectionName: string;
  startsAt: string;
  endsAt: string;
  pricePoisha: number;
  status: string;
  cancellable: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGE_BOUND = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?/;

/** A Postgres tstzrange as PostgREST returns it, e.g. `["2026-10-23 14:00:00+00","2026-10-23 15:00:00+00")`. */
export function parseTstzRange(value: string): { start: Date; end: Date } {
  const [lower, upper] = value.slice(1, -1).split(',').map((bound) => {
    const match = RANGE_BOUND.exec(bound);
    if (!match) throw new Error(`Unexpected range bound: ${bound}`);
    return new Date(`${match[1]}T${match[2]}${match[3]}:${match[4] ?? '00'}`);
  });
  return { start: lower!, end: upper! };
}

const asRange = (from: Date, to: Date) => `[${from.toISOString()},${to.toISOString()})`;

interface Venue {
  status: string;
  timezone: string;
}

async function loadVenue(db: SupabaseClient, organizationId: string): Promise<Venue | null> {
  if (!UUID.test(organizationId)) return null;
  const { data } = await db.from('organizations').select('status, timezone').eq('id', organizationId).maybeSingle();
  return data ? { status: data.status, timezone: data.timezone } : null;
}

interface Space {
  id: string;
  name: string;
  slotMinutes: number;
  pricePerHourPoisha: number | null;
  active: boolean;
  /** The space's section: its hours and booking rules apply. */
  hours: OpeningHours;
  bookingHorizonDays: number;
  cancelCutoffMinutes: number;
}

async function loadSpace(db: SupabaseClient, organizationId: string, resourceId: string): Promise<Space | null> {
  if (!UUID.test(resourceId)) return null;
  const { data } = await db
    .from('resources')
    .select('id, name, slot_minutes, price_per_hour_poisha, active, sections(opening_hours, booking_horizon_days, cancel_cutoff_minutes)')
    .eq('id', resourceId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!data) return null;
  const section = data.sections as unknown as { opening_hours: OpeningHours; booking_horizon_days: number; cancel_cutoff_minutes: number } | null;
  return {
    id: data.id,
    name: data.name,
    slotMinutes: data.slot_minutes,
    pricePerHourPoisha: data.price_per_hour_poisha,
    active: data.active,
    hours: section?.opening_hours ?? ({} as OpeningHours),
    bookingHorizonDays: section?.booking_horizon_days ?? 0,
    cancelCutoffMinutes: section?.cancel_cutoff_minutes ?? 0,
  };
}

export async function bookSpace(db: SupabaseClient, input: BookSpaceInput): Promise<BookSpaceResult> {
  const now = input.now ?? new Date();
  const [venue, space] = await Promise.all([loadVenue(db, input.organizationId), loadSpace(db, input.organizationId, input.resourceId)]);
  if (!venue || venue.status !== 'live' || !space || !space.active) return { status: 'invalid', reason: 'not_bookable' };

  const check = checkBookingStart({
    hours: space.hours,
    slotMinutes: space.slotMinutes,
    timeZone: venue.timezone,
    startsAt: input.startsAt,
    slots: input.slots,
    now,
    horizonDays: input.actor === 'staff' ? null : space.bookingHorizonDays,
    allowInProgress: input.actor === 'staff', // a walk-in for the slot that is on now
  });
  if (!check.ok) return { status: 'invalid', reason: check.reason };

  const profileId = 'profileId' in input.who ? input.who.profileId : null;
  const guest = 'guestName' in input.who ? input.who : null;
  const { data, error } = await db.rpc('book_resource', {
    p_organization_id: input.organizationId,
    p_resource_id: input.resourceId,
    p_starts_at: input.startsAt.toISOString(),
    p_slots: input.slots,
    p_profile_id: profileId,
    p_guest_name: guest?.guestName ?? null,
    p_guest_phone: guest?.guestPhone ?? null,
    p_created_by: input.createdBy,
  });
  if (error) throw error;
  const row = (data as Array<{ status: string; booking_id: string | null }>)[0]!;

  if (row.status === 'booked') return { status: 'booked', bookingId: row.booking_id! };
  if (row.status === 'limit_reached') return { status: 'limit_reached' };
  if (row.status === 'taken') {
    if (profileId) {
      // A double click: the slot is "taken" by this player's own booking.
      const { count } = await db
        .from('resource_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId)
        .eq('resource_id', input.resourceId)
        .eq('status', 'confirmed')
        .overlaps('period', asRange(input.startsAt, check.endsAt));
      if ((count ?? 0) > 0) return { status: 'already_yours' };
    }
    return { status: 'taken' };
  }
  return { status: 'invalid', reason: 'not_bookable' };
}

export async function cancelSpaceBooking(
  db: SupabaseClient,
  input: { organizationId: string; bookingId: string; actor: { kind: 'player'; profileId: string } | { kind: 'staff' }; cancelledBy: string; now?: Date },
): Promise<'cancelled' | 'too_late' | 'not_cancellable' | 'not_found'> {
  if (!UUID.test(input.bookingId)) return 'not_found';
  const { data: booking } = await db
    .from('resource_bookings')
    .select('profile_id, period, status, resources(sections(cancel_cutoff_minutes))')
    .eq('id', input.bookingId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (!booking) return 'not_found';
  if (input.actor.kind === 'player' && booking.profile_id !== input.actor.profileId) return 'not_found';
  if (booking.status !== 'confirmed') return 'not_cancellable';

  const { start, end } = parseTstzRange(booking.period);
  const now = input.now ?? new Date();
  // Nobody cancels a booking that has already ended (staff mark attendance instead).
  if (now >= end) return 'too_late';
  if (input.actor.kind === 'player') {
    const cutoff = (booking.resources as unknown as { sections: { cancel_cutoff_minutes: number } | null } | null)?.sections?.cancel_cutoff_minutes;
    if (cutoff === undefined || now.getTime() >= start.getTime() - cutoff * 60_000) return 'too_late';
  }

  const { data, error } = await db.rpc('cancel_resource_booking', { p_booking_id: input.bookingId, p_cancelled_by: input.cancelledBy });
  if (error) throw error;
  return data as 'cancelled' | 'not_cancellable' | 'not_found';
}

export async function setSpaceBookingStatus(
  db: SupabaseClient,
  input: { organizationId: string; bookingId: string; status: 'attended' | 'no_show' },
): Promise<'updated' | 'not_started' | 'invalid' | 'not_found'> {
  if (!UUID.test(input.bookingId)) return 'not_found';
  const { data: booking } = await db.from('resource_bookings').select('id').eq('id', input.bookingId).eq('organization_id', input.organizationId).maybeSingle();
  if (!booking) return 'not_found';
  const { data, error } = await db.rpc('set_resource_booking_status', { p_booking_id: input.bookingId, p_status: input.status });
  if (error) throw error;
  return data as 'updated' | 'not_started' | 'invalid' | 'not_found';
}

/**
 * One space's slots on a business day, each with its state. `withNames` (staff only) attaches who
 * booked: a player's display name, or a walk-in's name and phone. Players never see either.
 * Staff get every booking of the business day (see businessDayWindow), so bookings made before the
 * slot length or opening hours changed — or on a day that is now closed — are never hidden.
 * Returns null for a space outside the organization, or a malformed id.
 */
export async function spaceDay(
  db: SupabaseClient,
  input: { organizationId: string; resourceId: string; date: string; withNames: boolean; now?: Date },
): Promise<SpaceDay | null> {
  const [venue, space] = await Promise.all([loadVenue(db, input.organizationId), loadSpace(db, input.organizationId, input.resourceId)]);
  if (!venue || !space) return null;
  const grid = businessDaySlots(space.hours, input.date, space.slotMinutes, venue.timezone);
  const resource = { id: space.id, name: space.name, slotMinutes: space.slotMinutes, pricePerHourPoisha: space.pricePerHourPoisha, active: space.active };

  let slots: SpaceDay['slots'] = [];
  if (grid.length > 0) {
    const { data: reservations, error } = await db
      .from('resource_reservations')
      .select('period, source')
      .eq('resource_id', space.id)
      .eq('organization_id', input.organizationId)
      .overlaps('period', asRange(grid[0]!.start, grid.at(-1)!.end));
    if (error) throw error;
    const busy = reservations.map((r) => ({ ...parseTstzRange(r.period), source: r.source as 'booking' | 'session' }));
    slots = slotStates(grid, busy, input.now ?? new Date());
  }
  if (!input.withNames) return { resource, slots };

  // Every booking that starts within this business day, whatever the grid looks like now.
  const day = businessDayWindow(space.hours, input.date, venue.timezone);
  const { data: bookings, error: bookingsError } = await db
    .from('resource_bookings')
    .select('id, period, status, guest_name, guest_phone, player_profiles(display_name)')
    .eq('resource_id', space.id)
    .eq('organization_id', input.organizationId)
    .neq('status', 'cancelled')
    .overlaps('period', asRange(day.start, day.end));
  if (bookingsError) throw bookingsError;
  const named: SlotBooking[] = bookings
    .map((b) => {
      const profile = b.player_profiles as unknown as { display_name: string } | null;
      return { ...parseTstzRange(b.period), id: b.id, name: profile?.display_name ?? b.guest_name ?? '', phone: profile ? null : b.guest_phone, status: b.status };
    })
    .filter((b) => b.start >= day.start && b.start < day.end)
    .sort((x, y) => x.start.getTime() - y.start.getTime());
  const overlaps = (b: SlotBooking, slot: Slot) => b.start < slot.end && b.end > slot.start;
  return {
    resource,
    slots: slots.map((slot) => ({ ...slot, bookings: named.filter((b) => overlaps(b, slot)) })),
    extra: named.filter((b) => !slots.some((slot) => overlaps(b, slot))),
  };
}

/**
 * The staff day view of a section: every active space, plus any inactive space that still has bookings
 * that day (so staff can cancel them). Names included. Null for another brand's section.
 */
export async function sectionDay(
  db: SupabaseClient,
  input: { organizationId: string; sectionId: string; date: string; now?: Date },
): Promise<SpaceDay[] | null> {
  if (!UUID.test(input.sectionId)) return null;
  const { data: section } = await db.from('sections').select('id').eq('id', input.sectionId).eq('organization_id', input.organizationId).maybeSingle();
  if (!section) return null;
  const { data: spaces, error } = await db
    .from('resources')
    .select('id')
    .eq('section_id', input.sectionId)
    .eq('organization_id', input.organizationId)
    .order('name');
  if (error) throw error;
  const days = await Promise.all(
    spaces.map((s) => spaceDay(db, { organizationId: input.organizationId, resourceId: s.id, date: input.date, withNames: true, now: input.now })),
  );
  const hasBookings = (d: SpaceDay) => (d.extra?.length ?? 0) > 0 || d.slots.some((slot) => (slot.bookings?.length ?? 0) > 0);
  return days.filter((d): d is SpaceDay => d !== null && (d.resource.active || hasBookings(d)));
}

/** A player's bookings at one venue: upcoming (confirmed, not yet ended) soonest first; the rest newest first. */
export async function listMyBookings(
  db: SupabaseClient,
  input: { organizationId: string; profileId: string; now?: Date },
): Promise<{ upcoming: MyBooking[]; past: MyBooking[] }> {
  const now = input.now ?? new Date();
  const { data, error } = await db
    .from('resource_bookings')
    .select('id, period, price_poisha, status, resources(name, sections(name, cancel_cutoff_minutes))')
    .eq('profile_id', input.profileId)
    .eq('organization_id', input.organizationId);
  if (error) throw error;
  const all = data.map((b) => {
    const { start, end } = parseTstzRange(b.period);
    const resource = b.resources as unknown as { name: string; sections: { name: string; cancel_cutoff_minutes: number } | null } | null;
    const cutoff = (resource?.sections?.cancel_cutoff_minutes ?? 0) * 60_000;
    return {
      id: b.id,
      resourceName: resource?.name ?? '',
      sectionName: resource?.sections?.name ?? '',
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      pricePoisha: b.price_poisha,
      status: b.status,
      cancellable: b.status === 'confirmed' && now.getTime() < start.getTime() - cutoff,
      ended: end <= now,
    };
  });
  const strip = ({ ended: _ended, ...rest }: (typeof all)[number]): MyBooking => rest;
  const upcoming = all.filter((b) => b.status === 'confirmed' && !b.ended).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
  const past = all.filter((b) => !(b.status === 'confirmed' && !b.ended)).sort((x, y) => y.startsAt.localeCompare(x.startsAt));
  return { upcoming: upcoming.map(strip), past: past.map(strip) };
}
