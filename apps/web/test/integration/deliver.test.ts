import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmailSender, type EmailMessage, type EmailSender } from '@/lib/email/sender';
import { deliverPendingEmails } from '@/lib/notifications/deliver';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

// deliverPendingEmails claims every pending row in the database, so assertions look only at this
// file's rows and recipients.
const db = serviceDb();
let orgId: string;
let slug: string;
let keen: TestUser;
let quiet: TestUser;
let keenProfile: string;
let quietProfile: string;

function recordingSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { sent, send: async (message) => void sent.push(message) };
}
const failingSender: EmailSender = { send: async () => Promise.reject(new Error('SMTP down')) };

async function pending(profileId: string): Promise<string> {
  const { data, error } = await db
    .from('notifications')
    .insert({
      organization_id: orgId,
      profile_id: profileId,
      kind: 'booking_confirmed',
      payload: { resource_name: 'Pitch 1', starts_at: '2026-10-23T14:00:00Z', ends_at: '2026-10-23T15:00:00Z', price_poisha: 250000 },
      link: '/me/bookings',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function emailState(id: string) {
  const { data } = await db.from('notifications').select('email_status, email_attempts').eq('id', id).single();
  return data!;
}

beforeAll(async () => {
  keen = await createTestUser(db);
  quiet = await createTestUser(db);
  slug = `dlv-${randomUUID().slice(0, 8)}`;
  const { data: org, error } = await db.from('organizations').insert({ slug, name: 'Deliver Turf', business_type: 'turf', status: 'live' }).select('id').single();
  if (error) throw error;
  orgId = org.id;
  const { data: profiles, error: profileError } = await db
    .from('player_profiles')
    .insert([
      { organization_id: orgId, user_id: keen.id, display_name: 'Keen', skill: 3, email_opt_in: true },
      { organization_id: orgId, user_id: quiet.id, display_name: 'Quiet', skill: 3, email_opt_in: false },
    ])
    .select('id, user_id');
  if (profileError) throw profileError;
  keenProfile = profiles.find((p) => p.user_id === keen.id)!.id;
  quietProfile = profiles.find((p) => p.user_id === quiet.id)!.id;
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  await deleteTestUser(db, keen.id);
  await deleteTestUser(db, quiet.id);
});

describe('deliverPendingEmails', () => {
  it('emails a pending notification once and marks it sent', async () => {
    const id = await pending(keenProfile);
    const sender = recordingSender();
    await deliverPendingEmails(db, sender, { limit: 50 });

    const mine = sender.sent.filter((m) => m.to === keen.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toBe('Deliver Turf: Booking confirmed');
    expect(mine[0]!.html).toContain(`http://${slug}.localhost:3000/me/bookings`);
    expect(await emailState(id)).toEqual({ email_status: 'sent', email_attempts: 1 });
  });

  it('skips players who opted out of email', async () => {
    const id = await pending(quietProfile);
    const sender = recordingSender();
    await deliverPendingEmails(db, sender, { limit: 50 });
    expect(sender.sent.filter((m) => m.to === quiet.email)).toHaveLength(0);
    expect((await emailState(id)).email_status).toBe('skipped');
  });

  it('retries a failed send, then gives up after three attempts', async () => {
    const id = await pending(keenProfile);
    await deliverPendingEmails(db, failingSender, { limit: 50 });
    expect(await emailState(id)).toEqual({ email_status: 'pending', email_attempts: 1 });
    await deliverPendingEmails(db, failingSender, { limit: 50 });
    await deliverPendingEmails(db, failingSender, { limit: 50 });
    expect(await emailState(id)).toEqual({ email_status: 'failed', email_attempts: 3 });
  });

  it('sends each email once even when two runs overlap', async () => {
    const id = await pending(keenProfile);
    const sender = recordingSender();
    await Promise.all([deliverPendingEmails(db, sender, { limit: 50 }), deliverPendingEmails(db, sender, { limit: 50 })]);
    expect(sender.sent.filter((m) => m.to === keen.email)).toHaveLength(1);
    expect((await emailState(id)).email_status).toBe('sent');
  });

  it('really delivers over SMTP (Mailpit locally)', async () => {
    await pending(keenProfile);
    const smtp = createEmailSender({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325', EMAIL_FROM: 'Test <t@localhost>' });
    await deliverPendingEmails(db, smtp, { limit: 50 });

    const mailpit = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
    let subjects: string[] = [];
    for (let attempt = 0; attempt < 20 && subjects.length === 0; attempt++) {
      const list = (await (await fetch(`${mailpit}/api/v1/messages`)).json()) as {
        messages: Array<{ Subject: string; To: Array<{ Address: string }> }>;
      };
      subjects = list.messages.filter((m) => m.To.some((t) => t.Address === keen.email)).map((m) => m.Subject);
      if (subjects.length === 0) await new Promise((r) => setTimeout(r, 250));
    }
    expect(subjects).toContain('Deliver Turf: Booking confirmed');
  });
});
