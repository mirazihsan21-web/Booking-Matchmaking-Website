import { brandEmail } from '@/lib/email/layout';
import { m } from '@/messages';

/**
 * To the owners and the section's staff when a player says they've paid: who, which space and when, how much, by
 * bKash or Nagad, and the transaction ID to look for — with a button to Payments to check.
 */
export function paymentCheckEmail(input: {
  venueName: string;
  primaryColour: string;
  playerName: string;
  resourceName: string;
  /** "Fri 6 Nov, 8pm" in the venue's time zone. */
  when: string;
  /** "৳2,500". */
  amount: string;
  method: 'bkash' | 'nagad';
  trxId: string;
  link: string;
}): { subject: string; html: string; text: string } {
  const t = m.payments.teamEmail;
  const method = m.payments[input.method];
  const { html, text } = brandEmail({
    venueName: input.venueName,
    primaryColour: input.primaryColour,
    title: t.title,
    body: t.body(input.playerName, input.resourceName, input.when, input.amount, method, input.trxId),
    button: { label: t.button, url: input.link },
  });
  return { subject: t.subject(input.playerName, input.resourceName, input.when, input.amount, method, input.trxId), html, text };
}
