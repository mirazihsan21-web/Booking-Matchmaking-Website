import { brandEmail } from '@/lib/email/layout';
import { renderNotification, type NotificationKind } from '@/lib/notifications/render';
import { m } from '@/messages';

/** The email for one notification: the same words as the in-app inbox, plus a button to the venue site. */
export function notificationEmail(input: {
  kind: NotificationKind;
  payload: Record<string, unknown>;
  venueName: string;
  primaryColour: string;
  siteUrl: string;
  link: string;
  timeZone: string;
}): { subject: string; html: string; text: string } {
  const { title, body } = renderNotification({ kind: input.kind, payload: input.payload }, input.timeZone);
  const { html, text } = brandEmail({
    venueName: input.venueName,
    primaryColour: input.primaryColour,
    title,
    body,
    button: { label: m.email.open, url: `${input.siteUrl}${input.link}` },
    // The email setting is on the profile's edit page (/me only shows the profile).
    footer: { text: m.email.settings, url: `${input.siteUrl}/me/edit` },
  });
  return { subject: `${input.venueName}: ${title}`, html, text };
}
