/**
 * Where a team account goes from a booking or game page on the site (team logins don't book): the space
 * on Today, or the game in Manage, when they run that section; otherwise Today.
 */
export type TeamDeskTarget = { kind: 'space'; sectionId: string; resourceId: string } | { kind: 'game'; sectionId: string; sessionId: string };

export interface TeamDeskLink {
  href: string;
  label: 'space' | 'game' | 'today';
}

export function teamDeskHref(target: TeamDeskTarget, teamSectionIds: string[]): TeamDeskLink {
  if (!teamSectionIds.includes(target.sectionId)) return { href: '/manage', label: 'today' };
  return target.kind === 'space'
    ? { href: `/manage?book=${encodeURIComponent(target.resourceId)}`, label: 'space' }
    : { href: `/manage/games/${encodeURIComponent(target.sessionId)}`, label: 'game' };
}
