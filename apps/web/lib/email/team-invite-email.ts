import { brandEmail } from '@/lib/email/layout';
import { m } from '@/messages';

/**
 * The email to someone who already has an account when the owner invites them to the team (Supabase only emails
 * new addresses): who invited them, as what, and a button to the invite on the site, where they join or say no.
 */
export function teamInviteEmail(input: {
  venueName: string;
  primaryColour: string;
  role: 'owner' | 'staff';
  sectionNames: string[];
  joinUrl: string;
}): { subject: string; html: string; text: string } {
  const title = m.join.emailTitle;
  const { html, text } = brandEmail({
    venueName: input.venueName,
    primaryColour: input.primaryColour,
    title,
    body: `${m.join.invitation(input.venueName, input.role, input.sectionNames)} ${m.join.emailHow}`,
    button: { label: m.join.seeInvite, url: input.joinUrl },
  });
  return { subject: `${input.venueName}: ${title}`, html, text };
}
