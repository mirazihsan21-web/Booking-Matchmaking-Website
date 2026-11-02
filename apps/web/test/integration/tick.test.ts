import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailMessage, EmailSender } from '@/lib/email/sender';
import { runTick } from '@/lib/jobs/tick';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

// Tick Turf (default 6-hour match cut-off) with Pitch 1 and 5-a-side; players Tick and T1–T10.
// runTick works on every venue in the database, so assertions look only at this file's rows.
const db = serviceDb();
let orgId: string;
let sectionId: string;
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
      .insert({ organization_id: orgId, section_id: sectionId, activity_id: activityId, starts_at: inHours(startsInHours), ends_at: inHours(startsInHours + 1), seat_price_poisha: 30000, status })
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
  sectionId = must(await db.from('sections').insert({ organization_id: orgId, name: 'Main', kind: 'turf', slug: 'main' }).select('id').single()).id;
  pitchId = must(await db.from('resources').insert({ organization_id: orgId, section_id: sectionId, name: 'Pitch 1', kind: 'pitch', capacity: 14 }).select('id').single()).id;
  activityId = must(
    await db
      .from('activities')
      .insert({ organization_id: orgId, section_id: sectionId, name: '5-a-side', min_players: 10, max_players: 10, duration_min: 60, team_mode: 'two_teams', team_size: 5 })
      .select('id')
      .single(),
  ).id;
  profileId = must(await db.from('player_profiles').insert({ organization_id: orgId, user_id: player.id, display_name: 'Tick' }).select('id').single()).id;
  const rows = must(
    await db
      .from('player_profiles')
      .insert(squad.map((u, i) => ({ organization_id: orgId, user_id: u.id, display_name: `T${i + 1}` })))
      .select('id'),
  );
  squadProfiles.push(...rows.map((r) => r.id));
  // Requests need a level for the section: the squad is rated 1–5, the lone player 3.
  must(
    await db.from('profile_section_skills').insert([
      ...squadProfiles.map((id, i) => ({ organization_id: orgId, profile_id: id, section_id: sectionId, skill: 1 + (i % 5) })),
      { organization_id: orgId, profile_id: profileId, section_id: sectionId, skill: 3 },
    ]),
  );
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

  it('offers a free seat whose hand-off was lost to a waiting player', async () => {
    // As if offerNext failed after a cancel: seat 7 is free, nobody holds an offer, Tick is waiting.
    const sessionId = await session(50, 'matched');
    const group = must(await db.from('groups').insert({ organization_id: orgId, session_id: sessionId, resource_id: pitchId, activity_id: activityId, capacity: 10 }).select('id').single());
    const seats = [1, 2, 3, 4, 5, 6, 8, 9, 10];
    must(
      await db.from('bookings').insert(
        seats.map((seatNo, i) => ({ organization_id: orgId, session_id: sessionId, group_id: group.id, profile_id: squadProfiles[i], seat_no: seatNo, price_poisha: 30000, team: seatNo <= 5 ? 1 : 2 })),
      ),
    );
    const entry = must(await db.from('waitlist_entries').insert({ organization_id: orgId, session_id: sessionId, profile_id: profileId, queue_position: 1 }).select('id').single());

    await runTick({ db, createSender: () => recordingSender() });
    const offer = must(await db.from('seat_offers').select('seat_no').eq('waitlist_entry_id', entry.id).eq('status', 'pending').single());
    expect(offer.seat_no).toBe(7);
  });

  it('does not let sessions that cannot fill crowd out one that can', async () => {
    for (let i = 0; i < 11; i += 1) {
      const thin = await session(1 + i / 100);
      for (const id of squadProfiles.slice(0, 3)) must(await db.rpc('request_seat', { p_session_id: thin, p_profile_id: id }));
    }
    const fillable = await session(4);
    await squadRequests(fillable);

    const report = await runTick({ db, createSender: () => recordingSender() });
    expect(report.matched).toContain(fillable);
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

describe('runTick and the players chat', () => {
  async function card(fields: Record<string, unknown>): Promise<string> {
    return must(
      await db
        .from('chat_cards')
        .insert({
          organization_id: orgId,
          poster_user_id: player.id,
          poster_profile_id: profileId,
          poster_name: 'Tick',
          section_id: sectionId,
          section_name: 'Main',
          section_kind: 'turf',
          section_accent: '#43a66b',
          title: 'Pitch 1',
          ...fields,
        })
        .select('id')
        .single(),
    ).id;
  }

  it('closes a card whose booking was cancelled, and a session card once the session has no seats left', async () => {
    const booking = must(
      await db
        .from('resource_bookings')
        .insert({ organization_id: orgId, resource_id: pitchId, profile_id: profileId, period: `[${inHours(200)},${inHours(201)})`, price_poisha: 0, status: 'cancelled' })
        .select('id')
        .single(),
    ).id;
    const bookingCard = await card({ kind: 'booking', resource_booking_id: booking, starts_at: inHours(200), ends_at: inHours(201), spots_needed: 3 });
    const full = await session(100); // more than the 6-hour cut-off away, so the tick doesn't match it
    await squadRequests(full); // 10 requests for a 10-player game: no seats left
    const sessionCard = await card({ kind: 'session', session_id: full, starts_at: inHours(100), ends_at: inHours(101) });

    const report = await runTick({ db, createSender: () => recordingSender(), now: new Date('2026-11-03T10:30:00Z') });

    expect(report.chat.closed).toBeGreaterThanOrEqual(2);
    expect(report.chat.purged).toBe(false);
    expect(must(await db.from('chat_cards').select('status').eq('id', bookingCard).single()).status).toBe('cancelled');
    expect(must(await db.from('chat_cards').select('status').eq('id', sessionCard).single()).status).toBe('full');
  });

  it('deletes queued chat photos from Storage and forgets them', async () => {
    const path = `${player.id}/${randomUUID()}.jpg`;
    const bucket = db.storage.from('chat-photos');
    const upload = await bucket.upload(path, new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    if (upload.error) throw upload.error;
    must(await db.from('chat_photo_trash').insert({ path, organization_id: orgId }).select('path'));

    const report = await runTick({ db, createSender: () => recordingSender(), now: new Date('2026-11-03T10:30:00Z') });

    expect(report.chat.photosDeleted).toBeGreaterThanOrEqual(1);
    expect((await db.from('chat_photo_trash').select('path').eq('path', path)).data).toEqual([]);
    const { data: listed } = await bucket.list(player.id);
    expect((listed ?? []).map((f) => f.name)).not.toContain(path.split('/')[1]);
  });

  it('purges old chat once an hour, on the hour', async () => {
    const old = must(
      await db
        .from('chat_messages')
        .insert({ organization_id: orgId, author_user_id: player.id, author_profile_id: profileId, author_kind: 'player', author_name: 'Tick', body: 'old', created_at: inHours(-24 * 31) })
        .select('id')
        .single(),
    ).id;
    const onTheHour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    const report = await runTick({ db, createSender: () => recordingSender(), now: onTheHour });
    expect(report.chat.purged).toBe(true);
    expect((await db.from('chat_messages').select('id').eq('id', old)).data).toEqual([]);
  });
});
