import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cancelSeat,
  findOffer,
  issueOfferToken,
  listMySeats,
  matchSession,
  offerNext,
  playerSessionView,
  requestSeat,
  respondToOffer,
  seatsLeft,
  staffSessionView,
  withdrawRequest,
} from '@/lib/open-play/open-play';
import { saveProfile } from '@/lib/profiles/save-profile';
import { cancelOpenPlay } from '@/lib/schedule/schedule';
import { createTestUser, deleteTestUser, serviceDb, signedInClient, type TestUser } from './helpers';

// A brand with a Turf section (defaults: 2-hour cancel cut-off, 6-hour match cut-off) with Pitch 1 and
// Pitch 2 and a 5-a-side game, and a Café section (30-minute cancel cut-off) with one table and a
// board game. Session A is two days ahead on both pitches; session B starts in 3 hours (inside its
// match cut-off); café session C is three days ahead. Players P1–P16 are rated turf 1–5 (P1 = 1,
// P2 = 2, … P6 = 1 …) and café 1, and have phone numbers, which must never reach a view. P17 has no
// rating yet. The tests run in order and build on each other, like a real evening.
const db = serviceDb();
const users: TestUser[] = [];
const p: string[] = []; // p[1]…p[16] are profile ids
let orgId: string;
let sessionA: string;
let sessionB: string;
let sessionC: string; // at the café
let turfId: string;
let cafeId: string;
let tableId: string;
let catanId: string;
let fiveASideId: string;
const turfRating = (n: number) => 1 + ((n - 1) % 5);

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
  for (let i = 0; i < 17; i += 1) users.push(await createTestUser(db));
  const org = must(
    await db.from('organizations').insert({ slug: `op-${randomUUID().slice(0, 8)}`, name: 'Open Play Turf', business_type: 'turf', status: 'live' }).select('id').single(),
  );
  orgId = org.id;
  const branch = must(await db.from('sections').insert({ organization_id: orgId, name: 'Turf', kind: 'turf', slug: 'turf' }).select('id').single());
  turfId = branch.id;
  const cafe = must(
    await db.from('sections').insert({ organization_id: orgId, name: 'Café', kind: 'boardgame_cafe', slug: 'cafe', cancel_cutoff_minutes: 30 }).select('id').single(),
  );
  const table = must(await db.from('resources').insert({ organization_id: orgId, section_id: cafe.id, name: 'Table 1', kind: 'table', capacity: 4 }).select('id').single());
  const boardGame = must(
    await db
      .from('activities')
      .insert({ organization_id: orgId, section_id: cafe.id, name: 'Catan', min_players: 2, max_players: 4, duration_min: 90, team_mode: 'none' })
      .select('id')
      .single(),
  );
  cafeId = cafe.id;
  tableId = table.id;
  catanId = boardGame.id;
  const pitches = must(
    await db
      .from('resources')
      .insert([
        { organization_id: orgId, section_id: branch.id, name: 'Pitch 1', kind: 'pitch', capacity: 14 },
        { organization_id: orgId, section_id: branch.id, name: 'Pitch 2', kind: 'pitch', capacity: 14 },
      ])
      .select('id'),
  );
  const activity = must(
    await db
      .from('activities')
      .insert({ organization_id: orgId, section_id: branch.id, name: '5-a-side', min_players: 10, max_players: 10, duration_min: 60, team_mode: 'two_teams', team_size: 5 })
      .select('id')
      .single(),
  );
  fiveASideId = activity.id;
  const profiles = must(
    await db
      .from('player_profiles')
      .insert(users.map((u, i) => ({ organization_id: orgId, user_id: u.id, display_name: `P${i + 1}`, phone: `+88017110000${String(i + 10)}` })))
      .select('id, display_name'),
  );
  for (const row of profiles) p[Number(row.display_name.slice(1))] = row.id;
  must(
    await db.from('profile_section_skills').insert(
      Array.from({ length: 16 }, (_, i) => i + 1).flatMap((n) => [
        { organization_id: orgId, profile_id: p[n], section_id: branch.id, skill: turfRating(n) },
        { organization_id: orgId, profile_id: p[n], section_id: cafe.id, skill: 1 },
      ]),
    ),
  );
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();
  const sessions = must(
    await db
      .from('open_play_sessions')
      .insert([
        { organization_id: orgId, section_id: branch.id, activity_id: activity.id, starts_at: at(2 * 86_400_000), ends_at: at(2 * 86_400_000 + 3_600_000), seat_price_poisha: 30000 },
        { organization_id: orgId, section_id: branch.id, activity_id: activity.id, starts_at: at(3 * 3_600_000), ends_at: at(4 * 3_600_000), seat_price_poisha: 30000 },
      ])
      .select('id, starts_at')
      .order('starts_at', { ascending: false }),
  );
  sessionA = sessions[0].id;
  sessionB = sessions[1].id;
  sessionC = must(
    await db
      .from('open_play_sessions')
      .insert({ organization_id: orgId, section_id: cafe.id, activity_id: boardGame.id, starts_at: at(3 * 86_400_000), ends_at: at(3 * 86_400_000 + 5_400_000), seat_price_poisha: 20000 })
      .select('id')
      .single(),
  ).id;
  must(await db.from('open_play_session_resources').insert({ organization_id: orgId, session_id: sessionC, resource_id: table.id }));
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
    // Levels are the turf ratings (everyone is rated 1 at the café).
    for (const team of staff!.groups[0].teams) {
      expect(team.players.map((pl) => pl.skill)).toEqual(team.players.map((pl) => turfRating(Number(pl.name.slice(1)))));
      expect(team.skillTotal).toBe(team.players.reduce((sum, pl) => sum + turfRating(Number(pl.name.slice(1))), 0));
    }
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
    expect(mine.upcoming.map((s) => [s.sessionId, s.team, s.cancellable, s.sectionId])).toEqual([[sessionA, leaver.team, true, turfId]]);
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

  it("uses the café's own 30-minute cut-off for its seats", async () => {
    for (const n of [15, 16]) expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionC, profileId: p[n] })).toBe('requested');
    expect(await matchSession(db, { organizationId: orgId, sessionId: sessionC })).toBe('matched');
    const seat = (await live(p[15], sessionC))!;
    const { starts_at } = must(await db.from('open_play_sessions').select('starts_at').eq('id', sessionC).single());
    const hourBefore = new Date(new Date(starts_at).getTime() - 3_600_000);
    const view = await playerSessionView(db, { organizationId: orgId, sessionId: sessionC, profileId: p[15], now: hourBefore });
    expect(view?.me).toMatchObject({ state: 'seated', cancellable: true }); // the turf's 2 hours would say no
    expect((await listMySeats(db, { organizationId: orgId, profileId: p[15], now: hourBefore })).upcoming.find((x) => x.sessionId === sessionC)?.cancellable).toBe(true);
    expect(await cancelSeat(db, { organizationId: orgId, bookingId: seat.id, actor: { kind: 'player', profileId: p[15] }, now: hourBefore })).toBe('cancelled');
  });

  it('offers a café seat to a player whose only favourite is a turf game (favourites count per section)', async () => {
    must(await db.from('profile_activities').insert({ organization_id: orgId, profile_id: p[13], activity_id: fiveASideId, rank: 1 }));
    const at = new Date(Date.now() + 4 * 86_400_000);
    const night = must(
      await db
        .from('open_play_sessions')
        .insert({ organization_id: orgId, section_id: cafeId, starts_at: at.toISOString(), ends_at: new Date(at.getTime() + 5_400_000).toISOString(), seat_price_poisha: 20000, status: 'matched' })
        .select('id')
        .single(),
    );
    must(await db.from('open_play_session_resources').insert({ organization_id: orgId, session_id: night.id, resource_id: tableId }));
    const group = must(await db.from('groups').insert({ organization_id: orgId, session_id: night.id, resource_id: tableId, activity_id: catanId, capacity: 4 }).select('id').single());
    must(await db.from('waitlist_entries').insert({ organization_id: orgId, session_id: night.id, profile_id: p[13], queue_position: 1 }));
    expect(await offerNext(db, { groupId: group.id, seatNo: 1 })).toBe('offered');
  });

  it('asks an unrated player to rate their level first, then takes the request (Review Focus 3)', async () => {
    expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionB, profileId: p[17] })).toBe('needs_skill');
    expect((await playerSessionView(db, { organizationId: orgId, sessionId: sessionB, profileId: p[17] }))?.me).toEqual({ state: 'none', needsRating: true });
    const user = users[16]!;
    const client = await signedInClient(user.email, user.password);
    const saved = await saveProfile(client, {
      userId: user.id,
      organizationId: orgId,
      input: { displayName: 'P17', phone: null, ratings: { [turfId]: 3 }, favourites: [], availability: [], emailOptIn: false },
    });
    expect(saved.status).toBe('saved');
    expect(await requestSeat(db, { organizationId: orgId, sessionId: sessionB, profileId: p[17] })).toBe('requested');
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
