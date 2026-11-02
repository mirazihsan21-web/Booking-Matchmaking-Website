import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether the Chat link shows its dot: a visible room message by someone else that's newer than where this person
 * last read up to (or any such message, before they've ever opened the chat). Runs under the reader's row rules.
 */
export async function hasUnreadRoom(db: SupabaseClient, input: { organizationId: string; userId: string }): Promise<boolean> {
  const { data: read, error: readError } = await db
    .from('chat_reads')
    .select('room_read_at')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (readError) throw readError;
  let query = db.from('chat_messages').select('id').eq('organization_id', input.organizationId).neq('author_user_id', input.userId).eq('state', 'visible');
  if (read) query = query.gt('created_at', read.room_read_at as string);
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
