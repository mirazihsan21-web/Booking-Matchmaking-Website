"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { setSpaceBookingStatus } from "@/lib/bookings/bookings";
import { setSeatStatus } from "@/lib/open-play/open-play";
import type { PaymentKind } from "@/lib/payments/payments";
import { sectionIdOfSeat, sectionIdOfSpaceBooking } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
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
