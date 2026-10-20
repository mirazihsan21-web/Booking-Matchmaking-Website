import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailMessage, EmailSender } from '@/lib/email/sender';
import { runTick } from '@/lib/jobs/tick';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

// Tick Turf (default 6-hour match cut-off) with Pitch 1 and 5-a-side; players Tick and T1–T10.
// runTick works on every venue in the database, so assertions look only at this file's rows.
const db = serviceDb();
let orgId: string;
let branchId: string;
let pitchId: string;
let activityId: string;
let player: TestUser;
let profileId: string;
const squad: TestUser[] = [];
const squadProfiles: string[] = [];

function recordingSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { sent, send: async (message) => void sent.push(message) };
}

const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
};
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function session(startsInHours: number, status = 'open'): Promise<string> {
  const row = must(
    await db
      .from('open_play_sessions')
      .insert({ organization_id: orgId, branch_id: branchId, activity_id: activityId, starts_at: inHours(startsInHours), ends_at: inHours(startsInHours + 1), seat_price_poisha: 30000, status })
      .select('id')
      .single(),
  );
  must(await db.from('open_play_session_resources').insert({ organization_id: orgId, session_id: row.id, resource_id: pitchId }));
  return row.id;
}

async function squadRequests(sessionId: string) {
  for (const id of squadProfiles) must(await db.rpc('request_seat', { p_session_id: sessionId, p_profile_id: id }));
}

beforeAll(async () => {
  player = await createTestUser(db);
  for (let i = 0; i < 10; i += 1) squad.push(await createTestUser(db));
  orgId = must(
    await db.from('organizations').insert({ slug: `tick-${randomUUID().slice(0, 8)}`, name: 'Tick Turf', business_type: 'turf', status: 'live' }).select('id').single(),
  ).id;
  branchId = must(await db.from('branches').insert({ organization_id: orgId, name: 'Main' }).select('id').single()).id;
  pitchId = must(await db.from('resources').insert({ organization_id: orgId, branch_id: branchId, name: 'Pitch 1', kind: 'pitch', capacity: 14 }).select('id').single()).id;
  activityId = must(
    await db
      .from('activities')
      .insert({ organization_id: orgId, name: '5-a-side', min_players: 10, max_players: 10, duration_min: 60, team_mode: 'two_teams', team_size: 5 })
      .select('id')
      .single(),
  ).id;
  profileId = must(await db.from('player_profiles').insert({ organization_id: orgId, user_id: player.id, display_name: 'Tick', skill: 3 }).select('id').single()).id;
  const rows = must(
    await db
      .from('player_profiles')
      .insert(squad.map((u, i) => ({ organization_id: orgId, user_id: u.id, display_name: `T${i + 1}`, skill: 1 + (i % 5) })))
      .select('id'),
  );
  squadProfiles.push(...rows.map((r) => r.id));
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  await Promise.all([player, ...squad].map((u) => deleteTestUser(db, u.id)));
});

describe('runTick', () => {
  it('delivers pending emails, and a second tick has nothing left to send', async () => {
    must(
      await db.from('notifications').insert({
        organization_id: orgId,
        profile_id: profileId,
        kind: 'booking_confirmed',
        payload: { resource_name: 'Pitch 1', starts_at: '2026-10-23T14:00:00Z', ends_at: '2026-10-23T15:00:00Z', price_poisha: 250000 },
        link: '/me/bookings',
      }),
    );

    const first = recordingSender();
    const report = await runTick({ db, createSender: () => first });
    expect(first.sent.filter((m) => m.to === player.email)).toHaveLength(1);
    expect('sent' in report.emails && report.emails.sent).toBeGreaterThanOrEqual(1);

    const second = recordingSender();
    await runTick({ db, createSender: () => second });
    expect(second.sent.filter((m) => m.to === player.email)).toHaveLength(0);
  });

  it('matches a session at its cut-off and emails the players in the same tick', async () => {
    const due = await session(3);
    const later = await session(30);
    await squadRequests(due);
    await squadRequests(later);

    const sender = recordingSender();
    const report = await runTick({ db, createSender: () => sender });
    expect(report.matched).toContain(due);
    expect(report.matched).not.toContain(later);
    expect(must(await db.from('open_play_sessions').select('status').eq('id', due).single()).status).toBe('matched');
    const squadEmails = new Set(squad.map((u) => u.email));
    expect(sender.sent.filter((m) => squadEmails.has(m.to) && m.subject === "Tick Turf: You're in!")).toHaveLength(10);
  });

  it('passes an expired offer to the next waiting player in the same tick', async () => {
    const sessionId = await session(48, 'matched');
    const group = must(await db.from('groups').insert({ organization_id: orgId, session_id: sessionId, resource_id: pitchId, activity_id: activityId, capacity: 10 }).select('id').single());
    const entries = must(
      await db
        .from('waitlist_entries')
        .insert([
          { organization_id: orgId, session_id: sessionId, profile_id: squadProfiles[0], queue_position: 1 },
          { organization_id: orgId, session_id: sessionId, profile_id: squadProfiles[1], queue_position: 2 },
        ])
        .select('id, profile_id'),
    );
    const first = entries.find((e) => e.profile_id === squadProfiles[0])!;
    const second = entries.find((e) => e.profile_id === squadProfiles[1])!;
    const offerId = must(await db.rpc('create_offer', { p_group_id: group.id, p_seat_no: 3, p_waitlist_entry_id: first.id }));
    must(await db.from('seat_offers').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', offerId));

    const report = await runTick({ db, createSender: () => recordingSender() });
    expect(report.offers.expired).toBeGreaterThanOrEqual(1);
    expect(report.offers.offered).toBeGreaterThanOrEqual(1);
    expect(must(await db.from('seat_offers').select('status').eq('id', offerId).single()).status).toBe('expired');
    const next = must(await db.from('seat_offers').select('seat_no').eq('waitlist_entry_id', second.id).eq('status', 'pending').single());
    expect(next.seat_no).toBe(3);
  });

  it('closes a session once it has started', async () => {
    const started = await session(-0.1);
    const report = await runTick({ db, createSender: () => recordingSender() });
    expect(report.closed).toBeGreaterThanOrEqual(1);
    expect(must(await db.from('open_play_sessions').select('status').eq('id', started).single()).status).toBe('closed');
  });

  it('keeps matching when email is not configured', async () => {
    const due = await session(2);
    await squadRequests(due);
    const report = await runTick({
      db,
      createSender: () => {
        throw new Error('EMAIL_TRANSPORT is not set');
      },
    });
    expect(report.emails).toEqual({ error: 'EMAIL_TRANSPORT is not set' });
    expect(report.matched).toContain(due);
  });
});
