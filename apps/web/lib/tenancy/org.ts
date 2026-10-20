import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { BusinessType } from '@/presets';

export interface PublicOrganization {
  id: string;
  slug: string;
  name: string;
  businessType: BusinessType;
  branding: { logo_path?: string; primary?: string; accent?: string };
}

/**
 * A LIVE organization by slug, read through RLS as the current visitor (columns anon may read).
 * Onboarding or suspended venues return null for everyone — owners manage them on the root site.
 * Cached per request so the tenant layout and page share one query.
 */
export const getLiveOrganization = cache(async (slug: string): Promise<PublicOrganization | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('id, slug, name, business_type, branding')
    .eq('slug', slug)
    .eq('status', 'live')
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    businessType: data.business_type as BusinessType,
    branding: (data.branding ?? {}) as PublicOrganization['branding'],
  };
});
