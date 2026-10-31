import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Whether the user is an owner or staff member of the brand this site runs (BRAND_SLUG). */
export async function isBrandTeamMember(db: SupabaseClient, userId: string): Promise<boolean> {
  const slug = process.env.BRAND_SLUG ?? '';
  if (!slug) return false;
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).maybeSingle();
  if (!org) return false;
  const { data: member } = await db.from('organization_members').select('user_id').eq('organization_id', org.id).eq('user_id', userId).maybeSingle();
  return Boolean(member);
}
