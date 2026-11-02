import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cardableBookings, cardView, decideRequest, openCards, postBookingCard, postSessionCard, requestToJoin, shareableSessions } from '@/lib/chat/cards';
import { postMessage } from '@/lib/chat/messages';
import { listOpenReports, mutePlayer, myMute, openReportCount, reportMessage, setBlockedWord } from '@/lib/chat/moderation';
import { hasUnreadRoom, markRoomRead } from '@/lib/chat/reads';
import { roomPage } from '@/lib/chat/room';
import { createTestUser, deleteTestUser, serviceDb, signedInClient, type TestUser } from './helpers';

// Chat Arena (live) with a Turf section (Pitch 1, 14 people) and a 5-a-side open-play game in two days.
// Sami (A) has a booking tomorrow and a mobile; Tanvir (B) plays turf at level 4 and has a mobile; Nadia (C)
// watches; Tee (T) is staff.
const db = serviceDb();
const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
};
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const pause = () => new Promise((resolve) => setTimeout(resolve, 3_100)); // one message every 3 seconds

let orgId: string;
let sectionId: string;
let sessionId: string;
let bookingId: string;
const users: TestUser[] = [];
let a: TestUser, b: TestUser, c: TestUser, t: TestUser;
let pa: string, pb: string, pc: string;

beforeAll(async () => {
  [a, b, c, t] = await Promise.all([createTestUser(db), createTestUser(db), createTestUser(db), createTestUser(db)]);
  users.push(a, b, c, t);
  orgId = must(await db.from('organizations').insert({ slug: `chat-${randomUUID().slice(0, 8)}`, name: 'Chat Arena', business_type: 'turf', status: 'live' }).select('id').single()).id;
  must(await db.from('organization_members').insert({ organization_id: orgId, user_id: t.id, role: 'staff' }));
  sectionId = must(await db.from('sections').insert({ organization_id: orgId, name: 'Turf', kind: 'turf', slug: 'turf' }).select('id').single()).id;
  const pitch = must(
    await db.from('resources').insert({ organization_id: orgId, section_id: sectionId, name: 'Pitch 1', kind: 'pitch', capacity: 14 }).select('id').single(),
  ).id;
  const activity = must(
    await db
      .from('activities')
      .insert({ organization_id: orgId, section_id: sectionId, name: '5-a-side', min_players: 10, max_players: 10, duration_min: 60, team_mode: 'two_teams', team_size: 5 })
      .select('id')
      .single(),
  ).id;
  const profiles = must(
    await db
      .from('player_profiles')
      .insert([
        { organization_id: orgId, user_id: a.id, display_name: 'Sami', phone: '+8801711111111' },
        { organization_id: orgId, user_id: b.id, display_name: 'Tanvir', phone: '+8801722222222' },
        { organization_id: orgId, user_id: c.id, display_name: 'Nadia' },
      ])
      .select('id, display_name'),
  );
  pa = profiles.find((p) => p.display_name === 'Sami')!.id;
  pb = profiles.find((p) => p.display_name === 'Tanvir')!.id;
  pc = profiles.find((p) => p.display_name === 'Nadia')!.id;
  must(await db.from('profile_section_skills').insert({ organization_id: orgId, profile_id: pb, section_id: sectionId, skill: 4 }));
  bookingId = must(
    await db
      .from('resource_bookings')
      .insert({ organization_id: orgId, resource_id: pitch, profile_id: pa, period: `[${inHours(24)},${inHours(25)})`, price_poisha: 0 })
      .select('id')
      .single(),
  ).id;
  sessionId = must(
    await db
      .from('open_play_sessions')
      .insert({ organization_id: orgId, section_id: sectionId, activity_id: activity, starts_at: inHours(48), ends_at: inHours(49), seat_price_poisha: 30000 })
      .select('id')
      .single(),
  ).id;
  must(await db.from('open_play_session_resources').insert({ organization_id: orgId, session_id: sessionId, resource_id: pitch }));
}, 30_000);

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  await Promise.all(users.map((u) => deleteTestUser(db, u.id)));
});

