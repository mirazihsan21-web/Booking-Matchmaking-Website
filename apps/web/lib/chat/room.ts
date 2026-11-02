import type { SupabaseClient } from '@supabase/supabase-js';
import { CARD_COLUMNS, cardFromRow, mergeMessages, MESSAGE_COLUMNS, messageFromRow, type ChatCard, type ChatMessage } from './rows';

/**
 * A page of the room, oldest first, with the cards its messages show. Runs under the reader's own row rules, in the
 * browser (Load earlier, catching up after a reconnect) or on the server. Default: the newest `limit` messages;
 * `before`: the ones up to that time (Load earlier); `after`: the ones from that time on (catch-up). The edges are
 * inclusive so nothing sent at the same moment is skipped — mergeMessages drops the repeats.
 */
export async function roomPage(
  db: SupabaseClient,
  input: { organizationId: string; before?: string; after?: string; limit?: number },
): Promise<{ messages: ChatMessage[]; cards: ChatCard[] }> {
  const limit = input.limit ?? 50;
  let query = db.from('chat_messages').select(MESSAGE_COLUMNS).eq('organization_id', input.organizationId);
  if (input.after) {
    query = query.gte('created_at', input.after).order('created_at', { ascending: true }).order('id', { ascending: true });
  } else {
    if (input.before) query = query.lte('created_at', input.before);
    query = query.order('created_at', { ascending: false }).order('id', { ascending: false });
  }
  const { data, error } = await query.limit(limit);
  if (error) throw error;
  const messages = mergeMessages([], (data ?? []).map((row) => messageFromRow(row)));
  return { messages, cards: await cardsFor(db, messages) };
}

/** The cards these messages point at. */
export async function cardsFor(db: SupabaseClient, messages: ChatMessage[]): Promise<ChatCard[]> {
  const ids = [...new Set(messages.map((m) => m.cardId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return [];
  const { data, error } = await db.from('chat_cards').select(CARD_COLUMNS).in('id', ids);
  if (error) throw error;
  return (data ?? []).map((row) => cardFromRow(row));
}

/**
 * Everything from `after` on, a page at a time (a phone that slept can miss more than one page). Stops after
 * `maxPages`; `complete: false` then means there is more than that — the room starts again from the newest page.
 */
export async function roomSince(
  db: SupabaseClient,
  input: { organizationId: string; after: string; maxPages?: number },
): Promise<{ messages: ChatMessage[]; cards: ChatCard[]; complete: boolean }> {
  const maxPages = input.maxPages ?? 10;
  let messages: ChatMessage[] = [];
  let cards: ChatCard[] = [];
  let cursor = input.after;
  for (let page = 0; page < maxPages; page += 1) {
    const next = await roomPage(db, { organizationId: input.organizationId, after: cursor });
    messages = mergeMessages(messages, next.messages);
    cards = [...cards, ...next.cards];
    const last = next.messages.at(-1);
    if (next.messages.length < 50 || !last) return { messages, cards, complete: true };
    if (last.createdAt === cursor) break; // a whole page at one moment: give up and start again from the newest
    cursor = last.createdAt;
  }
  return { messages, cards, complete: false };
}
