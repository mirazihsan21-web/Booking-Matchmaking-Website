import type { SupabaseClient } from '@supabase/supabase-js';

/** Email addresses of these logins (any that has none, or no longer exists, is left out). Takes the service client. */
async function emailsOf(db: SupabaseClient, userIds: string[]): Promise<string[]> {
  const users = await Promise.all([...new Set(userIds)].map((id) => db.auth.admin.getUserById(id)));
  return users.map((u) => u.data.user?.email).filter((email): email is string => Boolean(email));
}

/** The brand's owners. */
export async function ownerEmails(db: SupabaseClient, organizationId: string): Promise<string[]> {
  const { data, error } = await db.from('organization_members').select('user_id').eq('organization_id', organizationId).eq('role', 'owner');
  if (error) throw error;
  return emailsOf(db, (data ?? []).map((r) => r.user_id as string));
}

/** Who hears about a payment to check in a section: the owners, and the staff who run that section. */
export async function teamForSection(db: SupabaseClient, input: { organizationId: string; sectionId: string }): Promise<string[]> {
  const [owners, staff] = await Promise.all([
    db.from('organization_members').select('user_id').eq('organization_id', input.organizationId).eq('role', 'owner'),
    db.from('section_staff').select('user_id').eq('organization_id', input.organizationId).eq('section_id', input.sectionId),
  ]);
  if (owners.error) throw owners.error;
  if (staff.error) throw staff.error;
  return emailsOf(db, [...(owners.data ?? []), ...(staff.data ?? [])].map((r) => r.user_id as string));
}
