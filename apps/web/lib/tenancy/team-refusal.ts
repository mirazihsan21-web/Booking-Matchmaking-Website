import type { FormState } from '@/components/forms/action-form';
import { m } from '@/messages';

/**
 * Team logins are venue-only: a player action (book, take a seat, answer an offer, save a player profile)
 * from an owner or staff member is refused before anything is written. Null for everyone else.
 */
export function teamRefusal(player: { isTeam: boolean } | null): FormState | null {
  return player?.isTeam ? { ok: false, message: m.team.refused } : null;
}
