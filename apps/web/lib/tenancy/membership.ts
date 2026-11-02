import type { SupabaseClient } from '@supabase/supabase-js';

export interface TeamMembership {
  role: 'owner' | 'staff';
  displayName: string;
  phone: string | null;
  /** When they joined the team (ISO). */
  memberSince: string;
}

/**
 * The person's membership of the organisation (role, own name and mobile, join date), or null when they aren't
 * on its team. A failed read throws: code running before its migration (a missing column) must show as an
 * error, not as "not on the team". Not `server-only`, so it can be tested.
 */
export async function readTeamMembership(db: SupabaseClient, organizationId: string, userId: string): Promise<TeamMembership | null> {
  const { data, error } = await db
    .from('organization_members')
    .select('role, display_name, phone, created_at')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .limit(1);
  if (error) throw error;
  const row = data[0];
  if (!row) return null;
  return { role: row.role, displayName: row.display_name, phone: row.phone ?? null, memberSince: row.created_at };
}
