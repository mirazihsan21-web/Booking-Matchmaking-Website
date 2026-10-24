import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessType } from '@/presets';

export interface AdminOrganization {
  id: string;
  slug: string;
  name: string;
  businessType: BusinessType;
  status: 'onboarding' | 'live' | 'suspended';
  createdAt: string;
  ownerEmail: string | null;
}

/** Platform admins are agency operators listed in platform_admins (granted with `pnpm admin:grant`). */
export async function isPlatformAdmin(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Every organization, newest first, with its first owner's email (service client only). */
export async function listOrganizations(db: SupabaseClient, limit = 200): Promise<AdminOrganization[]> {
  const { data, error } = await db
    .from('organizations')
    .select('id, slug, name, business_type, status, created_at, organization_members(user_id, role, created_at)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return Promise.all(
    data.map(async (org) => {
      const owners = (org.organization_members as Array<{ user_id: string; role: string; created_at: string }>)
        .filter((m) => m.role === 'owner')
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      let ownerEmail: string | null = null;
      if (owners[0]) {
        const { data: found } = await db.auth.admin.getUserById(owners[0].user_id);
        ownerEmail = found.user?.email ?? null;
      }
      return {
        id: org.id,
        slug: org.slug,
        name: org.name,
        businessType: (org.business_type ?? 'turf') as BusinessType,
        status: org.status,
        createdAt: org.created_at,
        ownerEmail,
      };
    }),
  );
}
