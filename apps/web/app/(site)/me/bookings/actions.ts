"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { cancelSpaceBooking } from "@/lib/bookings/bookings";
import { cancelSeat } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

/** A player cancels their own booking, until its section's cut-off. */
export async function cancelMyBookingAction(bookingId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player?.profileId) return { ok: false, message: m.bookings.unavailable };
  const result = await cancelSpaceBooking(createServiceClient(), {
    organizationId: player.brand.id,
    bookingId,
    actor: { kind: "player", profileId: player.profileId },
    cancelledBy: player.user.id,
  });
  refresh();
  if (result === "cancelled") return { ok: true, message: m.bookings.cancelled };
  if (result === "too_late") return { ok: false, message: m.bookings.tooLate };
  if (result === "paid") return { ok: false, message: m.bookings.paidContact };
  if (result === "not_cancellable") return { ok: false, message: m.bookings.alreadyCancelled };
  return { ok: false, message: m.bookings.unavailable };
}

/** A player cancels their own seat in a game, until its section's cut-off; the seat is offered on. */
export async function cancelSeatAction(bookingId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player?.profileId) return { ok: false, message: m.bookings.unavailable };
  const result = await cancelSeat(createServiceClient(), {
    organizationId: player.brand.id,
    bookingId,
    actor: { kind: "player", profileId: player.profileId },
  });
  refresh();
  if (result === "paid") return { ok: false, message: m.bookings.paidContact };
  return { ok: result === "cancelled", message: m.openPlay.outcome[result] ?? m.openPlay.closed };
}