describe('the players chat', () => {
  it('masks bad words, the built-in ones and the venue\'s own', async () => {
    const first = await postMessage(db, { organizationId: orgId, userId: a.id, body: 'what the shit' });
    expect(first.status).toBe('posted');
    expect(await setBlockedWord(db, { organizationId: orgId, userId: t.id, word: 'gadha', add: true })).toBe('added');
    const second = await postMessage(db, { organizationId: orgId, userId: b.id, body: 'tui gadha' });
    const bodies = must(await db.from('chat_messages').select('body').in('id', [first, second].map((r) => ('messageId' in r ? r.messageId : ''))).order('created_at'));
    expect(bodies.map((r) => r.body).sort()).toEqual(['tui ●●●', 'what the ●●●']);
  });

  it('lists the bookings a player can post a card for, until they post one', async () => {
    const before = await cardableBookings(db, { organizationId: orgId, profileId: pa });
    expect(before).toEqual([expect.objectContaining({ bookingId, label: 'Pitch 1 · Turf', maxSpots: 13 })]);
    await pause();
    const posted = await postBookingCard(db, { organizationId: orgId, userId: a.id, bookingId, spots: 2, note: 'split the shit cost' });
    expect(posted.status).toBe('posted');
    expect(await cardableBookings(db, { organizationId: orgId, profileId: pa })).toEqual([]);
    const card = must(await db.from('chat_cards').select('note').eq('resource_booking_id', bookingId).single());
    expect(card.note).toBe('split the ●●● cost');
  });

  it('shows the poster who asked, then swaps numbers between the poster and an accepted player only', async () => {
    const { id: cardId } = must(await db.from('chat_cards').select('id').eq('resource_booking_id', bookingId).single());
    expect(await requestToJoin(db, { cardId, userId: b.id })).toBe('requested');

    const asPoster = await cardView(db, { organizationId: orgId, cardId, viewer: { userId: a.id, profileId: pa, isTeam: false } });
    expect(asPoster?.role).toBe('poster');
    expect(asPoster?.requests).toEqual([expect.objectContaining({ profileId: pb, name: 'Tanvir', skill: 4 })]);

    expect(await decideRequest(db, { cardId, userId: a.id, profileId: pb, accept: true })).toBe('accepted');
    const afterAccept = await cardView(db, { organizationId: orgId, cardId, viewer: { userId: a.id, profileId: pa, isTeam: false } });
    expect(afterAccept?.accepted).toEqual([{ profileId: pb, name: 'Tanvir', phone: '+8801722222222' }]);
    expect(afterAccept?.posterPhone).toBeNull();

    const asPlayer = await cardView(db, { organizationId: orgId, cardId, viewer: { userId: b.id, profileId: pb, isTeam: false } });
    expect(asPlayer).toMatchObject({ role: 'accepted', myStatus: 'accepted', posterPhone: '+8801711111111' });
    expect(asPlayer?.accepted.every((p) => p.phone === null)).toBe(true);

    const asOther = await cardView(db, { organizationId: orgId, cardId, viewer: { userId: c.id, profileId: pc, isTeam: false } });
    expect(asOther).toMatchObject({ role: 'other', myStatus: null, posterPhone: null, requests: [] });
    expect(asOther?.accepted.every((p) => p.phone === null)).toBe(true);
  });

  it('lists open cards soonest first, with seats left for a game', async () => {
    expect(await shareableSessions(db, { organizationId: orgId, userId: t.id, profileId: null, isTeam: true })).toEqual([
      expect.objectContaining({ sessionId, label: '5-a-side · Turf' }),
    ]);
    expect(await shareableSessions(db, { organizationId: orgId, userId: c.id, profileId: pc, isTeam: false })).toEqual([]);
    expect((await postSessionCard(db, { organizationId: orgId, userId: t.id, sessionId, note: null })).status).toBe('posted');
    const open = await openCards(db, { organizationId: orgId });
    expect(open.map((card) => card.kind)).toEqual(['booking', 'session']);
    expect(open[0]!.seatsLeft).toBeNull();
    expect(open[1]!.seatsLeft).toBeGreaterThan(0);
  });

  it('groups reports by message for the team, and mutes', async () => {
    const { id: messageId } = must(await db.from('chat_messages').select('id').eq('organization_id', orgId).eq('author_user_id', a.id).is('card_id', null).single());
    expect(await reportMessage(db, { messageId, userId: b.id, reason: 'abuse', note: null })).toBe('reported');
    expect(await reportMessage(db, { messageId, userId: c.id, reason: 'spam', note: 'again' })).toBe('reported');
    const reports = await listOpenReports(db, orgId);
    expect(reports).toEqual([expect.objectContaining({ messageId, authorName: 'Sami', bodyCopy: 'what the ●●●' })]);
    expect(reports[0]!.reports.map((r) => r.reporterName).sort()).toEqual(['Nadia', 'Tanvir']);
    expect(await openReportCount(db, orgId)).toBe(1);

    expect(await mutePlayer(db, { organizationId: orgId, userId: t.id, profileId: pc, days: 1 })).toBe('muted');
    expect((await myMute(db, { organizationId: orgId, profileId: pc }))?.until).toEqual(expect.any(String));
    expect(await myMute(db, { organizationId: orgId, profileId: pb })).toBeNull();
  });

  it('reads the room and the unread dot as the signed-in player, under the row rules', async () => {
    const asB = await signedInClient(b.email, b.password);
    const page = await roomPage(asB, { organizationId: orgId });
    expect(page.messages.length).toBeGreaterThanOrEqual(4);
    expect(page.messages.map((m) => m.createdAt)).toEqual([...page.messages.map((m) => m.createdAt)].sort());
    expect(page.cards.map((card) => card.kind).sort()).toEqual(['booking', 'session']);

    expect(await hasUnreadRoom(asB, { organizationId: orgId, userId: b.id })).toBe(true);
    await markRoomRead(asB, { organizationId: orgId, userId: b.id, at: page.messages.at(-1)!.createdAt });
    expect(await hasUnreadRoom(asB, { organizationId: orgId, userId: b.id })).toBe(false);
    await pause();
    expect((await postMessage(db, { organizationId: orgId, userId: a.id, body: 'anyone else?' })).status).toBe('posted');
    expect(await hasUnreadRoom(asB, { organizationId: orgId, userId: b.id })).toBe(true);

    const newer = await roomPage(asB, { organizationId: orgId, after: page.messages.at(-1)!.createdAt });
    expect(newer.messages.map((m) => m.body)).toContain('anyone else?');
  }, 20_000);
});
