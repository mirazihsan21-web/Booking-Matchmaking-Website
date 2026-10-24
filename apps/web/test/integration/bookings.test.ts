import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookSpace, sectionDay, cancelSpaceBooking, listMyBookings, setSpaceBookingStatus, spaceDay } from '@/lib/bookings/bookings';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

// A fresh venue (Dhaka time, defaults: 14-day window, 2-hour cancel cut-off; limit raised to 10 so it
// doesn't interfere). Main branch 10:00–23:00 with Pitch 1 and Pitch 2; Late branch 14:00–02:00 with
// Zone L. "Now" for the TypeScript checks is Tue 20 Oct 2026, 12:00 in Dhaka.
const db = serviceDb();
const now = new Date('2026-10-20T06:00:00Z');
const FRI_8PM = new Date('2026-10-23T14:00:00Z');
const FRI_9PM = new Date('2026-10-23T15:00:00Z');
const hours = (open: string, close: string) => Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, [open, close]]));

let orgId: string;
let otherOrgPitch: string;
let mainBranch: string;
let pitch1: string;
let pitch2: string;
let zoneL: string;
let tableC: string; // in the Café section
const users: TestUser[] = [];
let staffUser: TestUser;
let a: string; // profiles
let b: string;
let aBooking: string;

beforeAll(async () => {
  const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
    if (r.error) throw r.error;
    return r.data as NonNullable<T>; // inserts without .select() return no data; their result is unused
  };
  const [ua, ub, us] = await Promise.all([createTestUser(db), createTestUser(db), createTestUser(db)]);
  users.push(ua, ub, us);
  staffUser = us;
  const org = must(
    await db
      .from('organizations')
      .insert({ slug: `bk-${randomUUID().slice(0, 8)}`, name: 'Booking Turf', business_type: 'turf', status: 'live' })
      .select('id')
      .single(),
  );
  orgId = org.id;
  must(await db.from('organization_members').insert({ organization_id: orgId, user_id: us.id, role: 'staff' }));
  const branches = must(
    await db
      .from('sections')
      .insert([
        { organization_id: orgId, name: 'Main', kind: 'turf', slug: 'main', max_upcoming_bookings: 10, opening_hours: hours('10:00', '23:00') },
        { organization_id: orgId, name: 'Late', kind: 'gaming_lounge', slug: 'late', max_upcoming_bookings: 10, opening_hours: hours('14:00', '02:00') },
        // The café books only 3 days ahead and can be cancelled until 30 minutes before.
        {
          organization_id: orgId,
          name: 'Café',
          kind: 'boardgame_cafe',
          slug: 'cafe',
          max_upcoming_bookings: 10,
          booking_horizon_days: 3,
          cancel_cutoff_minutes: 30,
          opening_hours: hours('10:00', '23:00'),
        },
      ], { defaultToNull: false }) // rows without a rule keep the column default
      .select('id, name'),
  );
  mainBranch = branches.find((x) => x.name === 'Main')!.id;
  const lateBranch = branches.find((x) => x.name === 'Late')!.id;
  const cafe = branches.find((x) => x.name === 'Café')!.id;
  const resources = must(
    await db
      .from('resources')
      .insert([
        { organization_id: orgId, section_id: mainBranch, name: 'Pitch 1', kind: 'pitch', capacity: 14, price_per_hour_poisha: 250000 },
        { organization_id: orgId, section_id: mainBranch, name: 'Pitch 2', kind: 'pitch', capacity: 14, price_per_hour_poisha: 250000 },
        { organization_id: orgId, section_id: lateBranch, name: 'Zone L', kind: 'zone', capacity: 10, price_per_hour_poisha: 150000 },
        { organization_id: orgId, section_id: cafe, name: 'Table C', kind: 'table', capacity: 4, price_per_hour_poisha: 50000 },
      ])
      .select('id, name'),
  );
  pitch1 = resources.find((r) => r.name === 'Pitch 1')!.id;
  pitch2 = resources.find((r) => r.name === 'Pitch 2')!.id;
  zoneL = resources.find((r) => r.name === 'Zone L')!.id;
  tableC = resources.find((r) => r.name === 'Table C')!.id;
  const profiles = must(
    await db
      .from('player_profiles')
      .insert([
        { organization_id: orgId, user_id: ua.id, display_name: 'Ayesha' },
        { organization_id: orgId, user_id: ub.id, display_name: 'Bilal' },
      ])
      .select('id, user_id'),
  );
  a = profiles.find((p) => p.user_id === ua.id)!.id;
  b = profiles.find((p) => p.user_id === ub.id)!.id;

  const other = must(await db.from('organizations').insert({ slug: `bkx-${randomUUID().slice(0, 8)}`, name: 'Other', business_type: 'turf', status: 'live' }).select('id').single());
  const otherBranch = must(await db.from('sections').insert({ organization_id: other.id, name: 'X', kind: 'turf', slug: 'turf' }).select('id').single());
  otherOrgPitch = must(
    await db.from('resources').insert({ organization_id: other.id, section_id: otherBranch.id, name: 'X1', kind: 'pitch', capacity: 14 }).select('id').single(),
  ).id;
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  const { data: x } = await db.from('resources').select('organization_id').eq('id', otherOrgPitch).single();
  if (x) await db.from('organizations').delete().eq('id', x.organization_id);
  for (const u of users) await deleteTestUser(db, u.id);
});

