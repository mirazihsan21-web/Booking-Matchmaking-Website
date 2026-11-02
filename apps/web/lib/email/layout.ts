import { PLATFORM_PALETTE } from '@/lib/theme';

export const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * The brand's email: venue name in its colour, a title, a line of text and one button, with an optional footer
 * line and link. Everything given is plain text; it is escaped here. Returns the HTML and plain-text parts.
 */
export function brandEmail(input: {
  venueName: string;
  primaryColour: string;
  title: string;
  body: string;
  button: { label: string; url: string };
  footer?: { text: string; url: string };
}): { html: string; text: string } {
  const colour = HEX.test(input.primaryColour) ? input.primaryColour : PLATFORM_PALETTE.primary;
  const e = escapeHtml;
  const footer = input.footer
    ? `\n    <p style="margin:24px 0 0;font-size:12px;color:#666">${e(input.footer.text)} <a href="${e(input.footer.url)}" style="color:#666">${e(input.footer.url)}</a></p>`
    : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;font-size:14px;color:${colour};font-weight:bold">${e(input.venueName)}</p>
    <h1 style="margin:0 0 12px;font-size:20px">${e(input.title)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5">${e(input.body)}</p>
    <a href="${e(input.button.url)}" style="display:inline-block;background:${colour};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:15px">${e(input.button.label)}</a>${footer}
  </div>
</body></html>`;

  const text = [
    input.title,
    '',
    input.body,
    '',
    `${input.button.label}: ${input.button.url}`,
    ...(input.footer ? ['', `${input.footer.text} ${input.footer.url}`] : []),
  ].join('\n');

  return { html, text };
}
