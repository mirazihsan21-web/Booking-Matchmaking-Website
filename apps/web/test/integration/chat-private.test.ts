import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postMessage, postPrivateMessage } from '@/lib/chat/messages';
import { signedPhotoUrls, uploadChatPhoto } from '@/lib/chat/photos';
import { blockedByMe, blockPlayer, conversationWith, listConversations, playerCard, unblockPlayer } from '@/lib/chat/private';
import { markConversationRead, privateUnread } from '@/lib/chat/reads';
import { roomPage } from '@/lib/chat/room';
import { createTestUser, deleteTestUser, serviceDb, signedInClient, type TestUser } from './helpers';

// Chat Arena (live) with a Turf section. Sami (A), Tanvir (B, plays turf), Nadia (C) and Tee (T, staff).
const db = serviceDb();
const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 3_100)); // one message every 3 seconds
// The smallest JPEG there is (a 1×1 white pixel).
const JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  ),
  (c) => c.charCodeAt(0),
);

let orgId: string;
let a: TestUser, b: TestUser, c: TestUser, t: TestUser;
let pa: string, pb: string, pt: string;
let conversationId: string;

beforeAll(async () => {
  [a, b, c, t] = await Promise.all([createTestUser(db), createTestUser(db), createTestUser(db), createTestUser(db)]);
  orgId = must(await db.from('organizations').insert({ slug: `dm-${randomUUID().slice(0, 8)}`, name: 'Chat Arena', business_type: 'turf', status: 'live' }).select('id').single()).id;
  must(await db.from('organization_members').insert({ organization_id: orgId, user_id: t.id, role: 'staff' }));
  const section = must(await db.from('sections').insert({ organization_id: orgId, name: 'Turf', kind: 'turf', slug: 'turf' }).select('id').single()).id;
  const profiles = must(
    await db
      .from('player_profiles')
      .insert([
        { organization_id: orgId, user_id: a.id, display_name: 'Sami' },
        { organization_id: orgId, user_id: b.id, display_name: 'Tanvir' },
        { organization_id: orgId, user_id: c.id, display_name: 'Nadia' },
        { organization_id: orgId, user_id: t.id, display_name: 'Tee' },
      ])
      .select('id, display_name'),
  );
  const id = (name: string) => profiles.find((p) => p.display_name === name)!.id as string;
  [pa, pb, pt] = [id('Sami'), id('Tanvir'), id('Tee')];
  must(await db.from('profile_section_skills').insert({ organization_id: orgId, profile_id: pb, section_id: section, skill: 3 }));
}, 30_000);

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  const own = await db.storage.from('chat-photos').list(a.id);
  if (own.data?.length) await db.storage.from('chat-photos').remove(own.data.map((f) => `${a.id}/${f.name}`));
  await Promise.all([a, b, c, t].map((u) => deleteTestUser(db, u.id)));
});