const asPlayer = (profileId: string, userId: string, startsAt: Date, resourceId = pitch1, slots = 1) =>
  bookSpace(db, { organizationId: orgId, resourceId, startsAt, slots, who: { profileId }, createdBy: userId, actor: 'player', now });
const asStaff = (startsAt: Date, resourceId = pitch1, slots = 1) =>
  bookSpace(db, {
    organizationId: orgId,
    resourceId,
    startsAt,
    slots,
    who: { guestName: 'Karim', guestPhone: '+8801712345678' },
    createdBy: staffUser.id,
    actor: 'staff',
    now,
  });

describe('bookSpace', () => {
  it('books a free slot', async () => {
    const result = await asPlayer(a, users[0]!.id, FRI_8PM);
    expect(result.status).toBe('booked');
    if (result.status === 'booked') aBooking = result.bookingId;
  });

  it('tells a second player the slot was taken', async () => {
    expect(await asPlayer(b, users[1]!.id, FRI_8PM)).toEqual({ status: 'taken' });
  });

  it('tells the same player they already have it (double click)', async () => {
    expect(await asPlayer(a, users[0]!.id, FRI_8PM)).toEqual({ status: 'already_yours' });
  });

  it('lets staff book a walk-in', async () => {
    expect((await asStaff(FRI_9PM)).status).toBe('booked');
  });

  it('refuses a start between grid lines', async () => {
    expect(await asPlayer(b, users[1]!.id, new Date('2026-10-23T14:30:00Z'))).toEqual({ status: 'invalid', reason: 'off_grid' });
  });

  it('keeps players inside the booking window but lets staff book further ahead', async () => {
    const far = new Date('2026-11-06T14:00:00Z'); // 17 days out
    expect(await asPlayer(b, users[1]!.id, far)).toEqual({ status: 'invalid', reason: 'beyond_horizon' });
    expect((await asStaff(far)).status).toBe('booked');
  });

  it("uses each section's own booking window", async () => {
    const fiveDaysOn = new Date('2026-10-25T14:00:00Z'); // Sun 8pm
    expect(await asPlayer(b, users[1]!.id, fiveDaysOn, tableC)).toEqual({ status: 'invalid', reason: 'beyond_horizon' }); // café: 3 days
    expect((await asPlayer(b, users[1]!.id, fiveDaysOn, pitch2)).status).toBe('booked'); // turf: 14 days
  });

  it('lets staff record a walk-in for the slot that is on now, but not players', async () => {
    const six = new Date('2026-10-23T12:00:00Z'); // Fri 6pm
    const sixTen = new Date('2026-10-23T12:10:00Z');
    expect(await bookSpace(db, { organizationId: orgId, resourceId: pitch1, startsAt: six, slots: 1, who: { profileId: b }, createdBy: users[1]!.id, actor: 'player', now: sixTen })).toEqual({
      status: 'invalid',
      reason: 'past',
    });
    const walkIn = await bookSpace(db, {
      organizationId: orgId,
      resourceId: pitch1,
      startsAt: six,
      slots: 1,
      who: { guestName: 'Rumi', guestPhone: '+8801912345678' },
      createdBy: staffUser.id,
      actor: 'staff',
      now: sixTen,
    });
    expect(walkIn.status).toBe('booked');
  });

  it("refuses another venue's space", async () => {
    expect(await asPlayer(b, users[1]!.id, FRI_8PM, otherOrgPitch)).toEqual({ status: 'invalid', reason: 'not_bookable' });
  });
});

