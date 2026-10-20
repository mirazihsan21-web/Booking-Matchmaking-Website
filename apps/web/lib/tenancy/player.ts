import 'server-only';
import { cache } from 'react';
import { getUser, type SessionUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { getLiveOrganization, type PublicOrganization } from './org';

/**
 * The signed-in visitor at a live venue, with their player profile there (null until they create
 * one). Null when nobody is signed in or the venue isn't live. Cached per request, so the header,
 * page and actions share one lookup.
 */
export const getPlayer = cache(
  async (slug: string): Promise<{ user: SessionUser; org: PublicOrganization; profileId: string | null } | null> => {
    const user = await getUser();
    if (!user) return null;
    const org = await getLiveOrganization(slug);
    if (!org) return null;
    const supabase = await createClient();
    const { data } = await supabase.from('player_profiles').select('id').eq('organization_id', org.id).eq('user_id', user.id).maybeSingle();
    return { user, org, profileId: data?.id ?? null };
  },
);
