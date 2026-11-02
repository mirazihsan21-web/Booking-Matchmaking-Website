import type { SupabaseClient } from '@supabase/supabase-js';
import { parseTstzRange } from '@/lib/bookings/bookings';
import type { ChatRefusal } from '@/lib/forms/chat';
import { seatsLeft } from '@/lib/open-play/open-play';
import { m } from '@/messages';
import { maskBadWords } from './filter';
import { blockedWords } from './moderation';
import { CARD_COLUMNS, cardFromRow, type ChatCard, type ChatJoinStatus } from './rows';

// "Need players" cards: posting, I'm in → Accept, the lists the chat page shows, and one card's page. Each function
// takes the service client: the server action has checked who is asking, and the SQL functions enforce the rules.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call<T extends string>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T | ChatRefusal> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  return data as T | ChatRefusal;
}

async function post(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<{ status: 'posted'; cardId: string } | { status: ChatRefusal }> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  const row = (data as Array<{ status: string; card_id: string | null }>)[0]!;
  return row.status === 'posted' ? { status: 'posted', cardId: row.card_id! } : { status: row.status as ChatRefusal };
}

const masked = async (db: SupabaseClient, organizationId: string, note: string | null) =>
  note ? maskBadWords(note, await blockedWords(db, organizationId)) : null;

export async function postBookingCard(
  db: SupabaseClient,
  input: { organizationId: string; userId: string; bookingId: string; spots: number; note: string | null },
) {
  return post(db, 'post_booking_card', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_booking_id: input.bookingId,
    p_spots: input.spots,
    p_note: await masked(db, input.organizationId, input.note),
  });
}

export async function postSessionCard(db: SupabaseClient, input: { organizationId: string; userId: string; sessionId: string; note: string | null }) {
  return post(db, 'post_session_card', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_session_id: input.sessionId,
    p_note: await masked(db, input.organizationId, input.note),
  });
}

export const closeCard = (db: SupabaseClient, input: { cardId: string; userId: string }) =>
  call<'closed'>(db, 'close_chat_card', { p_card_id: input.cardId, p_user_id: input.userId });
export const requestToJoin = (db: SupabaseClient, input: { cardId: string; userId: string }) =>
  call<'requested'>(db, 'request_to_join', { p_card_id: input.cardId, p_user_id: input.userId });
export const withdrawRequest = (db: SupabaseClient, input: { cardId: string; userId: string }) =>
  call<'withdrawn'>(db, 'withdraw_join_request', { p_card_id: input.cardId, p_user_id: input.userId });
export const decideRequest = (db: SupabaseClient, input: { cardId: string; userId: string; profileId: string; accept: boolean }) =>
  call<'accepted' | 'declined'>(db, 'decide_join_request', { p_card_id: input.cardId, p_user_id: input.userId, p_profile_id: input.profileId, p_accept: input.accept });
export const leaveCard = (db: SupabaseClient, input: { cardId: string; userId: string }) =>
  call<'left'>(db, 'leave_card', { p_card_id: input.cardId, p_user_id: input.userId });
export const removeFromCard = (db: SupabaseClient, input: { cardId: string; userId: string; profileId: string }) =>
  call<'removed'>(db, 'remove_from_card', { p_card_id: input.cardId, p_user_id: input.userId, p_profile_id: input.profileId });

