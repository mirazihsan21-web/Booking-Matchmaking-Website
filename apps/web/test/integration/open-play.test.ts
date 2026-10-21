import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cancelSeat,
  findOffer,
  issueOfferToken,
  listMySeats,
  matchSession,
  playerSessionView,
  requestSeat,
  respondToOffer,
  seatsLeft,
  staffSessionView,
  withdrawRequest,
} from '@/lib/open-play/open-play';
import { cancelOpenPlay } from '@/lib/schedule/schedule';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

// A fresh turf (defaults: 2-hour cancel cut-off, 6-hour match cut-off) with Pitch 1 and Pitch 2 and a
// 5-a-side activity. Session A is two days ahead on both pitches; session B starts in 3 hours (inside
// its match cut-off). Players P1–P16 have skills 1–5 and phone numbers, which must never reach a view.
// The tests run in order and build on each other, like a real evening.
const db = serviceDb();
const users: TestUser[] = [];
const p: string[] = []; // p[1]…p[16] are profile ids
let orgId: string;
let sessionA: string;
let sessionB: string;

const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
};
const live = async (profileId: string, sessionId = sessionA) =>
  (await db.from('bookings').select('id, seat_no, team, group_id, profile_id').eq('session_id', sessionId).eq('profile_id', profileId).neq('status', 'cancelled').maybeSingle()).data;
const entries = async (status: string, sessionId = sessionA) =>
  must(await db.from('waitlist_entries').select('id, profile_id').eq('session_id', sessionId).eq('status', status)) as Array<{ id: string; profile_id: string }>;
const pendingOffer = async (profileId: string) => {
  const entry = must(await db.from('waitlist_entries').select('id').eq('session_id', sessionA).eq('profile_id', profileId).single());
  return (await db.from('seat_offers').select('id, group_id, seat_no').eq('waitlist_entry_id', entry.id).eq('status', 'pending').maybeSingle()).data;
};
const seated = async () =>
  must(await db.from('bookings').select('id, profile_id, seat_no, team').eq('session_id', sessionA).eq('status', 'confirmed').order('seat_no')) as Array<{
    id: string;
    profile_id: string;
    seat_no: number;
    team: number;
  }>;
const left = async () => (await seatsLeft(db, { organizationId: orgId, sessionIds: [sessionA] })).get(sessionA);

beforeAll(async () => {
  for (let i = 0; i < 16; i += 1) users.push(await createTestUser(db));
  const org = must(
    await db.from('organizations').insert({ slug: `op-${randomUUID().slice(0, 8)}`, name: 'Open Play Turf', business_type: 'turf', status: 'live' }).select('id').single(),
  );
  orgId = org.id;
  const branch = must(await db.from('branches').insert({ organization_id: orgId, name: 'Main' }).select('id').single());
  const pitches = must(
    await db
      .from('resources')
      .insert([
        { organization_id: orgId, branch_id: branch.id, name: 'Pitch 1', kind: 'pitch', capacity: 14 },
        { organization_id: orgId, branch_id: branch.id, name: 'Pitch 2', kind: 'pitch', capacity: 14 },
      ])
      .select('id'),
  );
  const activity = must(
    await db
      .from('activities')
      .insert({ organization_id: orgId, name: '5-a-side', min_players: 10, max_players: 10, duration_min: 60, team_mode: 'two_teams', team_size: 5 })
      .select('id')
      .single(),
  );
  const profiles = must(
    await db
      .from('player_profiles')
      .insert(users.map((u, i) => ({ organization_id: orgId, user_id: u.id, display_name: `P${i + 1}`, skill: 1 + (i % 5), phone: `+88017110000${String(i + 10)}` })))
      .select('id, display_name'),
  );
  for (const row of profiles) p[Number(row.display_name.slice(1))] = row.id;
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();
  const sessions = must(
    await db
      .from('open_play_sessions')
      .insert([
        { organization_id: orgId, branch_id: branch.id, activity_id: activity.id, starts_at: at(2 * 86_400_000), ends_at: at(2 * 86_400_000 + 3_600_000), seat_price_poisha: 30000 },
        { organization_id: orgId, branch_id: branch.id, activity_id: activity.id, starts_at: at(3 * 3_600_000), ends_at: at(4 * 3_600_000), seat_price_poisha: 30000 },
      ])
      .select('id, starts_at')
      .order('starts_at', { ascending: false }),
  );
  sessionA = sessions[0].id;
  sessionB = sessions[1].id;
  must(
    await db.from('open_play_session_resources').insert(
      [sessionA, sessionB].flatMap((sessionId) => pitches.map((pitch) => ({ organization_id: orgId, session_id: sessionId, resource_id: pitch.id }))),
    ),
  );
});

