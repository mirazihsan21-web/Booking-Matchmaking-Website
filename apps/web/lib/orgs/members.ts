import type { SupabaseClient } from '@supabase/supabase-js';
import { memberEmails } from './invites';

export type Role = 'owner' | 'staff';

export interface Member {
  userId: string;
  email: string | null;
  role: Role;
}

export async function listMembers(db: SupabaseClient, organizationId: string): Promise<Member[]> {
  const { data, error } = await db
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('organization_id', organizationId)
    .order('created_at');
  if (error) throw error;
  const emails = await memberEmails(db, organizationId);
  return data.map((row) => ({ userId: row.user_id, email: emails.get(row.user_id) ?? null, role: row.role as Role }));
}

async function isOnlyOwner(db: SupabaseClient, organizationId: string, userId: string): Promise<boolean> {
  const { data, error } = await db.from('organization_members').select('user_id').eq('organization_id', organizationId).eq('role', 'owner');
  if (error) throw error;
  return data.length === 1 && data[0]!.user_id === userId;
}

/** An organization must always keep at least one owner. */
export async function changeRole(db: SupabaseClient, organizationId: string, userId: string, role: Role): Promise<{ status: 'ok' } | { status: 'last_owner' }> {
  if (role === 'staff' && (await isOnlyOwner(db, organizationId, userId))) return { status: 'last_owner' };
  const { error } = await db.from('organization_members').update({ role }).eq('organization_id', organizationId).eq('user_id', userId);
  if (error) throw error;
  return { status: 'ok' };
}

export async function removeMember(db: SupabaseClient, organizationId: string, userId: string): Promise<{ status: 'ok' } | { status: 'last_owner' }> {
  if (await isOnlyOwner(db, organizationId, userId)) return { status: 'last_owner' };
  const { error } = await db.from('organization_members').delete().eq('organization_id', organizationId).eq('user_id', userId);
  if (error) throw error;
  return { status: 'ok' };
}
