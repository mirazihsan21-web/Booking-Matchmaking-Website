import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getUser, requireUser, type SessionUser } from '@/lib/auth/dal';
import { createServiceClient } from '@/lib/service-client';
import { createClient } from '@/lib/supabase/server';
import { getBrand, type Brand } from './brand';
import { allowedSectionIds } from './sections-access';
import { isBrandTeamMember } from './team';

/**
 * The signed-in visitor on the brand's site: their player profile (null until they create one), whether they
 * are on the brand's team (owner or staff: team logins are venue-only, so the site shows them Manage), and
 * for the team the sections they run ([] for players).
 */
export interface SitePlayer {
  user: SessionUser;
  brand: Brand;
  profileId: string | null;
  isTeam: boolean;
  teamSectionIds: string[];
}

/** The site player for this request, or null when nobody is signed in or the brand isn't live. Cached per request. */
export const getSitePlayer = cache(async (): Promise<SitePlayer | null> => {
  const user = await getUser();
  if (!user) return null;
  const brand = await getBrand();
  if (!brand) return null;
  const supabase = await createClient();
  const service = createServiceClient();
  const [{ data }, isTeam] = await Promise.all([
    supabase.from('player_profiles').select('id').eq('organization_id', brand.id).eq('user_id', user.id).maybeSingle(),
    isBrandTeamMember(service, user.id),
  ]);
  const teamSectionIds = isTeam ? await allowedSectionIds(service, { organizationId: brand.id, userId: user.id }) : [];
  return { user, brand, profileId: data?.id ?? null, isTeam, teamSectionIds };
});

/**
 * For the player's own pages: signed out → sign in and come back to `next`; a team account → My account in
 * Manage (team logins are venue-only). Null when the brand isn't live (the layout shows "Not open yet").
 */
export async function requirePlayer(next: string): Promise<SitePlayer | null> {
  await requireUser(next);
  const player = await getSitePlayer();
  if (player?.isTeam) redirect('/manage/account');
  return player;
}
