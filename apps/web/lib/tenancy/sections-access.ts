import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Which sections a team member runs: the owner every section of the brand, staff the sections they
 * were given (section_staff). Pass the service client; the caller has checked who is signed in.
 * Not `server-only`, so the integration tests can call it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function roleOf(db: SupabaseClient, organizationId: string, userId: string): Promise<'owner' | 'staff' | null> {
  const { data, error } = await db.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data?.role as 'owner' | 'staff' | undefined) ?? null;
}

/** The section ids this member runs, in display order; [] for someone outside the team. */
export async function allowedSectionIds(db: SupabaseClient, input: { organizationId: string; userId: string }): Promise<string[]> {
  if (!UUID.test(input.organizationId) || !UUID.test(input.userId)) return [];
  const role = await roleOf(db, input.organizationId, input.userId);
  if (!role) return [];
  const { data, error } = await db.from('sections').select('id, section_staff(user_id)').eq('organization_id', input.organizationId).order('position').order('name');
  if (error) throw error;
  const rows = data as Array<{ id: string; section_staff: Array<{ user_id: string }> }>;
  return rows.filter((s) => role === 'owner' || s.section_staff.some((x) => x.user_id === input.userId)).map((s) => s.id);
}

/** Whether this member may run the section (it must be this organization's). */
export async function canManageSection(db: SupabaseClient, input: { organizationId: string; userId: string; sectionId: string }): Promise<boolean> {
  if (!UUID.test(input.sectionId)) return false;
  return (await allowedSectionIds(db, input)).includes(input.sectionId);
}
