"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { cancelSeat, matchSession } from "@/lib/open-play/open-play";
import { sectionIdOfSeat, sectionOfSession } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

/** Staff match a session now instead of waiting for its cut-off; the same code the tick runs. */
export async function matchNowAction(sessionId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const manager = await requireManager("staff"); // signed in and on the team before any lookup
  const db = createServiceClient();
  const section = await sectionOfSession(db, sessionId);
  if (!section || !manager.sectionIds.includes(section.id)) return { ok: false, message: m.staffSession.outcome.not_found };
  const result = await matchSession(db, { organizationId: manager.org.id, sessionId });
  refresh();
  return { ok: result === "matched", message: m.staffSession.outcome[result] };
}

/** Staff cancel a player's seat (any time before the start); the seat is offered to the next player. */
export async function staffCancelSeatAction(bookingId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const manager = await requireManager("staff");
  const db = createServiceClient();
  const sectionId = await sectionIdOfSeat(db, bookingId);
  if (!sectionId || !manager.sectionIds.includes(sectionId)) return { ok: false, message: m.staffSession.outcome.not_found };
  const result = await cancelSeat(db, { organizationId: manager.org.id, bookingId, actor: { kind: "staff" } });
  refresh();
  return { ok: result === "cancelled", message: m.staffSession.outcome[result] };
}
