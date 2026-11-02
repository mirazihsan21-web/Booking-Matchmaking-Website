import { describe, expect, it } from 'vitest';
import { teamInviteEmail } from '../lib/email/team-invite-email';

const base = {
  venueName: 'Chattoturf',
  primaryColour: '#43a66b',
  role: 'staff' as const,
  sectionNames: ['Turf', 'Board-game café'],
  joinUrl: 'http://localhost:3000/join',
};

describe('teamInviteEmail', () => {
  it('names the venue and the invite in the subject', () => {
    expect(teamInviteEmail(base).subject).toBe("Chattoturf: You've been invited to the team");
  });

  it('says the role, and for staff the sections they would run', () => {
    expect(teamInviteEmail(base).text).toContain('Chattoturf invited you to join its team as staff, running Turf and Board-game café.');
    expect(teamInviteEmail({ ...base, role: 'owner', sectionNames: [] }).text).toContain('Chattoturf invited you to join its team as an owner.');
  });

  it('links to the invite on the site', () => {
    const { html, text } = teamInviteEmail(base);
    expect(html).toContain('href="http://localhost:3000/join"');
    expect(text).toContain('See the invite: http://localhost:3000/join');
  });

  it('escapes venue data in the HTML', () => {
    const { html } = teamInviteEmail({ ...base, venueName: '<b>X</b>', sectionNames: ['<i>Y</i>'] });
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).not.toContain('<b>X</b>');
    expect(html).not.toContain('<i>Y</i>');
  });

  it('keeps the plain-text part free of HTML', () => {
    expect(teamInviteEmail(base).text).not.toMatch(/<[a-z]/i);
  });
});
