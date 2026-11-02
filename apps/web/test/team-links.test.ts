import { describe, expect, it } from 'vitest';
import { teamDeskHref } from '../lib/manage/team-links';
import { teamRefusal } from '../lib/tenancy/team-refusal';

const TURF = '00000000-0000-4000-8000-0000000000e1';
const CAFE = '00000000-0000-4000-8000-0000000000e2';

describe('teamDeskHref (where a team account is sent from a booking or game page)', () => {
  it('opens the space on Today when they run its section', () => {
    expect(teamDeskHref({ kind: 'space', sectionId: TURF, resourceId: 'r1' }, [TURF, CAFE])).toEqual({ href: '/manage?book=r1', label: 'space' });
  });

  it('opens the game in Manage when they run its section', () => {
    expect(teamDeskHref({ kind: 'game', sectionId: CAFE, sessionId: 's1' }, [CAFE])).toEqual({ href: '/manage/games/s1', label: 'game' });
  });

  it('goes to Today for a section they don’t run', () => {
    expect(teamDeskHref({ kind: 'space', sectionId: CAFE, resourceId: 'r1' }, [TURF])).toEqual({ href: '/manage', label: 'today' });
    expect(teamDeskHref({ kind: 'game', sectionId: CAFE, sessionId: 's1' }, [TURF])).toEqual({ href: '/manage', label: 'today' });
  });

  it('goes to Today for staff with no sections yet (Review Focus 2)', () => {
    expect(teamDeskHref({ kind: 'space', sectionId: TURF, resourceId: 'r1' }, [])).toEqual({ href: '/manage', label: 'today' });
  });
});

describe('teamRefusal (team logins are venue-only)', () => {
  it('turns a team account away before anything is written', () => {
    expect(teamRefusal({ isTeam: true })).toEqual({
      ok: false,
      message: "Team accounts can't book, take seats or keep a player profile here. Use Manage.",
    });
  });

  it('lets players and signed-out visitors through to the normal checks', () => {
    expect(teamRefusal({ isTeam: false })).toBeNull();
    expect(teamRefusal(null)).toBeNull();
  });
});
