import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrganization } from '@/lib/orgs/create-organization';
import { DEFAULT_OPENING_HOURS } from '@/lib/opening-hours';
import { cancelOpenPlay, scheduleOpenPlay } from '@/lib/schedule/schedule';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

const db = serviceDb();
let owner: TestUser;
let orgId: string;
let branchId: string;
let pitch1: string;
let fiveASide: string;

const base = () => ({
  organizationId: orgId,
  branchId,
  activityId: fiveASide,
  resourceIds: [pitch1],
  durationMin: 60,
  seatPricePoisha: 30000,
  timeZone: 'Asia/Dhaka',
  openingHours: DEFAULT_OPENING_HOURS,
});

async function sessionCount(): Promise<number> {
  const { count } = await db.from('open_play_sessions').select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
  return count ?? 0;
}

beforeAll(async () => {
  owner = await createTestUser(db);
  const created = await createOrganization(db, { userId: owner.id, businessType: 'turf', name: 'Schedule Turf', slug: `sched-${randomUUID().slice(0, 6)}` });
  if (created.status !== 'created') throw new Error(created.status);
  orgId = created.organizationId;
  branchId = (await db.from('branches').select('id').eq('organization_id', orgId).single()).data!.id;
  pitch1 = (await db.from('resources').select('id').eq('organization_id', orgId).eq('name', 'Pitch 1').single()).data!.id;
  fiveASide = (await db.from('activities').select('id').eq('organization_id', orgId).eq('name', '5-a-side futsal').single()).data!.id;
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  await deleteTestUser(db, owner.id);
});

describe('scheduleOpenPlay (Review Focus 4)', () => {
  it('schedules 4 weekly 5-a-side matches on Pitch 1', async () => {
    const result = await scheduleOpenPlay(db, { ...base(), first: { date: '2027-01-01', time: '20:00' }, weeks: 4 });
    expect(result.status).toBe('scheduled');
    if (result.status === 'scheduled') expect(result.sessionIds).toHaveLength(4);
    expect(await sessionCount()).toBe(4);
  });

  it('a clash in week 3 schedules nothing and names that week', async () => {
    await db.from('resource_reservations').insert({
      organization_id: orgId,
      resource_id: pitch1,
      period: '[2027-03-19 14:30:00+00,2027-03-19 15:30:00+00)', // Fri 19 Mar 2027, 20:30–21:30 in Dhaka
      source: 'booking',
      source_id: randomUUID(),
    });
    const before = await sessionCount();
    const result = await scheduleOpenPlay(db, { ...base(), first: { date: '2027-03-05', time: '20:00' }, weeks: 4 });
    expect(result).toEqual({ status: 'clash', at: 'Fri 19 Mar, 8pm' });
    expect(await sessionCount()).toBe(before);
  });

  it('refuses times outside opening hours before touching the database', async () => {
    const before = await sessionCount();
    const result = await scheduleOpenPlay(db, { ...base(), first: { date: '2027-04-02', time: '22:30' }, weeks: 2 });
    expect(result).toEqual({ status: 'outside_hours', at: 'Fri 2 Apr, 10:30pm' });
    expect(await sessionCount()).toBe(before);
  });

  it('allows back-to-back matches', async () => {
    const result = await scheduleOpenPlay(db, { ...base(), first: { date: '2027-01-01', time: '21:00' }, weeks: 1 });
    expect(result.status).toBe('scheduled');
  });

  it('reports another venue’s resource as invalid', async () => {
    const result = await scheduleOpenPlay(db, { ...base(), resourceIds: [randomUUID()], first: { date: '2027-05-07', time: '20:00' }, weeks: 1 });
    expect(result).toEqual({ status: 'invalid' });
  });

  it('cancelling frees the slot', async () => {
    const first = await scheduleOpenPlay(db, { ...base(), first: { date: '2027-06-04', time: '18:00' }, weeks: 1 });
    if (first.status !== 'scheduled') throw new Error(first.status);
    expect(await cancelOpenPlay(db, first.sessionIds[0]!)).toBe('cancelled');
    const again = await scheduleOpenPlay(db, { ...base(), first: { date: '2027-06-04', time: '18:00' }, weeks: 1 });
    expect(again.status).toBe('scheduled');
  });
});
