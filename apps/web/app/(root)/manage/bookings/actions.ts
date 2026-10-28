"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { cancelSpaceBooking } from "@/lib/bookings/bookings";
import { sectionIdOfSpaceBooking } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

/** The desk cancels a space booking in a section it runs (a paid one's cash is voided with it). */
export async function cancelBookingAction(bookingId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const manager = await requireManager("staff");
  const db = createServiceClient();
  const sectionId = await sectionIdOfSpaceBooking(db, bookingId);
  if (!sectionId || !manager.sectionIds.includes(sectionId)) return { ok: false, message: m.staffBookings.notFound };
  const result = await cancelSpaceBooking(db, { organizationId: manager.org.id, bookingId, actor: { kind: "staff" }, cancelledBy: manager.user.id });
  refresh();
  if (result === "cancelled") return { ok: true, message: m.staffBookings.cancelled };
  if (result === "not_cancellable") return { ok: false, message: m.staffBookings.alreadyCancelled };
  if (result === "too_late") return { ok: false, message: m.staffBookings.ended };
  return { ok: false, message: m.staffBookings.notFound };
}
