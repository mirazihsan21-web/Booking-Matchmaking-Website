import { describe, expect, it } from 'vitest';
import { cardFromRow, mergeMessages, messageFromRow, type ChatMessage } from '../lib/chat/rows';

const message = (id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  authorKind: 'player',
  authorUserId: 'u1',
  authorProfileId: 'p1',
  authorName: 'Sami',
  body: `message ${id}`,
  cardId: null,
  state: 'visible',
  createdAt,
  ...extra,
});

describe('mergeMessages', () => {
  it('keeps one copy of a message that arrives twice', () => {
    const a = message('a', '2026-11-02T10:00:00Z');
    expect(mergeMessages([a], [a, { ...a }])).toEqual([a]);
  });

  it('lets a changed row replace the old one', () => {
    const a = message('a', '2026-11-02T10:00:00Z');
    const removed = { ...a, body: null, state: 'removed_by_venue' as const };
    expect(mergeMessages([a], [removed])).toEqual([removed]);
  });

  it('keeps the order when a catch-up batch overlaps the newest messages', () => {
    const a = message('a', '2026-11-02T10:00:00Z');
    const b = message('b', '2026-11-02T10:01:00Z');
    const c = message('c', '2026-11-02T10:02:00Z');
    expect(mergeMessages([a, b], [c, b]).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(mergeMessages([c], [a, b]).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders messages sent at the same moment by id', () => {
    const y = message('y', '2026-11-02T10:00:00Z');
    const x = message('x', '2026-11-02T10:00:00Z');
    expect(mergeMessages([y], [x]).map((m) => m.id)).toEqual(['x', 'y']);
  });
});

describe('rows from the database (and from Realtime)', () => {
  it('maps a message row', () => {
    expect(
      messageFromRow({
        id: 'm1',
        organization_id: 'o1',
        author_kind: 'team',
        author_user_id: 'u9',
        author_profile_id: null,
        author_name: 'Chattoturf',
        body: 'Pitch 2 is free at 9',
        card_id: null,
        state: 'visible',
        created_at: '2026-11-02T10:00:00+00:00',
      }),
    ).toEqual({
      id: 'm1',
      authorKind: 'team',
      authorUserId: 'u9',
      authorProfileId: null,
      authorName: 'Chattoturf',
      body: 'Pitch 2 is free at 9',
      cardId: null,
      state: 'visible',
      createdAt: '2026-11-02T10:00:00+00:00',
    });
  });

  it('maps a card row', () => {
    expect(
      cardFromRow({
        id: 'c1',
        kind: 'booking',
        session_id: null,
        poster_user_id: 'u1',
        poster_profile_id: 'p1',
        poster_name: 'Sami',
        section_id: 's1',
        section_name: 'Turf',
        section_kind: 'turf',
        section_accent: '#43a66b',
        title: 'Pitch 1',
        starts_at: '2026-10-23T14:00:00+00:00',
        ends_at: '2026-10-23T15:00:00+00:00',
        seat_price_poisha: null,
        spots_needed: 3,
        spots_taken: 1,
        note: 'split the cost',
        status: 'open',
        created_at: '2026-10-22T09:00:00+00:00',
      }),
    ).toEqual({
      id: 'c1',
      kind: 'booking',
      sessionId: null,
      posterUserId: 'u1',
      posterProfileId: 'p1',
      posterName: 'Sami',
      sectionId: 's1',
      sectionName: 'Turf',
      sectionKind: 'turf',
      sectionAccent: '#43a66b',
      title: 'Pitch 1',
      startsAt: '2026-10-23T14:00:00+00:00',
      endsAt: '2026-10-23T15:00:00+00:00',
      seatPricePoisha: null,
      spotsNeeded: 3,
      spotsTaken: 1,
      note: 'split the cost',
      status: 'open',
      createdAt: '2026-10-22T09:00:00+00:00',
    });
  });
});
