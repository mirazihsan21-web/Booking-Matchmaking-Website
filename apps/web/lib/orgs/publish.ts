import type { SupabaseClient } from '@supabase/supabase-js';

export type PublishResult =
  | { status: 'live' }
  | { status: 'not_ready'; missing: Array<'section' | 'resource' | 'activity'> }
  | { status: 'suspended' };

async function count(db: SupabaseClient, table: string, organizationId: string, activeOnly: boolean): Promise<number> {
  let query = db.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', organizationId);
  if (activeOnly) query = query.eq('active', true);
  const { count: n, error } = await query;
  if (error) throw error;
  return n ?? 0;
}

/**
 * Takes a venue from onboarding to live once it has somewhere to play and something to play.
 * A suspended venue can only be restored by a platform admin (setOrganizationStatus).
 */
export async function publishOrganization(db: SupabaseClient, organizationId: string): Promise<PublishResult> {
  const { data: org, error } = await db.from('organizations').select('status').eq('id', organizationId).single();
  if (error) throw error;
  if (org.status === 'suspended') return { status: 'suspended' };
  if (org.status === 'live') return { status: 'live' };

  const missing: Array<'section' | 'resource' | 'activity'> = [];
  if ((await count(db, 'sections', organizationId, false)) === 0) missing.push('section');
  if ((await count(db, 'resources', organizationId, true)) === 0) missing.push('resource');
  if ((await count(db, 'activities', organizationId, true)) === 0) missing.push('activity');
  if (missing.length) return { status: 'not_ready', missing };

  await setOrganizationStatus(db, organizationId, 'live');
  return { status: 'live' };
}

/** Platform-admin control (and the last step of publishing). */
export async function setOrganizationStatus(db: SupabaseClient, organizationId: string, status: 'live' | 'suspended'): Promise<void> {
  const { error } = await db.from('organizations').update({ status }).eq('id', organizationId);
  if (error) throw error;
}