describe('private messages', () => {
  it('sends one, filtered, and the other person sees it in their list and unread count', async () => {
    const sent = await postPrivateMessage(db, { organizationId: orgId, userId: a.id, toProfileId: pb, body: 'what the shit', photoPath: null });
    expect(sent.status).toBe('posted');
    conversationId = 'conversationId' in sent ? sent.conversationId : '';
    expect(must(await db.from('chat_messages').select('body').eq('conversation_id', conversationId).single()).body).toBe('what the ●●●');

    expect(await listConversations(db, { organizationId: orgId, profileId: pb })).toEqual([
      expect.objectContaining({ conversationId, otherProfileId: pa, otherName: 'Sami', lastText: 'what the ●●●', lastHasPhoto: false, unread: 1 }),
    ]);
    const asB = await signedInClient(b.email, b.password);
    expect(await privateUnread(asB, orgId)).toBe(1);
    await markConversationRead(asB, { conversationId, organizationId: orgId, profileId: pb, at: new Date(Date.now() + 1_000).toISOString() });
    expect(await privateUnread(asB, orgId)).toBe(0);
  });

  it('keeps private messages out of the room and away from everyone else', async () => {
    const asB = await signedInClient(b.email, b.password);
    expect((await roomPage(asB, { organizationId: orgId })).messages).toEqual([]);
    expect((await roomPage(asB, { organizationId: orgId, conversationId })).messages.map((m) => m.body)).toEqual(['what the ●●●']);
    const asC = await signedInClient(c.email, c.password);
    expect((await roomPage(asC, { organizationId: orgId, conversationId })).messages).toEqual([]);
  });

  it('knows who can be messaged, what they play, and blocks', async () => {
    expect(await conversationWith(db, { organizationId: orgId, profileId: pa, otherProfileId: pt })).toBeNull();
    expect(await conversationWith(db, { organizationId: orgId, profileId: pa, otherProfileId: pa })).toBeNull();
    expect(await conversationWith(db, { organizationId: orgId, profileId: pa, otherProfileId: pb })).toEqual({
      conversationId,
      otherName: 'Tanvir',
      blockedByMe: false,
      blockedMe: false,
    });
    expect(await playerCard(db, { organizationId: orgId, profileId: pb, viewerProfileId: pa })).toEqual({ name: 'Tanvir', sections: ['Turf'], blockedByMe: false });

    expect(await blockPlayer(db, { organizationId: orgId, userId: b.id, profileId: pa })).toBe('blocked');
    expect(await conversationWith(db, { organizationId: orgId, profileId: pb, otherProfileId: pa })).toMatchObject({ blockedByMe: true, blockedMe: false });
    expect(await conversationWith(db, { organizationId: orgId, profileId: pa, otherProfileId: pb })).toMatchObject({ blockedByMe: false, blockedMe: true });
    expect(await blockedByMe(db, { organizationId: orgId, profileId: pb })).toEqual([pa]);
    expect(await unblockPlayer(db, { organizationId: orgId, userId: b.id, profileId: pa })).toBe('unblocked');
  });
});

describe('blocking and unread', () => {
  it('stops counting a conversation as unread once either side blocks', async () => {
    await pause();
    expect((await postPrivateMessage(db, { organizationId: orgId, userId: a.id, toProfileId: pb, body: 'one more thing', photoPath: null })).status).toBe('posted');
    expect((await listConversations(db, { organizationId: orgId, profileId: pb }))[0]!.unread).toBeGreaterThan(0);
    expect(await blockPlayer(db, { organizationId: orgId, userId: b.id, profileId: pa })).toBe('blocked');
    try {
      expect((await listConversations(db, { organizationId: orgId, profileId: pb }))[0]!.unread).toBe(0);
      expect(await privateUnread(await signedInClient(b.email, b.password), orgId)).toBe(0);
    } finally {
      await unblockPlayer(db, { organizationId: orgId, userId: b.id, profileId: pa });
    }
  });
});

describe('photos', () => {
  it('shows a room photo to signed-in people, and a private photo only to its two people', async () => {
    const asA = await signedInClient(a.email, a.password);
    const blob = new Blob([JPEG], { type: 'image/jpeg' });
    const roomPhoto = await uploadChatPhoto(asA, a.id, blob);
    expect(roomPhoto).toMatch(new RegExp(`^${a.id}/[0-9a-f-]{36}\\.jpg$`));
    await pause();
    expect((await postMessage(db, { organizationId: orgId, userId: a.id, body: null, photoPath: roomPhoto! })).status).toBe('posted');

    const asC = await signedInClient(c.email, c.password);
    const urls = await signedPhotoUrls(asC, [roomPhoto!]);
    expect(urls.get(roomPhoto!)).toEqual(expect.any(String));
    expect((await fetch(urls.get(roomPhoto!)!)).status).toBe(200);

    const privatePhoto = await uploadChatPhoto(asA, a.id, blob);
    await pause();
    expect((await postPrivateMessage(db, { organizationId: orgId, userId: a.id, toProfileId: pb, body: null, photoPath: privatePhoto! })).status).toBe('posted');
    expect((await signedPhotoUrls(asC, [privatePhoto!])).has(privatePhoto!)).toBe(false);
    const asB = await signedInClient(b.email, b.password);
    expect((await signedPhotoUrls(asB, [privatePhoto!])).has(privatePhoto!)).toBe(true);

    expect((await listConversations(db, { organizationId: orgId, profileId: pb }))[0]).toMatchObject({ lastText: null, lastHasPhoto: true });
  }, 20_000);
});
