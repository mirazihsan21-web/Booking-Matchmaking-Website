"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { bookSpace, setSpaceBookingStatus } from "@/lib/bookings/bookings";
import { parseWalkInForm } from "@/lib/forms/walk-in";
import { bdtToPoisha } from "@/lib/money";
import { setSeatStatus } from "@/lib/open-play/open-play";
import { recordPayment, voidPayment, type PaymentKind } from "@/lib/payments/payments";
import { sectionIdOfSeat, sectionIdOfSpaceBooking, sectionOfResource } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

/** Arrived, No-show, or back to booked, for a space booking or a seat — only in a section the person runs. */
export async function setDeskStatusAction(
  kind: PaymentKind,
  bookingId: string,
  status: "attended" | "no_show" | "confirmed",
  _state: FormState,
  _form: FormData,
): Promise<FormState> {
  const manager = await requireManager("staff");
  const db = createServiceClient();
  const sectionId = kind === "space" ? await sectionIdOfSpaceBooking(db, bookingId) : await sectionIdOfSeat(db, bookingId);
  if (!sectionId || !manager.sectionIds.includes(sectionId)) return { ok: false, message: m.manage.desk.notFound };
  const input = { organizationId: manager.org.id, bookingId, status };
  const result = kind === "space" ? await setSpaceBookingStatus(db, input) : await setSeatStatus(db, input);
  refresh();
  if (result === "updated") return { ok: true, message: m.manage.desk.marked };
  if (result === "not_started") return { ok: false, message: m.manage.desk.tooEarly };
  if (result === "invalid") return { ok: false, message: m.manage.desk.cannotMark };
  return { ok: false, message: m.manage.desk.notFound };
}

/**
 * Book for a customer at the desk: a space in a section this person runs, a free start, 1–4 slots, a name
 * and a phone. The walk-in path (opening hours, slot grid and clashes checked; no booking window or limit).
 */
export async function deskBookAction(_state: FormState, form: FormData): Promise<FormState> {
  const manager = await requireManager("staff");
  const db = createServiceClient();
  const resourceId = String(form.get("resourceId") ?? "");
  const section = await sectionOfResource(db, resourceId);
  if (!section || !manager.sectionIds.includes(section.id)) return { ok: false, message: m.bookings.invalid.not_bookable };
  const startsAt = new Date(String(form.get("startsAt") ?? ""));
  if (Number.isNaN(startsAt.getTime())) return { ok: false, errors: { startsAt: m.bookings.pickSlot } };
  const parsed = parseWalkInForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const result = await bookSpace(db, {
    organizationId: manager.org.id,
    resourceId,
    startsAt,
    slots: parsed.value.slots,
    who: { guestName: parsed.value.guestName, guestPhone: parsed.value.guestPhone },
    createdBy: manager.user.id,
    actor: "staff",
  });
  refresh();
  if (result.status === "booked") return { ok: true, message: m.staffBookings.booked };
  if (result.status === "invalid") return { ok: false, message: m.bookings.invalid[result.reason] };
  return { ok: false, message: m.bookings.taken };
}

/** Cash taken at the desk for a booking or seat. Uses the person's own client: the database decides who may. */
export async function recordPaymentAction(kind: PaymentKind, bookingId: string, _state: FormState, form: FormData): Promise<FormState> {
  await requireManager("staff");
  const amountPoisha = bdtToPoisha(String(form.get("amount") ?? ""));
  if (amountPoisha === null) return { ok: false, errors: { amount: m.manage.desk.invalidAmount } };
  const result = await recordPayment(await createClient(), { kind, bookingId, amountPoisha });
  refresh();
  if (result === "recorded") return { ok: true, message: m.manage.desk.recorded };
  if (result === "already_paid") return { ok: false, message: m.manage.desk.alreadyPaid };
  if (result === "not_payable") return { ok: false, message: m.manage.desk.notPayable };
  if (result === "invalid_amount") return { ok: false, errors: { amount: m.manage.desk.invalidAmount } };
  return { ok: false, message: m.manage.desk.notFound };
}

/** Undo a payment (it is voided, not deleted). Uses the person's own client. */
export async function voidPaymentAction(paymentId: string, _state: FormState, _form: FormData): Promise<FormState> {
  await requireManager("staff");
  const result = await voidPayment(await createClient(), { paymentId });
  refresh();
  if (result === "voided") return { ok: true, message: m.manage.desk.voided };
  if (result === "already_voided") return { ok: false, message: m.manage.desk.alreadyVoided };
  return { ok: false, message: m.manage.desk.notFound };
}
