"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { bookSpace, cancelSpaceBooking, setSpaceBookingStatus } from "@/lib/bookings/bookings";
import { parseWalkInForm } from "@/lib/forms/walk-in";
import { sectionIdOfSpaceBooking, sectionOfResource } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireOrgRole, requireSectionStaff } from "@/lib/tenancy/dal";
import { m } from "@/messages";

/** Staff book a space for a walk-in or phone customer (name + phone). No booking window or limit. */
export async function walkInAction(slug: string, resourceId: string, startsAt: string, _state: FormState, form: FormData): Promise<FormState> {
  await requireOrgRole(slug, "staff"); // signed in and on the team before any lookup
  const db = createServiceClient();
  const section = await sectionOfResource(db, resourceId);
  if (!section) return { ok: false, message: m.bookings.invalid.not_bookable };
  const { org, user } = await requireSectionStaff(slug, section.id);
  const parsed = parseWalkInForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const result = await bookSpace(db, {
    organizationId: org.id,
    resourceId,
    startsAt: new Date(startsAt),
    slots: parsed.value.slots,
    who: { guestName: parsed.value.guestName, guestPhone: parsed.value.guestPhone },
    createdBy: user.id,
    actor: "staff",
  });
  refresh();
  if (result.status === "booked") return { ok: true, message: m.staffBookings.booked };
  if (result.status === "invalid") return { ok: false, message: m.bookings.invalid[result.reason] };
  return { ok: false, message: m.bookings.taken };
}

export async function staffCancelBookingAction(slug: string, bookingId: string, _state: FormState, _form: FormData): Promise<FormState> {
  await requireOrgRole(slug, "staff");
  const db = createServiceClient();
  const sectionId = await sectionIdOfSpaceBooking(db, bookingId);
  if (!sectionId) return { ok: false, message: m.staffBookings.notFound };
  const { org, user } = await requireSectionStaff(slug, sectionId);
  const result = await cancelSpaceBooking(db, { organizationId: org.id, bookingId, actor: { kind: "staff" }, cancelledBy: user.id });
  refresh();
  if (result === "cancelled") return { ok: true, message: m.staffBookings.cancelled };
  if (result === "not_cancellable") return { ok: false, message: m.staffBookings.alreadyCancelled };
  if (result === "too_late") return { ok: false, message: m.staffBookings.ended };
  return { ok: false, message: m.staffBookings.notFound };
}

export async function setBookingStatusAction(
  slug: string,
  bookingId: string,
  status: "attended" | "no_show",
  _state: FormState,
  _form: FormData,
): Promise<FormState> {
  await requireOrgRole(slug, "staff");
  const db = createServiceClient();
  const sectionId = await sectionIdOfSpaceBooking(db, bookingId);
  if (!sectionId) return { ok: false, message: m.staffBookings.notFound };
  const { org } = await requireSectionStaff(slug, sectionId);
  const result = await setSpaceBookingStatus(db, { organizationId: org.id, bookingId, status });
  refresh();
  if (result === "updated") return { ok: true, message: m.staffBookings.marked };
  if (result === "not_started") return { ok: false, message: m.staffBookings.notStarted };
  if (result === "invalid") return { ok: false, message: m.staffBookings.cannotMark };
  return { ok: false, message: m.staffBookings.notFound };
}
