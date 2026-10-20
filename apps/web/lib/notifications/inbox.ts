import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationKind } from './render';

export interface InboxItem {
  id: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  link: string;
  readAt: string | null;
  createdAt: string;
}

/** A player's notifications at one venue, newest first. Pass the player's own (RLS) client. */
export async function listNotifications(db: SupabaseClient, profileId: string, organizationId: string, limit = 50): Promise<InboxItem[]> {
  const { data, error } = await db
    .from('notifications')
    .select('id, kind, payload, link, read_at, created_at')
    .eq('profile_id', profileId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((n) => ({
    id: n.id,
    kind: n.kind as NotificationKind,
    payload: (n.payload ?? {}) as Record<string, unknown>,
    link: n.link,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}

export async function unreadCount(db: SupabaseClient, profileId: string, organizationId: string): Promise<number> {
  const { count, error } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('organization_id', organizationId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markAllRead(db: SupabaseClient, profileId: string, organizationId: string): Promise<void> {
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .eq('organization_id', organizationId)
    .is('read_at', null);
  if (error) throw error;
}