describe('day views', () => {
  it('shows players what is taken without saying who', async () => {
    const day = await spaceDay(db, { organizationId: orgId, resourceId: pitch1, date: '2026-10-23', withNames: false, now });
    const eight = day!.slots.find((s) => s.start.getTime() === FRI_8PM.getTime())!;
    expect(eight.state).toBe('taken');
    expect(eight.bookings).toBeUndefined();
    expect(day!.slots.every((s) => s.bookings === undefined)).toBe(true);
    expect(day!.extra).toBeUndefined();
  });

  it('shows staff the names, and the phone of a walk-in', async () => {
    const days = await sectionDay(db, { organizationId: orgId, sectionId: mainBranch, date: '2026-10-23', now });
    const pitch = days!.find((d) => d.resource.id === pitch1)!;
    expect(pitch.slots.find((s) => s.start.getTime() === FRI_8PM.getTime())!.bookings).toMatchObject([{ name: 'Ayesha', phone: null }]);
    expect(pitch.slots.find((s) => s.start.getTime() === FRI_9PM.getTime())!.bookings).toMatchObject([{ name: 'Karim', phone: '+8801712345678' }]);
  });

  it("returns nothing for another venue's space or a malformed id (Review Focus 1)", async () => {
    expect(await spaceDay(db, { organizationId: orgId, resourceId: otherOrgPitch, date: '2026-10-23', withNames: false, now })).toBeNull();
    expect(await spaceDay(db, { organizationId: orgId, resourceId: 'not-a-uuid', date: '2026-10-23', withNames: false, now })).toBeNull();
    expect(await sectionDay(db, { organizationId: orgId, sectionId: 'not-a-uuid', date: '2026-10-23', now })).toBeNull();
  });
});

describe('cancelling', () => {
  it('lets a player cancel before the cut-off, but not after', async () => {
    const result = await asPlayer(a, users[0]!.id, new Date('2026-10-23T12:00:00Z'), pitch2); // Fri 6pm
    if (result.status !== 'booked') throw new Error(result.status);
    const id = result.bookingId;
    const at = (h: number) => new Date(new Date('2026-10-23T12:00:00Z').getTime() - h * 3_600_000);
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: id, actor: { kind: 'player', profileId: a }, cancelledBy: users[0]!.id, now: at(1) })).toBe('too_late');
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: id, actor: { kind: 'player', profileId: a }, cancelledBy: users[0]!.id, now: at(3) })).toBe('cancelled');
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: id, actor: { kind: 'player', profileId: a }, cancelledBy: users[0]!.id, now: at(3) })).toBe(
      'not_cancellable',
    ); // second click (Review Focus 5)
  });

  it("uses the booking's own section for the cut-off", async () => {
    const result = await asPlayer(b, users[1]!.id, new Date('2026-10-23T14:00:00Z'), tableC); // Fri 8pm at the café
    if (result.status !== 'booked') throw new Error(result.status);
    const hourBefore = new Date('2026-10-23T13:00:00Z');
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: result.bookingId, actor: { kind: 'player', profileId: b }, cancelledBy: users[1]!.id, now: hourBefore })).toBe(
      'cancelled',
    ); // the café's cut-off is 30 minutes; the turf's 2 hours would refuse
  });

  it("does not let a player cancel someone else's booking", async () => {
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: aBooking, actor: { kind: 'player', profileId: b }, cancelledBy: users[1]!.id, now })).toBe('not_found');
  });

  it('lets staff cancel after the cut-off', async () => {
    const result = await asPlayer(b, users[1]!.id, new Date('2026-10-23T13:00:00Z'), pitch2); // Fri 7pm
    if (result.status !== 'booked') throw new Error(result.status);
    const late = new Date('2026-10-23T12:30:00Z'); // 30 minutes before
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: result.bookingId, actor: { kind: 'staff' }, cancelledBy: staffUser.id, now: late })).toBe('cancelled');
    expect(await setSpaceBookingStatus(db, { organizationId: orgId, bookingId: result.bookingId, status: 'no_show' })).toBe('invalid');
  });

  // Attendance and "has it ended" use the real clock, so these bookings are made relative to it.
  it('marks attendance only once a booking has started, and never cancels one that has ended', async () => {
    const hour = 3_600_000;
    const top = Math.floor(Date.now() / hour) * hour;
    const walkIn = async (start: number) => {
      const { data, error } = await db.rpc('book_resource', {
        p_organization_id: orgId,
        p_resource_id: pitch1,
        p_starts_at: new Date(start).toISOString(),
        p_slots: 1,
        p_profile_id: null,
        p_guest_name: 'Rumi',
        p_guest_phone: '+8801912345678',
        p_created_by: staffUser.id,
      });
      if (error) throw error;
      return (data as Array<{ booking_id: string }>)[0]!.booking_id;
    };
    const future = await walkIn(top + 30 * 24 * hour);
    const started = await walkIn(top - hour); // ends at the top of this hour or later
    const ended = await walkIn(top - 4 * hour);

    expect(await setSpaceBookingStatus(db, { organizationId: orgId, bookingId: future, status: 'attended' })).toBe('not_started');
    expect(await setSpaceBookingStatus(db, { organizationId: orgId, bookingId: started, status: 'attended' })).toBe('updated');
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: ended, actor: { kind: 'staff' }, cancelledBy: staffUser.id })).toBe('too_late');
  });
});

