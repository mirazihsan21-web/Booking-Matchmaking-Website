import 'server-only';
import { cache } from 'react';
import { getUser, type SessionUser } from '@/lib/auth/dal';
import { createServiceClient } from '@/lib/service-client';
import { createClient } from '@/lib/supabase/server';
import { getBrand, type Brand } from './brand';
import { isBrandTeamMember } from './team';

/**
 * The signed-in visitor on the brand's site, with their player profile (null until they create one) and
 * whether they are on the brand's team (owner or staff: the site then links to the manage area).
 * Null when nobody is signed in or the brand isn't live. Cached per request.
 */
export const getSitePlayer = cache(async (): Promise<{ user: SessionUser; brand: Brand; profileId: string | null; isTeam: boolean } | null> => {
  const user = await getUser();
  if (!user) return null;
  const brand = await getBrand();
  if (!brand) return null;
  const supabase = await createClient();
  const [{ data }, isTeam] = await Promise.all([
    supabase.from('player_profiles').select('id').eq('organization_id', brand.id).eq('user_id', user.id).maybeSingle(),
    isBrandTeamMember(createServiceClient(), user.id),
  ]);
  return { user, brand, profileId: data?.id ?? null, isTeam };
});
