import type { SupabaseClient } from '@supabase/supabase-js';
import { addSectionStaff, memberEmails, ownSections } from './invites';

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

/**
 * An organization must always keep at least one owner. An owner made staff keeps running every
 * section (the owner can narrow that later); staff made owner lose their section rows (owners run all).
 */
export async function changeRole(db: SupabaseClient, organizationId: string, userId: string, role: Role): Promise<{ status: 'ok' } | { status: 'last_owner' }> {
  if (role === 'staff' && (await isOnlyOwner(db, organizationId, userId))) return { status: 'last_owner' };
  const { data: before, error: readError } = await db.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle();
  if (readError) throw readError;
  if (!before || before.role === role) return { status: 'ok' };
  const { error } = await db.from('organization_members').update({ role }).eq('organization_id', organizationId).eq('user_id', userId);
  if (error) throw error;
  if (role === 'staff') {
    const { data: sections, error: sectionsError } = await db.from('sections').select('id').eq('organization_id', organizationId);
    if (sectionsError) throw sectionsError;
    await addSectionStaff(db, organizationId, userId, sections.map((s) => s.id as string));
  } else {
    const { error: deleteError } = await db.from('section_staff').delete().eq('organization_id', organizationId).eq('user_id', userId);
    if (deleteError) throw deleteError;
  }
  return { status: 'ok' };
}

export async function removeMember(db: SupabaseClient, organizationId: string, userId: string): Promise<{ status: 'ok' } | { status: 'last_owner' }> {
  if (await isOnlyOwner(db, organizationId, userId)) return { status: 'last_owner' };
  const { error } = await db.from('organization_members').delete().eq('organization_id', organizationId).eq('user_id', userId);
  if (error) throw error;
  return { status: 'ok' };
}

/**
 * Sets exactly which sections a staff member runs (at least one, all this organization's). Owners run
 * every section, so they have none to set. The new sections are added before the old ones go, so the
 * person is never left with none.
 */
export async function setStaffSections(
  db: SupabaseClient,
  input: { organizationId: string; userId: string; sectionIds: string[] },
): Promise<'saved' | 'none_selected' | 'not_staff' | 'invalid_section'> {
  const wanted = [...new Set(input.sectionIds)];
  if (wanted.length === 0) return 'none_selected';
  const { data: member, error } = await db.from('organization_members').select('role').eq('organization_id', input.organizationId).eq('user_id', input.userId).maybeSingle();
  if (error) throw error;
  if (member?.role !== 'staff') return 'not_staff';
  const sections = await ownSections(db, input.organizationId, wanted);
  if (sections.length !== wanted.length) return 'invalid_section';
  await addSectionStaff(db, input.organizationId, input.userId, sections);
  const { error: deleteError } = await db
    .from('section_staff')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .not('section_id', 'in', `(${sections.join(',')})`);
  if (deleteError) throw deleteError;
  return 'saved';
}
