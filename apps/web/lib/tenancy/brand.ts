import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';
import { loadSections, type Section } from '@/lib/sections/sections';

/**
 * The one brand this site runs (BRAND_SLUG): its name, address, look and sections. From R2 on, the
 * public site and the manage area read it instead of a slug in the URL.
 */
export interface Brand {
  id: string;
  slug: string;
  name: string;
  address: string;
  timezone: string;
  branding: { logo_path?: string; primary?: string; accent?: string };
  sections: Section[];
}

/** The brand, or null unless it exists and is live. */
export async function loadBrand(db: SupabaseClient, slug: string): Promise<Brand | null> {
  if (!slug) return null;
  const { data, error } = await db.from('organizations').select('id, slug, name, address, timezone, branding').eq('slug', slug).eq('status', 'live').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    address: data.address,
    timezone: data.timezone,
    branding: (data.branding ?? {}) as Brand['branding'],
    sections: await loadSections(db, data.id),
  };
}

/**
 * This site's brand, once per request. Server only: the service client is imported when it runs, so
 * tests can import loadBrand from here without the server-only guard.
 */
export const getBrand = cache(async (): Promise<Brand | null> => {
  const { createServiceClient } = await import('@/lib/service-client');
  return loadBrand(createServiceClient(), process.env.BRAND_SLUG ?? '');
});
