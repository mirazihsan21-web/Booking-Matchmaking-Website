import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatRefusal } from '@/lib/forms/chat';
import { maskBadWords } from './filter';
import type { ChatMessageState } from './rows';

// Reports, mutes and the venue's word list. Each function takes the service client: the server action has already
// checked who is asking, and the SQL function checks again (team-only actions need a team member).

type Status<T extends string> = T | ChatRefusal;

async function call<T extends string>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Status<T>> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  return data as Status<T>;
}

/** The venue's own words for the filter. */
export async function blockedWords(db: SupabaseClient, organizationId: string): Promise<string[]> {
  const { data, error } = await db.from('chat_blocked_words').select('word').eq('organization_id', organizationId);
  if (error) throw error;
  return (data ?? []).map((row) => row.word as string);
}

export async function reportMessage(
  db: SupabaseClient,
  input: { messageId: string; userId: string; reason: 'spam' | 'abuse' | 'photo' | 'other'; note: string | null },
): Promise<Status<'reported'>> {
  const { data: message } = await db.from('chat_messages').select('organization_id').eq('id', input.messageId).maybeSingle();
  const note = input.note && message ? maskBadWords(input.note, await blockedWords(db, message.organization_id as string)) : input.note;
  return call(db, 'report_chat_message', { p_message_id: input.messageId, p_user_id: input.userId, p_reason: input.reason, p_note: note });
}

export function resolveReports(db: SupabaseClient, input: { messageId: string; userId: string; action: 'remove' | 'dismiss' }): Promise<Status<'resolved'>> {
  return call(db, 'resolve_chat_reports', { p_message_id: input.messageId, p_user_id: input.userId, p_action: input.action });
}

export function mutePlayer(
  db: SupabaseClient,
  input: { organizationId: string; userId: string; profileId: string; days: 1 | 7 | null },
): Promise<Status<'muted'>> {
  return call(db, 'mute_chat_player', { p_organization_id: input.organizationId, p_user_id: input.userId, p_profile_id: input.profileId, p_days: input.days });
}

export function unmutePlayer(db: SupabaseClient, input: { organizationId: string; userId: string; profileId: string }): Promise<Status<'unmuted'>> {
  return call(db, 'unmute_chat_player', { p_organization_id: input.organizationId, p_user_id: input.userId, p_profile_id: input.profileId });
}

export function setBlockedWord(
  db: SupabaseClient,
  input: { organizationId: string; userId: string; word: string; add: boolean },
): Promise<Status<'added' | 'removed'>> {
  return call(db, 'set_chat_blocked_word', { p_organization_id: input.organizationId, p_user_id: input.userId, p_word: input.word, p_add: input.add });
}

/** This player's mute while it lasts (`until` null: until the venue unmutes them), else null. */
export async function myMute(db: SupabaseClient, input: { organizationId: string; profileId: string }): Promise<{ until: string | null } | null> {
  const { data, error } = await db.from('chat_mutes').select('until').eq('organization_id', input.organizationId).eq('profile_id', input.profileId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const until = data.until as string | null;
  return until === null || new Date(until).getTime() > Date.now() ? { until } : null;
}

export interface OpenReport {
  messageId: string;
  authorName: string;
  authorProfileId: string | null;
  /** What was reported, as the first report copied it. */
  bodyCopy: string | null;
  state: ChatMessageState;
  createdAt: string;
  reports: Array<{ reporterName: string; reason: string; note: string | null; createdAt: string }>;
}

/** Open reports, one entry per reported message, the most recently reported first. */
export async function listOpenReports(db: SupabaseClient, organizationId: string): Promise<OpenReport[]> {
  const { data, error } = await db
    .from('chat_reports')
    .select('message_id, reason, note, body_copy, author_name_copy, created_at, reporter:player_profiles(display_name), chat_messages(state, author_profile_id, created_at)')
    .eq('organization_id', organizationId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const byMessage = new Map<string, OpenReport>();
  for (const row of data ?? []) {
    const message = row.chat_messages as unknown as { state: ChatMessageState; author_profile_id: string | null; created_at: string } | null;
    const reporter = row.reporter as unknown as { display_name: string } | null;
    const entry =
      byMessage.get(row.message_id as string) ??
      byMessage
        .set(row.message_id as string, {
          messageId: row.message_id as string,
          authorName: row.author_name_copy as string,
          authorProfileId: message?.author_profile_id ?? null,
          bodyCopy: (row.body_copy as string | null) ?? null,
          state: message?.state ?? 'visible',
          createdAt: message?.created_at ?? (row.created_at as string),
          reports: [],
        })
        .get(row.message_id as string)!;
    entry.bodyCopy ??= (row.body_copy as string | null) ?? null;
    entry.reports.push({ reporterName: reporter?.display_name ?? '', reason: row.reason as string, note: (row.note as string | null) ?? null, createdAt: row.created_at as string });
  }
  return [...byMessage.values()];
}

/** How many messages wait for the team (the Manage menu's count). */
export async function openReportCount(db: SupabaseClient, organizationId: string): Promise<number> {
  const { data, error } = await db.from('chat_reports').select('message_id').eq('organization_id', organizationId).eq('status', 'open');
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.message_id as string)).size;
}

/** Muted players while their mute lasts, soonest to end first (until unmuted last). */
export async function listMutes(db: SupabaseClient, organizationId: string): Promise<Array<{ profileId: string; name: string; until: string | null }>> {
  const { data, error } = await db.from('chat_mutes').select('profile_id, until, player_profiles(display_name)').eq('organization_id', organizationId);
  if (error) throw error;
  const now = Date.now();
  return (data ?? [])
    .map((row) => ({
      profileId: row.profile_id as string,
      name: (row.player_profiles as unknown as { display_name: string } | null)?.display_name ?? '',
      until: (row.until as string | null) ?? null,
    }))
    .filter((mute) => mute.until === null || new Date(mute.until).getTime() > now)
    .sort((a, b) => (a.until === null ? 1 : b.until === null ? -1 : a.until.localeCompare(b.until)));
}
