"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { cancelSeat, matchSession } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";

/** Staff match a session now instead of waiting for its cut-off; the same code the tick runs. */
export async function matchNowAction(slug: string, sessionId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "staff");
  const result = await matchSession(createServiceClient(), { organizationId: org.id, sessionId });
  refresh();
  return { ok: result === "matched", message: m.staffSession.outcome[result] };
}

/** Staff cancel a player's seat (any time before the start); the seat is offered to the next player. */
export async function staffCancelSeatAction(slug: string, bookingId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "staff");
  const result = await cancelSeat(createServiceClient(), { organizationId: org.id, bookingId, actor: { kind: "staff" } });
  refresh();
  return { ok: result === "cancelled", message: m.staffSession.outcome[result] };
}
