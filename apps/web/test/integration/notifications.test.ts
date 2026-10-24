import { randomUUID } from 'node:crypto';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listNotifications, markAllRead, unreadCount } from '@/lib/notifications/inbox';
import { createTestUser, deleteTestUser, serviceDb, signedInClient, type TestUser } from './helpers';

const db = serviceDb();
let orgId: string;
let p: TestUser;
let q: TestUser;
let pProfile: string;
let pClient: SupabaseClient;
let qClient: SupabaseClient;
const channels: RealtimeChannel[] = [];

async function notify(profileId: string, kind = 'booking_confirmed'): Promise<string> {
  const { data, error } = await db
    .from('notifications')
    .insert({ organization_id: orgId, profile_id: profileId, kind, link: '/me/bookings' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** Subscribes `client` to INSERTs on `profileId`'s notifications and collects what arrives. */
async function listen(client: SupabaseClient, profileId: string): Promise<Array<{ id: string }>> {
  const received: Array<{ id: string }> = [];
  const channel = client
    .channel(`notifications-${randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` }, (change) =>
      received.push(change.new as { id: string }),
    );
  channels.push(channel);
  // SUBSCRIBED can arrive just before Realtime registers the database listener; changes in that gap
  // are missed. Wait for its "Subscribed to PostgreSQL" acknowledgement instead.
  const listening = new Promise<void>((resolve) =>
    channel.on('system', {}, (message: { extension?: string; status?: string }) => {
      if (message.extension === 'postgres_changes' && message.status === 'ok') resolve();
    }),
  );
  await new Promise<void>((resolve, reject) =>
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(status));
    }),
  );
  await listening;
  return received;
}

const waitFor = async (check: () => boolean, ms: number) => {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
};

beforeAll(async () => {
  p = await createTestUser(db);
  q = await createTestUser(db);
  const { data: org, error } = await db
    .from('organizations')
    .insert({ slug: `ntf-${randomUUID().slice(0, 8)}`, name: 'Notify Turf', business_type: 'turf', status: 'live' })
    .select('id')
    .single();
  if (error) throw error;
  orgId = org.id;
  const { data: profiles, error: profileError } = await db
    .from('player_profiles')
    .insert([
      { organization_id: orgId, user_id: p.id, display_name: 'P' },
      { organization_id: orgId, user_id: q.id, display_name: 'Q' },
    ])
    .select('id, user_id');
  if (profileError) throw profileError;
  pProfile = profiles.find((r) => r.user_id === p.id)!.id;
  pClient = await signedInClient(p.email, p.password);
  qClient = await signedInClient(q.email, q.password);
});

afterAll(async () => {
  for (const channel of channels) await channel.unsubscribe();
  await db.from('organizations').delete().eq('id', orgId);
  await deleteTestUser(db, p.id);
  await deleteTestUser(db, q.id);
});

describe('notification inbox', () => {
  it('lists the newest first and marks everything read', async () => {
    await notify(pProfile);
    await notify(pProfile, 'booking_cancelled');
    const items = await listNotifications(pClient, pProfile, orgId);
    expect(items.map((i) => i.kind)).toEqual(['booking_cancelled', 'booking_confirmed']);
    expect(await unreadCount(pClient, pProfile, orgId)).toBe(2);

    await markAllRead(pClient, pProfile, orgId);
    expect(await unreadCount(pClient, pProfile, orgId)).toBe(0);
    expect((await listNotifications(pClient, pProfile, orgId)).every((i) => i.readAt !== null)).toBe(true);
  });

  it('pushes a new notification to its player over Realtime', async () => {
    const received = await listen(pClient, pProfile);
    const id = await notify(pProfile);
    // Realtime may also replay rows committed just before subscribing, so look for this one by id.
    await waitFor(() => received.some((n) => n.id === id), 5000);
    expect(received.map((n) => n.id)).toContain(id);
  });

  it("never pushes one player's notifications to another", async () => {
    const received = await listen(qClient, pProfile); // Q asks for P's rows; RLS must say no
    await notify(pProfile);
    await new Promise((r) => setTimeout(r, 2000));
    expect(received).toHaveLength(0);
  });
});
