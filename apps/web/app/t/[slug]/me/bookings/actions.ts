"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { cancelSpaceBooking } from "@/lib/bookings/bookings";
import { cancelSeat } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getPlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

/** A player cancels their own booking, until the venue's cut-off. */
export async function cancelMyBookingAction(slug: string, bookingId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const player = await getPlayer(slug);
  if (!player?.profileId) return { ok: false, message: m.bookings.unavailable };
  const result = await cancelSpaceBooking(createServiceClient(), {
    organizationId: player.org.id,
    bookingId,
    actor: { kind: "player", profileId: player.profileId },
    cancelledBy: player.user.id,
  });
  refresh();
  if (result === "cancelled") return { ok: true, message: m.bookings.cancelled };
  if (result === "too_late") return { ok: false, message: m.bookings.tooLate };
  if (result === "not_cancellable") return { ok: false, message: m.bookings.alreadyCancelled };
  return { ok: false, message: m.bookings.unavailable };
}

/** A player cancels their own open-play seat, until the venue's cut-off; the seat is offered on. */
export async function cancelSeatAction(slug: string, bookingId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const player = await getPlayer(slug);
  if (!player?.profileId) return { ok: false, message: m.bookings.unavailable };
  const result = await cancelSeat(createServiceClient(), {
    organizationId: player.org.id,
    bookingId,
    actor: { kind: "player", profileId: player.profileId },
  });
  refresh();
  return { ok: result === "cancelled", message: m.openPlay.outcome[result] ?? m.openPlay.closed };
}
