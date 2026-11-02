"use server";

import { refresh } from "next/cache";
import type { SendResult } from "@/components/chat/composer";
import type { FormState } from "@/components/forms/action-form";
import { postPrivateMessage } from "@/lib/chat/messages";
import { blockPlayer, playerCard, unblockPlayer } from "@/lib/chat/private";
import { parseChatMessageForm } from "@/lib/forms/chat";
import { text } from "@/lib/forms/result";
import { createServiceClient } from "@/lib/service-client";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sends a private message (words and/or a photo) to `toProfileId`; returns the conversation, which the first message creates. */
export async function sendPrivateAction(_state: SendResult, formData: FormData): Promise<SendResult> {
  const player = await getSitePlayer();
  if (!player) return { ok: false, message: m.chat.signInToSee };
  if (player.isTeam) return { ok: false, message: m.chat.private.teamNote };
  const toProfileId = text(formData, "toProfileId");
  if (!UUID.test(toProfileId)) return { ok: false, message: m.chat.refusal.not_found };
  const parsed = parseChatMessageForm(formData);
  if (!parsed.ok) return { ok: false, message: parsed.errors.body, errors: parsed.errors };
  const result = await postPrivateMessage(createServiceClient(), {
    organizationId: player.brand.id,
    userId: player.user.id,
    toProfileId,
    body: parsed.value.body,
    photoPath: parsed.value.photoPath,
  });
  return result.status === "posted" ? { ok: true, conversationId: result.conversationId } : { ok: false, message: m.chat.refusal[result.status] };
}

/** The panel behind a player's name: their name, the sections they play, and whether you've blocked them. */
export async function playerCardAction(profileId: string): Promise<{ name: string; sections: string[]; blockedByMe: boolean } | null> {
  const player = await getSitePlayer();
  if (!player || !UUID.test(profileId)) return null;
  return playerCard(createServiceClient(), { organizationId: player.brand.id, profileId, viewerProfileId: player.profileId });
}

async function setBlock(profileId: string, block: boolean): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player) return { ok: false, message: m.chat.signInToSee };
  if (!UUID.test(profileId)) return { ok: false, message: m.chat.refusal.not_found };
  const db = createServiceClient();
  const input = { organizationId: player.brand.id, userId: player.user.id, profileId };
  const result = block ? await blockPlayer(db, input) : await unblockPlayer(db, input);
  refresh(); // the room folds (or unfolds) their messages; the conversation page changes
  return result === "blocked" || result === "unblocked" ? { ok: true } : { ok: false, message: m.chat.refusal[result] };
}

export async function blockAction(profileId: string): Promise<FormState> {
  return setBlock(profileId, true);
}

export async function unblockAction(profileId: string): Promise<FormState> {
  return setBlock(profileId, false);
}
