import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The user's membership of the brand this site runs (BRAND_SLUG) — their own team name — or null for anyone else. */
export async function brandTeamMember(db: SupabaseClient, userId: string): Promise<{ displayName: string } | null> {
  const slug = process.env.BRAND_SLUG ?? '';
  if (!slug) return null;
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).maybeSingle();
  if (!org) return null;
  const { data: member } = await db.from('organization_members').select('display_name').eq('organization_id', org.id).eq('user_id', userId).maybeSingle();
  return member ? { displayName: member.display_name as string } : null;
}

/** Whether the user is an owner or staff member of the brand this site runs (BRAND_SLUG). */
export async function isBrandTeamMember(db: SupabaseClient, userId: string): Promise<boolean> {
  return (await brandTeamMember(db, userId)) !== null;
}
