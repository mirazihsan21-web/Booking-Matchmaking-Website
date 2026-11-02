import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatRefusal } from '@/lib/forms/chat';
import { maskBadWords } from './filter';
import { blockedWords } from './moderation';

const masked = async (db: SupabaseClient, organizationId: string, body: string | null) =>
  body === null ? null : maskBadWords(body, await blockedWords(db, organizationId));

/** Posts to the room — words and/or a photo — bad words masked first (the built-in list plus the venue's own). Takes the service client. */
export async function postMessage(
  db: SupabaseClient,
  input: { organizationId: string; userId: string; body: string | null; photoPath: string | null },
): Promise<{ status: 'posted'; messageId: string } | { status: ChatRefusal }> {
  const { data, error } = await db.rpc('post_chat_message', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_body: await masked(db, input.organizationId, input.body),
    p_photo_path: input.photoPath,
  });
  if (error) throw error;
  const row = (data as Array<{ status: string; message_id: string | null }>)[0]!;
  return row.status === 'posted' ? { status: 'posted', messageId: row.message_id! } : { status: row.status as ChatRefusal };
}

/** Removes a message: the author's own, or (byVenue) any message by a team member. */
export async function removeMessage(db: SupabaseClient, input: { messageId: string; userId: string; byVenue: boolean }): Promise<'removed' | ChatRefusal> {
  const { data, error } = await db.rpc('remove_chat_message', { p_message_id: input.messageId, p_user_id: input.userId, p_by_venue: input.byVenue });
  if (error) throw error;
  return data as 'removed' | ChatRefusal;
}

/** Sends a private message (words and/or a photo) to another player, filtered like the room. */
export async function postPrivateMessage(
  db: SupabaseClient,
  input: { organizationId: string; userId: string; toProfileId: string; body: string | null; photoPath: string | null },
): Promise<{ status: 'posted'; messageId: string; conversationId: string } | { status: ChatRefusal }> {
  const { data, error } = await db.rpc('post_private_message', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_to_profile_id: input.toProfileId,
    p_body: await masked(db, input.organizationId, input.body),
    p_photo_path: input.photoPath,
  });
  if (error) throw error;
  const row = (data as Array<{ status: string; message_id: string | null; conversation_id: string | null }>)[0]!;
  return row.status === 'posted'
    ? { status: 'posted', messageId: row.message_id!, conversationId: row.conversation_id! }
    : { status: row.status as ChatRefusal };
}
