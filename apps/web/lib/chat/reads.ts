import type { SupabaseClient } from '@supabase/supabase-js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether the Chat link shows its dot: a visible room message by someone else — not a player they blocked — that's
 * newer than where this person last read up to (or any such message, before they've ever opened the chat). Runs
 * under the reader's row rules.
 */
export async function hasUnreadRoom(db: SupabaseClient, input: { organizationId: string; userId: string; blocked?: string[] }): Promise<boolean> {
  const { data: read, error: readError } = await db
    .from('chat_reads')
    .select('room_read_at')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (readError) throw readError;
  let query = db
    .from('chat_messages')
    .select('id')
    .eq('organization_id', input.organizationId)
    .is('conversation_id', null)
    .neq('author_user_id', input.userId)
    .eq('state', 'visible');
  if (read) query = query.gt('created_at', read.room_read_at as string);
  // Players you blocked don't count (the venue's own messages have no profile, so they always do).
  const blocked = (input.blocked ?? []).filter((id) => UUID.test(id));
  if (blocked.length > 0) query = query.or(`author_profile_id.is.null,author_profile_id.not.in.(${blocked.join(',')})`);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** This person has read the room up to `at` (the newest message they've seen). The browser writes its own row. */
export async function markRoomRead(db: SupabaseClient, input: { organizationId: string; userId: string; at: string }): Promise<void> {
  const { error } = await db
    .from('chat_reads')
    .upsert({ organization_id: input.organizationId, user_id: input.userId, room_read_at: input.at }, { onConflict: 'organization_id,user_id' });
  if (error) throw error;
}

/** Unread private messages for the signed-in player (the Chat link's number). Runs under their own row rules. */
export async function privateUnread(db: SupabaseClient, organizationId: string): Promise<number> {
  const { data, error } = await db.rpc('chat_private_unread', { p_organization_id: organizationId });
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/**
 * This player has read a conversation up to `at`. The browser may only set `read_at` (not when the reminder went),
 * so it updates its row, or adds it the first time.
 */
export async function markConversationRead(
  db: SupabaseClient,
  input: { conversationId: string; organizationId: string; profileId: string; at: string },
): Promise<void> {
  const { data, error } = await db
    .from('chat_conversation_reads')
    .update({ read_at: input.at })
    .eq('conversation_id', input.conversationId)
    .eq('profile_id', input.profileId)
    .select('profile_id');
  if (error) throw error;
  if ((data ?? []).length > 0) return;
  const added = await db
    .from('chat_conversation_reads')
    .insert({ conversation_id: input.conversationId, organization_id: input.organizationId, profile_id: input.profileId, read_at: input.at });
  if (added.error && added.error.code !== '23505') throw added.error; // another tab got there first
}
