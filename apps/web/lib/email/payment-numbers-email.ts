import { brandEmail } from '@/lib/email/layout';
import type { PaymentNumbers } from '@/lib/payments/numbers';
import { m } from '@/messages';

/**
 * To every owner when the bKash or Nagad number for online bookings changes (players send money to it, so a change
 * nobody expected matters): each number that changed, from what to what, and who changed it.
 */
export function paymentNumbersEmail(input: {
  venueName: string;
  primaryColour: string;
  changedBy: string;
  before: PaymentNumbers;
  after: PaymentNumbers;
  link: string;
}): { subject: string; html: string; text: string } {
  const t = m.payments.numbersEmail;
  const shown = (value: string | null) => value ?? t.notSet;
  const lines = (['bkash', 'nagad'] as const)
    .filter((method) => input.before[method] !== input.after[method])
    .map((method) => `${m.payments[method]}: ${shown(input.before[method])} → ${shown(input.after[method])}`);
  const { html, text } = brandEmail({
    venueName: input.venueName,
    primaryColour: input.primaryColour,
    title: t.title,
    body: `${lines.join('. ')}. ${t.changedBy(input.changedBy)}`,
    button: { label: t.button, url: input.link },
  });
  return { subject: t.subject(input.venueName), html, text };
}