/** The open cards for the strip, soonest game first (not hidden ones); session cards carry their seats left. */
export async function openCards(db: SupabaseClient, input: { organizationId: string; now?: Date }): Promise<Array<ChatCard & { seatsLeft: number | null }>> {
  const now = input.now ?? new Date();
  const { data, error } = await db
    .from('chat_cards')
    .select(CARD_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('status', 'open')
    .gt('starts_at', now.toISOString())
    .order('starts_at', { ascending: true })
    .limit(30);
  if (error) throw error;
  let cards = (data ?? []).map((row) => cardFromRow(row));
  // A card whose message is hidden by reports (or removed) isn't shown.
  if (cards.length > 0) {
    const { data: gone, error: goneError } = await db
      .from('chat_messages')
      .select('card_id')
      .in('card_id', cards.map((c) => c.id))
      .neq('state', 'visible');
    if (goneError) throw goneError;
    const hidden = new Set((gone ?? []).map((row) => row.card_id as string));
    cards = cards.filter((c) => !hidden.has(c.id));
  }
  const sessionIds = cards.filter((c) => c.kind === 'session').map((c) => c.sessionId!);
  const left = sessionIds.length > 0 ? await seatsLeft(db, { organizationId: input.organizationId, sessionIds }) : new Map<string, number>();
  return cards.map((card) => ({ ...card, seatsLeft: card.kind === 'session' ? (left.get(card.sessionId!) ?? 0) : null }));
}

/** The player's upcoming confirmed bookings that can have a card: no active card yet, a space for more than one. */
export async function cardableBookings(
  db: SupabaseClient,
  input: { organizationId: string; profileId: string; now?: Date },
): Promise<Array<{ bookingId: string; label: string; startsAt: string; endsAt: string; maxSpots: number }>> {
  const now = input.now ?? new Date();
  const { data, error } = await db
    .from('resource_bookings')
    .select('id, period, resources(name, capacity, sections(name))')
    .eq('organization_id', input.organizationId)
    .eq('profile_id', input.profileId)
    .eq('status', 'confirmed');
  if (error) throw error;
  const upcoming = (data ?? [])
    .map((row) => {
      const space = row.resources as unknown as { name: string; capacity: number; sections: { name: string } | null } | null;
      const { start, end } = parseTstzRange(row.period as string);
      return { id: row.id as string, start, end, space };
    })
    .filter((b) => b.start > now && b.space !== null && b.space.capacity > 1);
  if (upcoming.length === 0) return [];
  const { data: carded, error: cardError } = await db
    .from('chat_cards')
    .select('resource_booking_id')
    .in('resource_booking_id', upcoming.map((b) => b.id))
    .in('status', ['open', 'full']);
  if (cardError) throw cardError;
  const taken = new Set((carded ?? []).map((row) => row.resource_booking_id as string));
  return upcoming
    .filter((b) => !taken.has(b.id))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((b) => ({
      bookingId: b.id,
      label: `${b.space!.name} · ${b.space!.sections?.name ?? ''}`,
      startsAt: b.start.toISOString(),
      endsAt: b.end.toISOString(),
      maxSpots: Math.min(20, b.space!.capacity - 1),
    }));
}

/**
 * Upcoming open-play games this person can share: any for the team; for a player, those they've asked for a seat in
 * or hold one in. Games they already have an open card for are left out.
 */
export async function shareableSessions(
  db: SupabaseClient,
  input: { organizationId: string; userId: string; profileId: string | null; isTeam: boolean; now?: Date },
): Promise<Array<{ sessionId: string; label: string; startsAt: string }>> {
  const now = input.now ?? new Date();
  let only: string[] | null = null;
  if (!input.isTeam) {
    if (!input.profileId) return [];
    const [requests, seats] = await Promise.all([
      db.from('seat_requests').select('session_id').eq('profile_id', input.profileId),
      db.from('bookings').select('session_id').eq('profile_id', input.profileId).eq('status', 'confirmed'),
    ]);
    if (requests.error) throw requests.error;
    if (seats.error) throw seats.error;
    only = [...new Set([...(requests.data ?? []), ...(seats.data ?? [])].map((row) => row.session_id as string))];
    if (only.length === 0) return [];
  }
  let query = db
    .from('open_play_sessions')
    .select('id, starts_at, activities(name), sections(name)')
    .eq('organization_id', input.organizationId)
    .in('status', ['open', 'matched'])
    .gt('starts_at', now.toISOString())
    .order('starts_at', { ascending: true })
    .limit(30);
  if (only) query = query.in('id', only);
  const { data, error } = await query;
  if (error) throw error;
  const sessions = data ?? [];
  if (sessions.length === 0) return [];
  const { data: posted, error: postedError } = await db
    .from('chat_cards')
    .select('session_id')
    .eq('poster_user_id', input.userId)
    .eq('status', 'open')
    .in('session_id', sessions.map((s) => s.id as string));
  if (postedError) throw postedError;
  const shared = new Set((posted ?? []).map((row) => row.session_id as string));
  return sessions
    .filter((s) => !shared.has(s.id as string))
    .map((s) => {
      const activity = (s.activities as unknown as { name: string } | null)?.name ?? m.notifications.openPlay;
      const section = (s.sections as unknown as { name: string } | null)?.name ?? '';
      return { sessionId: s.id as string, label: `${activity} · ${section}`, startsAt: s.starts_at as string };
    });
}

export interface CardView {
  card: ChatCard;
  /** Who is looking: the poster, an accepted player, someone waiting for an answer, the venue's team, or anyone else. */
  role: 'poster' | 'accepted' | 'waiting' | 'team' | 'other';
  myStatus: ChatJoinStatus | null;
  /** For the poster: who is waiting, with their level for this section. Empty for everyone else. */
  requests: Array<{ profileId: string; name: string; skill: number | null; askedAt: string }>;
  /** Who's in. Only the poster gets their numbers. */
  accepted: Array<{ profileId: string; name: string; phone: string | null }>;
  /** The poster's number, for an accepted player only. */
  posterPhone: string | null;
}

/**
 * One card's page. Mobile numbers are read only for the two sides of an Accept: the poster sees their accepted
 * players' numbers, and an accepted player sees the poster's. Nobody else gets a number.
 */
export async function cardView(
  db: SupabaseClient,
  input: { organizationId: string; cardId: string; viewer: { userId: string; profileId: string | null; isTeam: boolean } },
): Promise<CardView | null> {
  if (!UUID.test(input.cardId)) return null;
  const { data: row, error } = await db.from('chat_cards').select(CARD_COLUMNS).eq('id', input.cardId).eq('organization_id', input.organizationId).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const card = cardFromRow(row);

  const { data: rows, error: requestsError } = await db.from('chat_join_requests').select('profile_id, status, created_at').eq('card_id', card.id);
  if (requestsError) throw requestsError;
  const requests = (rows ?? []).map((r) => ({ profileId: r.profile_id as string, status: r.status as ChatJoinStatus, createdAt: r.created_at as string }));
  const mine = input.viewer.profileId ? requests.find((r) => r.profileId === input.viewer.profileId) : undefined;
  const myStatus = mine?.status ?? null;
  const role: CardView['role'] =
    card.posterUserId === input.viewer.userId
      ? 'poster'
      : myStatus === 'accepted'
        ? 'accepted'
        : myStatus === 'pending'
          ? 'waiting'
          : input.viewer.isTeam
            ? 'team'
            : 'other';

  const pending = role === 'poster' ? requests.filter((r) => r.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
  const accepted = requests.filter((r) => r.status === 'accepted');
  const ids = [...pending, ...accepted].map((r) => r.profileId);
  const withPhones = role === 'poster';
  const [profiles, skills, poster] = await Promise.all([
    ids.length > 0 ? db.from('player_profiles').select(withPhones ? 'id, display_name, phone' : 'id, display_name').in('id', ids) : null,
    pending.length > 0
      ? db.from('profile_section_skills').select('profile_id, skill').eq('section_id', card.sectionId).in('profile_id', pending.map((r) => r.profileId))
      : null,
    role === 'accepted' && card.posterProfileId ? db.from('player_profiles').select('phone').eq('id', card.posterProfileId).maybeSingle() : null,
  ]);
  for (const result of [profiles, skills, poster]) if (result?.error) throw result.error;
  const byId = new Map(((profiles?.data ?? []) as unknown as Array<{ id: string; display_name: string; phone?: string | null }>).map((p) => [p.id, p]));
  const skillOf = new Map(((skills?.data ?? []) as Array<{ profile_id: string; skill: number }>).map((s) => [s.profile_id, s.skill]));

  return {
    card,
    role,
    myStatus,
    requests: pending.map((r) => ({ profileId: r.profileId, name: byId.get(r.profileId)?.display_name ?? '', skill: skillOf.get(r.profileId) ?? null, askedAt: r.createdAt })),
    accepted: accepted.map((r) => ({
      profileId: r.profileId,
      name: byId.get(r.profileId)?.display_name ?? '',
      phone: withPhones ? (byId.get(r.profileId)?.phone ?? null) : null,
    })),
    posterPhone: role === 'accepted' ? ((poster?.data as { phone: string | null } | null)?.phone ?? null) : null,
  };
}
