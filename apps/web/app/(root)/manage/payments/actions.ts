"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { decideClaim } from "@/lib/payments/claims";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

/**
 * Confirm a player's bKash/Nagad payment (booked, recorded) or reject it (cancelled, the player told, with the
 * optional reason). From Payments to check and from Today's panel. The database checks the person runs the
 * booking's section (owners run them all) and that nobody decided first.
 */
export async function decideClaimAction(bookingId: string, decision: "confirm" | "reject", _state: FormState, form: FormData): Promise<FormState> {
  const manager = await requireManager("staff");
  const reason = decision === "reject" ? String(form.get("reason") ?? "").trim() || null : null;
  const result = await decideClaim(createServiceClient(), { bookingId, userId: manager.user.id, decision, reason });
  refresh();
  const t = m.manage.payments;
  switch (result) {
    case "confirmed":
      return { ok: true, message: t.confirmed };
    case "rejected":
      return { ok: true, message: t.rejected };
    case "not_allowed":
      return { ok: false, message: t.notAllowed };
    case "nothing_sent":
      return { ok: false, message: t.nothingSent };
    case "invalid":
      return { ok: false, errors: { reason: t.invalid } };
    case "not_pending":
      return { ok: false, message: t.alreadyDecided };
  }
}