afterAll(async () => {
  if (orgId) await db.from('organizations').delete().eq('id', orgId);
  await Promise.all(users.map((u) => deleteTestUser(db, u.id)));
});

describe('open play', () => {
  it('counts the seats two pitches could hold before anyone asks', async () => {
    expect(await left()).toBe(20);
  });

  it('takes requests, and a second request is already there', async () => {
    for (let i = 1; i <= 12; i += 1) {
      expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionA, profileId: p[i] })).toBe('requested');
    }
    expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionA, profileId: p[1] })).toBe('already');
    expect(await left()).toBe(8);
  });

  it('matches ten into two teams of five, waitlists two, and only once', async () => {
    expect(await matchSession(db, { organizationId: orgId, sessionId: sessionA })).toBe('matched');
    expect(await left()).toBe(0);

    const seats = await seated();
    expect(seats).toHaveLength(10);
    const view = await playerSessionView(db, { organizationId: orgId, sessionId: sessionA, profileId: seats[0].profile_id });
    expect(view?.me?.state).toBe('seated');
    expect([1, 2]).toContain(view?.me?.team);
    expect(view?.group?.teams.map((t) => t.team)).toEqual([1, 2]);
    expect(view?.group?.teams.map((t) => t.names.length)).toEqual([5, 5]);
    expect(JSON.stringify(view)).not.toContain('+880');

    const waiting = await entries('waiting');
    expect(waiting).toHaveLength(2);
    const waitView = await playerSessionView(db, { organizationId: orgId, sessionId: sessionA, profileId: waiting[0].profile_id });
    expect(waitView?.me?.state).toBe('waitlisted');
    expect([1, 2]).toContain(waitView?.me?.position);
    expect(waitView?.group).toBeNull();
    expect(JSON.stringify(waitView)).not.toContain('+880');

    const staff = await staffSessionView(db, { organizationId: orgId, sessionId: sessionA });
    expect(staff?.groups).toHaveLength(1);
    expect(staff?.groups[0].teams.map((t) => t.players.length)).toEqual([5, 5]);
    expect(staff?.waitlist).toHaveLength(2);
    expect(staff?.notEnoughPlayers).toBe(false);

    expect(await matchSession(db, { organizationId: orgId, sessionId: sessionA })).toBe('already_matched');
  });

  it('lets a waiting player withdraw and ask again', async () => {
    const [first] = await entries('waiting');
    expect(await withdrawRequest(db, { organizationId: orgId, sessionId: sessionA, profileId: first.profile_id })).toBe('withdrawn');
    expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionA, profileId: first.profile_id })).toBe('waitlisted');
  });

  it('leaves a session without enough players open, and tells staff', async () => {
    for (let i = 1; i <= 7; i += 1) await requestSeat(db, { organizationId: orgId, sessionId: sessionB, profileId: p[i] });
    expect(await matchSession(db, { organizationId: orgId, sessionId: sessionB })).toBe('no_groups');
    expect(must(await db.from('open_play_sessions').select('status').eq('id', sessionB).single()).status).toBe('open');
    const staff = await staffSessionView(db, { organizationId: orgId, sessionId: sessionB });
    expect(staff?.notEnoughPlayers).toBe(true);
    expect(staff?.requests).toHaveLength(7);
    expect(staff?.needed).toBe(10);
  });

  it('offers a cancelled seat by email link to a waiting player, who lands on the same team', async () => {
    const [leaver] = await seated();
    expect(await cancelSeat(db, { organizationId: orgId, bookingId: leaver.id, actor: { kind: 'player', profileId: leaver.profile_id } })).toBe('cancelled');

    const [offered] = await entries('offered');
    const offer = (await pendingOffer(offered.profile_id))!;
    const note = must(await db.from('notifications').select('link').eq('profile_id', offered.profile_id).eq('kind', 'offer').single());
    expect(note.link).toBe(`/me/offers/${offer.id}`);

    const token = await issueOfferToken(db, offer.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await findOffer(db, { token: token! }))?.id).toBe(offer.id);
    const newer = await issueOfferToken(db, offer.id);
    expect(await findOffer(db, { token: token! })).toBeNull();
    const view = await findOffer(db, { token: newer! });
    expect(view?.team).toBe(leaver.team);
    expect(view?.session.pricePoisha).toBe(30000);

    // Anyone holding the link can press the button; the seat still goes to the offered player.
    expect(await respondToOffer(db, { offerId: offer.id, response: 'accept' })).toBe('accepted');
    const booking = await live(offered.profile_id);
    expect(booking?.seat_no).toBe(leaver.seat_no);
    expect(booking?.team).toBe(leaver.team);

    const mine = await listMySeats(db, { organizationId: orgId, profileId: offered.profile_id });
    expect(mine.upcoming.map((s) => [s.sessionId, s.team, s.cancellable])).toEqual([[sessionA, leaver.team, true]]);
  });

  it('passes a declined seat to the next waiting player', async () => {
    expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionA, profileId: p[13] })).toBe('waitlisted');
    const [, leaver] = await seated();
    expect(await cancelSeat(db, { organizationId: orgId, bookingId: leaver.id, actor: { kind: 'staff' } })).toBe('cancelled');
    const [offered] = await entries('offered');
    const offer = (await pendingOffer(offered.profile_id))!;
    expect(await respondToOffer(db, { offerId: offer.id, response: 'decline' })).toBe('declined');

    const [next] = await entries('offered');
    expect(next.profile_id).not.toBe(offered.profile_id);
    expect((await pendingOffer(next.profile_id))?.seat_no).toBe(leaver.seat_no);
  });

  it('keeps a seat nobody waiting can take free, for the next late request', async () => {
    const [offered] = await entries('offered');
    expect(await respondToOffer(db, { offerId: (await pendingOffer(offered.profile_id))!.id, response: 'decline' })).toBe('declined');
    expect(await entries('offered')).toHaveLength(0);
    expect(await left()).toBe(1);
    expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionA, profileId: p[14] })).toBe('seated');
    expect(await left()).toBe(0);
  });

  it('stops players cancelling after the cut-off, but not staff', async () => {
    const [, , leaver] = await seated();
    const { starts_at } = must(await db.from('open_play_sessions').select('starts_at').eq('id', sessionA).single());
    const hourBefore = new Date(new Date(starts_at).getTime() - 3_600_000);
    expect(await cancelSeat(db, { organizationId: orgId, bookingId: leaver.id, actor: { kind: 'player', profileId: leaver.profile_id }, now: hourBefore })).toBe('too_late');
    expect(await cancelSeat(db, { organizationId: orgId, bookingId: leaver.id, actor: { kind: 'staff' }, now: hourBefore })).toBe('cancelled');
    const other = (await seated()).find((s) => s.profile_id !== leaver.profile_id)!;
    expect(await cancelSeat(db, { organizationId: orgId, bookingId: other.id, actor: { kind: 'player', profileId: p[16] } })).toBe('not_found');
  });

  it('closes everything once staff cancel the session', async () => {
    expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionA, profileId: p[15] })).toBe('seated');
    expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionA, profileId: p[16] })).toBe('waitlisted');
    const [leaver] = await seated();
    expect(await cancelSeat(db, { organizationId: orgId, bookingId: leaver.id, actor: { kind: 'staff' } })).toBe('cancelled');
    const offer = (await pendingOffer(p[16]))!;
    expect((await playerSessionView(db, { organizationId: orgId, sessionId: sessionA, profileId: p[16] }))?.me).toMatchObject({ state: 'offered', offerId: offer.id });

    expect(await cancelOpenPlay(db, sessionA)).toBe('cancelled');
    expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionA, profileId: p[1] })).toBe('closed');
    expect(await respondToOffer(db, { offerId: offer.id, response: 'accept' })).toBe('closed');
    expect(await matchSession(db, { organizationId: orgId, sessionId: sessionA })).toBe('not_open');
    expect(await left()).toBe(0);
  });

  it('answers not_found or null for malformed ids and tokens', async () => {
    const bad = { organizationId: orgId, sessionId: 'nope', profileId: p[1] };
    expect(await requestSeat(db, bad)).toBe('not_found');
    expect(await withdrawRequest(db, bad)).toBe('not_found');
    expect(await matchSession(db, bad)).toBe('not_found');
    expect(await playerSessionView(db, bad)).toBeNull();
    expect(await staffSessionView(db, bad)).toBeNull();
    expect(await cancelSeat(db, { organizationId: orgId, bookingId: 'nope', actor: { kind: 'staff' } })).toBe('not_found');
    expect(await respondToOffer(db, { offerId: 'nope', response: 'accept' })).toBe('not_found');
    expect(await findOffer(db, { token: 'garbage' })).toBeNull();
    expect(await findOffer(db, { offerId: 'nope', profileId: p[1], organizationId: orgId })).toBeNull();
    expect(await issueOfferToken(db, 'nope')).toBeNull();
    expect((await seatsLeft(db, { organizationId: orgId, sessionIds: ['nope'] })).size).toBe(0);
    expect(await requestSeat(db, { organizationId: randomUUID(), sessionId: sessionB, profileId: p[1] })).toBe('not_found');
  });
});
