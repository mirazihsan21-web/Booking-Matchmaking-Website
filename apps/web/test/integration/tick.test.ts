import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailMessage, EmailSender } from '@/lib/email/sender';
import { runTick } from '@/lib/jobs/tick';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

const db = serviceDb();
let orgId: string;
let player: TestUser;
let profileId: string;

function recordingSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { sent, send: async (message) => void sent.push(message) };
}

beforeAll(async () => {
  player = await createTestUser(db);
  const { data: org, error } = await db
    .from('organizations')
    .insert({ slug: `tick-${randomUUID().slice(0, 8)}`, name: 'Tick Turf', business_type: 'turf', status: 'live' })
    .select('id')
    .single();
  if (error) throw error;
  orgId = org.id;
  const { data: profile, error: profileError } = await db
    .from('player_profiles')
    .insert({ organization_id: orgId, user_id: player.id, display_name: 'Tick', skill: 3 })
    .select('id')
    .single();
  if (profileError) throw profileError;
  profileId = profile.id;
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  await deleteTestUser(db, player.id);
});

describe('runTick', () => {
  it('delivers pending emails, and a second tick has nothing left to send', async () => {
    const { error } = await db.from('notifications').insert({
      organization_id: orgId,
      profile_id: profileId,
      kind: 'booking_confirmed',
      payload: { resource_name: 'Pitch 1', starts_at: '2026-10-23T14:00:00Z', ends_at: '2026-10-23T15:00:00Z', price_poisha: 250000 },
      link: '/me/bookings',
    });
    if (error) throw error;

    const first = recordingSender();
    const report = await runTick({ db, sender: first });
    expect(first.sent.filter((m) => m.to === player.email)).toHaveLength(1);
    expect(report.emails.sent).toBeGreaterThanOrEqual(1);

    const second = recordingSender();
    await runTick({ db, sender: second });
    expect(second.sent.filter((m) => m.to === player.email)).toHaveLength(0);
  });
});