describe('my bookings', () => {
  it('keeps a booking visible and cancellable after its space changes (Review Focus 3)', async () => {
    const result = await asPlayer(b, users[1]!.id, new Date('2026-10-23T10:00:00Z'), pitch2); // Fri 4pm
    if (result.status !== 'booked') throw new Error(result.status);
    await db.from('resources').update({ active: false, slot_minutes: 90 }).eq('id', pitch2);

    const mine = await listMyBookings(db, { organizationId: orgId, profileId: b, now });
    expect(mine.upcoming.find((x) => x.id === result.bookingId)).toMatchObject({ resourceName: 'Pitch 2', cancellable: true });
    const day = await spaceDay(db, { organizationId: orgId, resourceId: pitch2, date: '2026-10-23', withNames: false, now });
    expect(day!.slots.filter((s) => s.state === 'taken').length).toBeGreaterThanOrEqual(1);
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: result.bookingId, actor: { kind: 'player', profileId: b }, cancelledBy: users[1]!.id, now })).toBe(
      'cancelled',
    );
  });

  it('puts a 01:00 booking on the previous business day and in time order (Review Focus 2)', async () => {
    const eleven = await asPlayer(a, users[0]!.id, new Date('2026-10-23T17:00:00Z'), zoneL); // Fri 23:00
    const one = await asPlayer(a, users[0]!.id, new Date('2026-10-23T19:00:00Z'), zoneL); // Sat 01:00, business day Fri
    expect(eleven.status).toBe('booked');
    expect(one.status).toBe('booked');
    const day = await spaceDay(db, { organizationId: orgId, resourceId: zoneL, date: '2026-10-23', withNames: false, now });
    expect(day!.slots.at(-1)!.state).toBe('taken'); // the 01:00–02:00 slot belongs to Friday's grid

    const upcoming = (await listMyBookings(db, { organizationId: orgId, profileId: a, now })).upcoming;
    const order = upcoming.map((x) => x.startsAt);
    expect([...order].sort()).toEqual(order);
    expect(upcoming.find((x) => x.resourceName === 'Zone L')?.sectionName).toBe('Late'); // two branches: each booking says where
  });
});

describe('staff day view keeps every booking (Review Focus 3, staff side)', () => {
  it('shows bookings after the slot length changes, hours shorten, the day closes or the space is deactivated', async () => {
    const { data: created, error } = await db
      .from('resources')
      .insert({ organization_id: orgId, section_id: mainBranch, name: 'Pitch 3', kind: 'pitch', capacity: 14 })
      .select('id')
      .single();
    if (error) throw error;
    const pitch3 = created.id;
    for (const start of [FRI_8PM, FRI_9PM]) expect((await asStaff(start, pitch3)).status).toBe('booked');
    const view = async () => (await sectionDay(db, { organizationId: orgId, sectionId: mainBranch, date: '2026-10-23', now }))!.find((d) => d.resource.id === pitch3)!;
    const { data: branch } = await db.from('sections').select('opening_hours').eq('id', mainBranch).single();
    const hours = branch!.opening_hours as Record<string, unknown>;

    // Two 60-minute bookings under one 120-minute slot: both are listed.
    await db.from('resources').update({ slot_minutes: 120 }).eq('id', pitch3);
    expect((await view()).slots.find((s) => s.start.getTime() === FRI_8PM.getTime())!.bookings).toHaveLength(2);

    // Fridays shortened to 10:00–21:00: the 9pm booking is off the grid but still shown.
    await db.from('resources').update({ slot_minutes: 60 }).eq('id', pitch3);
    await db.from('sections').update({ opening_hours: { ...hours, '5': ['10:00', '21:00'] } }).eq('id', mainBranch);
    expect((await view()).extra!.map((b) => b.start.getTime())).toEqual([FRI_9PM.getTime()]);

    // Closed on Fridays: both bookings are still shown.
    await db.from('sections').update({ opening_hours: { ...hours, '5': null } }).eq('id', mainBranch);
    expect((await view()).extra).toHaveLength(2);

    // The space is deactivated: it stays in the staff view while it has bookings that day.
    await db.from('resources').update({ active: false }).eq('id', pitch3);
    const inactive = await view();
    expect(inactive.resource.active).toBe(false);
    expect(inactive.extra).toHaveLength(2);

    await db.from('sections').update({ opening_hours: hours }).eq('id', mainBranch);
  });
});
