"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/forms/action-form";
import { cancelSpaceBooking } from "@/lib/bookings/bookings";
import { currentBusinessDate } from "@/lib/bookings/slots";
import { paymentCheckEmail } from "@/lib/email/payment-check-email";
import { createEmailSender } from "@/lib/email/sender";
import { formatNight } from "@/lib/format";
import { parsePaymentClaimForm, type PaymentMethod } from "@/lib/forms/payment-claim";
import { formatBdt } from "@/lib/money";
import { payBooking, submitClaim } from "@/lib/payments/claims";
import { paymentNumbers } from "@/lib/payments/numbers";
import { teamForSection } from "@/lib/payments/team-emails";
import { createServiceClient } from "@/lib/service-client";
import { bookPath } from "@/lib/site/paths";
import { getSitePlayer, type SitePlayer } from "@/lib/tenancy/player";
import { rootUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";

/** "Payment to check" to the owners and the section's staff. Best effort: the Manage list is what counts. */
async function tellTeam(player: SitePlayer, bookingId: string, method: PaymentMethod, trxId: string): Promise<void> {
  const db = createServiceClient();
  const view = await payBooking(db, { bookingId, profileId: player.profileId! });
  if (!view) return;
  const [{ data: profile }, emails] = await Promise.all([
    db.from("player_profiles").select("display_name").eq("id", player.profileId!).maybeSingle(),
    teamForSection(db, { organizationId: player.brand.id, sectionId: view.sectionId }),
  ]);
  const email = paymentCheckEmail({
    venueName: player.brand.name,
    primaryColour: player.brand.branding.primary ?? "",
    playerName: (profile?.display_name as string | undefined) ?? "",
    resourceName: view.resourceName,
    when: formatNight(view.start.toISOString(), player.brand.timezone),
    amount: formatBdt(view.amountPoisha),
    method,
    trxId,
    link: rootUrl("/manage/payments"),
  });
  const sender = createEmailSender(process.env);
  await Promise.all(emails.map((to) => sender.send({ to, ...email })));
}

/** The player sends what they paid with; the team is told. */
export async function submitClaimAction(bookingId: string, _state: FormState, form: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player?.profileId) return { ok: false, message: m.bookings.unavailable };
  const parsed = parsePaymentClaimForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const result = await submitClaim(createServiceClient(), { bookingId, userId: player.user.id, ...parsed.value });
  switch (result) {
    case "submitted":
      await tellTeam(player, bookingId, parsed.value.method, parsed.value.trxId).catch((error) => console.error("payment-check email", error));
      refresh();
      return { ok: true, message: m.payments.sentWaiting };
    case "trx_used":
      return { ok: false, errors: { trxId: m.payments.trxUsed } };
    case "method_closed":
      return { ok: false, errors: { method: m.payments.methodClosed } };
    case "hold_over": {
      // Too late — and they may already have sent the money: say how to reach the venue.
      const numbers = await paymentNumbers(createServiceClient(), player.brand.id);
      const contact = numbers.bkash ?? numbers.nagad;
      // No refresh: the form (and this message) stays put; reloading shows the ended page with the same line.
      return { ok: false, message: `${m.payments.holdOver} ${contact ? m.notifications.contactUsOn(contact) : m.notifications.contactTheVenue}` };
    }
    case "not_pending":
      refresh();
      return { ok: false, message: m.payments.alreadySent };
    case "invalid":
      return { ok: false, message: m.payments.errors.trxId };
    case "not_yours":
      return { ok: false, message: m.bookings.unavailable };
  }
}

/** Cancel this request (only while it's held — before sending money); back to the space's day, now free. */
export async function cancelHoldAction(bookingId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player?.profileId) return { ok: false, message: m.bookings.unavailable };
  const db = createServiceClient();
  const view = await payBooking(db, { bookingId, profileId: player.profileId });
  if (!view) return { ok: false, message: m.bookings.unavailable };
  const result = await cancelSpaceBooking(db, {
    organizationId: player.brand.id,
    bookingId,
    actor: { kind: "player", profileId: player.profileId },
    cancelledBy: player.user.id,
  });
  if (result !== "cancelled") return { ok: false, message: result === "paid" ? m.bookings.paidContact : m.bookings.alreadyCancelled };
  const section = player.brand.sections.find((s) => s.id === view.sectionId);
  if (!section) redirect("/me/bookings");
  redirect(bookPath(section.slug, { resource: view.resourceId, date: currentBusinessDate(section.openingHours, view.start, player.brand.timezone) }));
}
