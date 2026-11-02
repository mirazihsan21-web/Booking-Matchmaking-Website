import type { BusinessType } from '@/presets/types';

// The chat's rows as the app uses them, from a query or from a Realtime change (both snake_case). Safe in the browser.

export type ChatMessageState = 'visible' | 'removed_by_author' | 'removed_by_venue' | 'hidden_by_reports';
export type ChatCardStatus = 'open' | 'full' | 'closed' | 'cancelled' | 'started';
export type ChatJoinStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'left' | 'removed' | 'expired';

export interface ChatMessage {
  id: string;
  authorKind: 'player' | 'team';
  authorUserId: string;
  authorProfileId: string | null;
  /** The sender's name when they wrote it (the brand's name for the team). */
  authorName: string;
  /** Null once removed or hidden. */
  body: string | null;
  cardId: string | null;
  /** The private conversation it's in (null: the room). */
  conversationId: string | null;
  /** Its photo in the chat-photos bucket, if it has one. */
  photoPath: string | null;
  state: ChatMessageState;
  createdAt: string;
}

export interface ChatCard {
  id: string;
  kind: 'booking' | 'session';
  sessionId: string | null;
  posterUserId: string;
  posterProfileId: string | null;
  posterName: string;
  sectionId: string;
  sectionName: string;
  sectionKind: BusinessType;
  sectionAccent: string;
  /** The space ("Pitch 1") for a booking, the game ("5-a-side") for a session. */
  title: string;
  startsAt: string;
  endsAt: string;
  seatPricePoisha: number | null;
  spotsNeeded: number | null;
  spotsTaken: number;
  note: string | null;
  status: ChatCardStatus;
  createdAt: string;
}

export const MESSAGE_COLUMNS = 'id, author_kind, author_user_id, author_profile_id, author_name, body, card_id, conversation_id, photo_path, state, created_at';
export const CARD_COLUMNS =
  'id, kind, session_id, poster_user_id, poster_profile_id, poster_name, section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, seat_price_poisha, spots_needed, spots_taken, note, status, created_at';

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null);
const numberOrNull = (value: unknown) => (typeof value === 'number' ? value : null);

export function messageFromRow(row: Record<string, unknown>): ChatMessage {
  return {
    id: text(row.id),
    authorKind: row.author_kind === 'team' ? 'team' : 'player',
    authorUserId: text(row.author_user_id),
    authorProfileId: textOrNull(row.author_profile_id),
    authorName: text(row.author_name),
    body: textOrNull(row.body),
    cardId: textOrNull(row.card_id),
    conversationId: textOrNull(row.conversation_id),
    photoPath: textOrNull(row.photo_path),
    state: (textOrNull(row.state) ?? 'visible') as ChatMessageState,
    createdAt: text(row.created_at),
  };
}

export function cardFromRow(row: Record<string, unknown>): ChatCard {
  return {
    id: text(row.id),
    kind: row.kind === 'session' ? 'session' : 'booking',
    sessionId: textOrNull(row.session_id),
    posterUserId: text(row.poster_user_id),
    posterProfileId: textOrNull(row.poster_profile_id),
    posterName: text(row.poster_name),
    sectionId: text(row.section_id),
    sectionName: text(row.section_name),
    sectionKind: text(row.section_kind) as BusinessType,
    sectionAccent: text(row.section_accent),
    title: text(row.title),
    startsAt: text(row.starts_at),
    endsAt: text(row.ends_at),
    seatPricePoisha: numberOrNull(row.seat_price_poisha),
    spotsNeeded: numberOrNull(row.spots_needed),
    spotsTaken: numberOrNull(row.spots_taken) ?? 0,
    note: textOrNull(row.note),
    status: (textOrNull(row.status) ?? 'open') as ChatCardStatus,
    createdAt: text(row.created_at),
  };
}

const order = (a: ChatMessage, b: ChatMessage) => {
  const time = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return time !== 0 ? time : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * The room after new or changed rows arrive: one copy per id (Realtime can deliver a row twice, and a catch-up read
 * overlaps what's shown), the incoming row winning, oldest first (same moment: by id).
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(order);
}

/**
 * The room after live *changes* (removed, hidden, restored) arrive. A change to a message the room shows replaces it;
 * a change to one newer than the oldest shown is added (it may have been missed); a change to anything older is left
 * out — adding it would put it at the top and make Load earlier skip everything between it and the room.
 */
export function mergeUpdates(current: ChatMessage[], updated: ChatMessage[]): ChatMessage[] {
  const oldest = current[0];
  const shown = new Set(current.map((m) => m.id));
  const keep = updated.filter((m) => shown.has(m.id) || !oldest || order(m, oldest) >= 0);
  return keep.length === 0 ? current : mergeMessages(current, keep);
}
