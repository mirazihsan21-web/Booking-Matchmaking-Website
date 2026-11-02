"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { closeCard, postBookingCard, postSessionCard } from "@/lib/chat/cards";
import { mutePlayer, reportMessage } from "@/lib/chat/moderation";
import { parseCardForm, parseChatMessageForm, parseMuteForm, parseReportForm } from "@/lib/forms/chat";
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

/** A player reports a message (or a card) for the team to look at. */
export async function reportAction(_state: FormState, formData: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player) return { ok: false, message: m.chat.signInToSee };
  const parsed = parseReportForm(formData);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: Object.values(parsed.errors)[0] };
  const result = await reportMessage(createServiceClient(), { ...parsed.value, userId: player.user.id });
  return result === "reported" ? { ok: true, message: m.chat.reportThanks } : { ok: false, message: m.chat.refusal[result] };
}

/** The team removes any message from the room (the database checks they are on the team). */
export async function removeAsVenueAction(messageId: string): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player?.isTeam) return { ok: false, message: m.chat.refusal.not_allowed };
  const result = await removeMessage(createServiceClient(), { messageId, userId: player.user.id, byVenue: true });
  return result === "removed" ? { ok: true } : { ok: false, message: m.chat.refusal[result] };
}

/** The team mutes a player for 1 day, 7 days or until unmuted (`length`: "1", "7" or "forever"). */
export async function muteAction(profileId: string, length: string): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player?.isTeam) return { ok: false, message: m.chat.refusal.not_allowed };
  const form = new FormData();
  form.set("profileId", profileId);
  form.set("length", length);
  const parsed = parseMuteForm(form);
  if (!parsed.ok) return { ok: false, message: m.chat.refusal.invalid };
  const result = await mutePlayer(createServiceClient(), { organizationId: player.brand.id, userId: player.user.id, ...parsed.value });
  return result === "muted" ? { ok: true } : { ok: false, message: m.chat.refusal[result] };
}

/** Closes one of your own cards (a booking card or an open-play game you shared) from the room. */
export async function closeMyCardAction(cardId: string): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player) return { ok: false, message: m.chat.signInToSee };
  const result = await closeCard(createServiceClient(), { cardId, userId: player.user.id });
  return result === "closed" ? { ok: true } : { ok: false, message: m.chat.refusal[result] };
}
