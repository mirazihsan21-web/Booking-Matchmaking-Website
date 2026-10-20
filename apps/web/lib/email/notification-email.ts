import { renderNotification, type NotificationKind } from '@/lib/notifications/render';
import { PLATFORM_PALETTE } from '@/lib/theme';
import { m } from '@/messages';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const HEX = /^#[0-9A-Fa-f]{6}$/;

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
  const url = `${input.siteUrl}${input.link}`;
  const settingsUrl = `${input.siteUrl}/me`;
  const colour = HEX.test(input.primaryColour) ? input.primaryColour : PLATFORM_PALETTE.primary;
  const e = escapeHtml;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;font-size:14px;color:${colour};font-weight:bold">${e(input.venueName)}</p>
    <h1 style="margin:0 0 12px;font-size:20px">${e(title)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5">${e(body)}</p>
    <a href="${e(url)}" style="display:inline-block;background:${colour};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:15px">${e(m.email.open)}</a>
    <p style="margin:24px 0 0;font-size:12px;color:#666">${e(m.email.settings)} <a href="${e(settingsUrl)}" style="color:#666">${e(settingsUrl)}</a></p>
  </div>
</body></html>`;

  const text = [title, '', body, '', `${m.email.open}: ${url}`, '', `${m.email.settings} ${settingsUrl}`].join('\n');

  return { subject: `${input.venueName}: ${title}`, html, text };
}
