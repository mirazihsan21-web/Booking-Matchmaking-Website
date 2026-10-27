"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { bookSpace } from "@/lib/bookings/bookings";
import { sectionOfResource } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

/** A signed-in player books 1–4 slots of a space. */
export async function bookSpaceAction(resourceId: string, _state: FormState, form: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player) return { ok: false, message: m.bookings.unavailable };
  if (!player.profileId) return { ok: false, message: m.bookings.createProfileFirst };

  const startsAt = new Date(String(form.get("startsAt") ?? ""));
  if (Number.isNaN(startsAt.getTime())) return { ok: false, errors: { startsAt: m.bookings.pickSlot } };
  const slots = Number(form.get("slots") ?? 1);

  const db = createServiceClient();
  const result = await bookSpace(db, {
    organizationId: player.brand.id,
    resourceId,
    startsAt,
    slots,
    who: { profileId: player.profileId },
    createdBy: player.user.id,
    actor: "player",
  });
  refresh();
  switch (result.status) {
    case "booked":
      return { ok: true, message: m.bookings.booked };
    case "taken":
      return { ok: false, message: m.bookings.taken };
    case "already_yours":
      return { ok: false, message: m.bookings.alreadyYours };
    case "limit_reached": {
      const section = await sectionOfResource(db, resourceId);
      return { ok: false, message: m.bookings.limitReached(section?.rules.maxUpcomingBookings ?? 0) };
    }
    case "invalid":
      return { ok: false, message: m.bookings.invalid[result.reason] };
  }
}
