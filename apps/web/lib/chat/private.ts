import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatRefusal } from '@/lib/forms/chat';

// Private conversations, as the pages need them. Each function takes the service client: players can't read each
// other's profiles, so names come from here, after the page has checked who is asking.

/** Is this profile a player at the brand (not a team login)? */
async function playerName(db: SupabaseClient, organizationId: string, profileId: string): Promise<string | null> {
  const { data: profile, error } = await db.from('player_profiles').select('user_id, display_name').eq('id', profileId).eq('organization_id', organizationId).maybeSingle();
  if (error) throw error;
  if (!profile) return null;
  const { data: member } = await db.from('organization_members').select('user_id').eq('organization_id', organizationId).eq('user_id', profile.user_id).maybeSingle();
  return member ? null : (profile.display_name as string);
}

export interface ConversationSummary {
  conversationId: string;
  otherProfileId: string;
  otherName: string;
  /** The last message's words (null for a photo on its own, or a removed message). */
  lastText: string | null;
  lastHasPhoto: boolean;
  lastAt: string;
  unread: number;
}

/** This player's conversations, the latest first, with the other person's name, the last message and the unread count. */
export async function listConversations(db: SupabaseClient, input: { organizationId: string; profileId: string }): Promise<ConversationSummary[]> {
  const { data: conversations, error } = await db
    .from('chat_conversations')
    .select('id, profile_low, profile_high, last_message_at')
    .eq('organization_id', input.organizationId)
    .or(`profile_low.eq.${input.profileId},profile_high.eq.${input.profileId}`)
    .order('last_message_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  const rows = (conversations ?? []).map((c) => ({
    id: c.id as string,
    other: (c.profile_low === input.profileId ? c.profile_high : c.profile_low) as string,
    lastAt: c.last_message_at as string,
  }));
  if (rows.length === 0) return [];

  const [names, reads] = await Promise.all([
    db.from('player_profiles').select('id, display_name').in('id', rows.map((r) => r.other)),
    db.from('chat_conversation_reads').select('conversation_id, read_at').eq('profile_id', input.profileId).in('conversation_id', rows.map((r) => r.id)),
  ]);
  if (names.error) throw names.error;
  if (reads.error) throw reads.error;
  const nameOf = new Map((names.data ?? []).map((p) => [p.id as string, p.display_name as string]));
  const readAt = new Map((reads.data ?? []).map((r) => [r.conversation_id as string, r.read_at as string | null]));

  return Promise.all(
    rows.map(async (row) => {
      const [last, unread] = await Promise.all([
        db.from('chat_messages').select('body, photo_path, state').eq('conversation_id', row.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        (() => {
          let query = db
            .from('chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', row.id)
            .eq('state', 'visible')
            .neq('author_profile_id', input.profileId);
          const at = readAt.get(row.id);
          if (at) query = query.gt('created_at', at);
          return query;
        })(),
      ]);
      if (last.error) throw last.error;
      if (unread.error) throw unread.error;
      const visible = last.data?.state === 'visible';
      return {
        conversationId: row.id,
        otherProfileId: row.other,
        otherName: nameOf.get(row.other) ?? '',
        lastText: visible ? ((last.data?.body as string | null) ?? null) : null,
        lastHasPhoto: visible && Boolean(last.data?.photo_path),
        lastAt: row.lastAt,
        unread: unread.count ?? 0,
      };
    }),
  );
}

/**
 * Whether this player can talk with that one: null when the other is missing, yourself or a team login; otherwise
 * their name, the conversation so far (null before the first message) and whether either has blocked the other.
 */
export async function conversationWith(
  db: SupabaseClient,
  input: { organizationId: string; profileId: string; otherProfileId: string },
): Promise<{ conversationId: string | null; otherName: string; blockedByMe: boolean; blockedMe: boolean } | null> {
  if (input.otherProfileId === input.profileId) return null;
  const otherName = await playerName(db, input.organizationId, input.otherProfileId);
  if (otherName === null) return null;
  const [low, high] = [input.profileId, input.otherProfileId].sort();
  const [conversation, blocks] = await Promise.all([
    db.from('chat_conversations').select('id').eq('organization_id', input.organizationId).eq('profile_low', low!).eq('profile_high', high!).maybeSingle(),
    db
      .from('chat_blocks')
      .select('blocker_profile_id')
      .eq('organization_id', input.organizationId)
      .or(
        `and(blocker_profile_id.eq.${input.profileId},blocked_profile_id.eq.${input.otherProfileId}),and(blocker_profile_id.eq.${input.otherProfileId},blocked_profile_id.eq.${input.profileId})`,
      ),
  ]);
  if (conversation.error) throw conversation.error;
  if (blocks.error) throw blocks.error;
  const blockers = new Set((blocks.data ?? []).map((b) => b.blocker_profile_id as string));
  return {
    conversationId: (conversation.data?.id as string | undefined) ?? null,
    otherName,
    blockedByMe: blockers.has(input.profileId),
    blockedMe: blockers.has(input.otherProfileId),
  };
}

async function call<T extends string>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T | ChatRefusal> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  return data as T | ChatRefusal;
}

export const blockPlayer = (db: SupabaseClient, input: { organizationId: string; userId: string; profileId: string }) =>
  call<'blocked'>(db, 'block_chat_player', { p_organization_id: input.organizationId, p_user_id: input.userId, p_profile_id: input.profileId });
export const unblockPlayer = (db: SupabaseClient, input: { organizationId: string; userId: string; profileId: string }) =>
  call<'unblocked'>(db, 'unblock_chat_player', { p_organization_id: input.organizationId, p_user_id: input.userId, p_profile_id: input.profileId });

/** The players this player has blocked (their room messages and cards are hidden from them). */
export async function blockedByMe(db: SupabaseClient, input: { organizationId: string; profileId: string }): Promise<string[]> {
  const { data, error } = await db.from('chat_blocks').select('blocked_profile_id').eq('organization_id', input.organizationId).eq('blocker_profile_id', input.profileId);
  if (error) throw error;
  return (data ?? []).map((row) => row.blocked_profile_id as string);
}

/** The small panel behind a player's name: their name, the sections they play, and whether you've blocked them. */
export async function playerCard(
  db: SupabaseClient,
  input: { organizationId: string; profileId: string; viewerProfileId: string | null },
): Promise<{ name: string; sections: string[]; blockedByMe: boolean } | null> {
  const name = await playerName(db, input.organizationId, input.profileId);
  if (name === null) return null;
  const [skills, block] = await Promise.all([
    db.from('profile_section_skills').select('sections(name)').eq('profile_id', input.profileId),
    input.viewerProfileId
      ? db.from('chat_blocks').select('blocked_profile_id').eq('blocker_profile_id', input.viewerProfileId).eq('blocked_profile_id', input.profileId).maybeSingle()
      : null,
  ]);
  if (skills.error) throw skills.error;
  if (block?.error) throw block.error;
  const sections = (skills.data ?? [])
    .map((row) => (row.sections as unknown as { name: string } | null)?.name)
    .filter((section): section is string => Boolean(section))
    .sort();
  return { name, sections, blockedByMe: Boolean(block?.data) };
}
