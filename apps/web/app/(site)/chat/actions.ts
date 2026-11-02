"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { postBookingCard, postSessionCard } from "@/lib/chat/cards";
import { parseCardForm, parseChatMessageForm } from "@/lib/forms/chat";
import { postMessage, removeMessage } from "@/lib/chat/messages";
import { createServiceClient } from "@/lib/service-client";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

// The room updates live (Realtime), so sending and removing don't refresh the page.

/** Sends a message to the room as the signed-in player (or, for the team, as the brand). */
export async function sendMessageAction(_state: FormState, formData: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player) return { ok: false, message: m.chat.signInToSee };
  const parsed = parseChatMessageForm(formData);
  if (!parsed.ok) return { ok: false, message: parsed.errors.body, errors: parsed.errors };
  const result = await postMessage(createServiceClient(), { organizationId: player.brand.id, userId: player.user.id, body: parsed.value.body });
  return result.status === "posted" ? { ok: true } : { ok: false, message: m.chat.refusal[result.status] };
}

/** Removes one of your own messages. */
export async function removeMyMessageAction(messageId: string): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player) return { ok: false, message: m.chat.signInToSee };
  const result = await removeMessage(createServiceClient(), { messageId, userId: player.user.id, byVenue: false });
  return result === "removed" ? { ok: true } : { ok: false, message: m.chat.refusal[result] };
}

/** Posts a "Need players" card for one of your bookings, or a card for an open-play game you're going to. */
export async function postCardAction(_state: FormState, formData: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player) return { ok: false, message: m.chat.signInToSee };
  const parsed = parseCardForm(formData);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: Object.values(parsed.errors)[0] };
  const db = createServiceClient();
  const { target, spots, note } = parsed.value;
  const base = { organizationId: player.brand.id, userId: player.user.id, note };
  const result =
    target.kind === "booking"
      ? await postBookingCard(db, { ...base, bookingId: target.bookingId, spots: spots! })
      : await postSessionCard(db, { ...base, sessionId: target.sessionId });
  if (result.status !== "posted") return { ok: false, message: m.chat.refusal[result.status] };
  refresh(); // the lists of what you can post change
  return { ok: true, message: m.chat.form.posted };
}
