import 'server-only';
import { cache } from 'react';
import { openInviteFor } from '@/lib/orgs/invites';
import { createServiceClient } from '@/lib/service-client';
import { getSitePlayer } from './player';

/** An invite to the brand's team waiting for the signed-in person: as what, and (staff) the sections' names. */
export interface MyTeamInvite {
  role: 'owner' | 'staff';
  sectionNames: string[];
}

/**
 * The open invite to the brand's team for the signed-in person's email, or null (signed out, already on the
 * team, or none waiting). Invites are owner-only under RLS, so this reads with the service client, matched on
 * the session's own email. Cached per request.
 */
export const getMyTeamInvite = cache(async (): Promise<MyTeamInvite | null> => {
  const player = await getSitePlayer();
  if (!player || player.isTeam || !player.user.email) return null;
  const invite = await openInviteFor(createServiceClient(), player.brand.id, player.user.email);
  if (!invite) return null;
  return {
    role: invite.role,
    sectionNames: player.brand.sections.filter((s) => invite.sectionIds.includes(s.id)).map((s) => s.name),
  };
});
