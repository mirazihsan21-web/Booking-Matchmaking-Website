"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { closeCard, decideRequest, leaveCard, removeFromCard, requestToJoin, withdrawRequest } from "@/lib/chat/cards";
import type { ChatRefusal } from "@/lib/forms/chat";
import { createServiceClient } from "@/lib/service-client";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

type Step = (db: ReturnType<typeof createServiceClient>, userId: string) => Promise<string>;

/** Runs one step on a card as the signed-in person, then re-reads the page. */
async function run(step: Step): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player) return { ok: false, message: m.chat.signInToSee };
  const result = await step(createServiceClient(), player.user.id);
  refresh();
  const done = m.chat.game.done[result];
  return done ? { ok: true, message: done } : { ok: false, message: m.chat.refusal[result as ChatRefusal] };
}

/** I'm in: ask the poster to join their game. */
export async function requestAction(cardId: string, _state: FormState, _form: FormData): Promise<FormState> {
  return run((db, userId) => requestToJoin(db, { cardId, userId }));
}

export async function withdrawAction(cardId: string, _state: FormState, _form: FormData): Promise<FormState> {
  return run((db, userId) => withdrawRequest(db, { cardId, userId }));
}

/** The poster says yes to a player: a spot is taken and they see each other's numbers. */
export async function acceptAction(cardId: string, profileId: string, _state: FormState, _form: FormData): Promise<FormState> {
  return run((db, userId) => decideRequest(db, { cardId, userId, profileId, accept: true }));
}

export async function declineAction(cardId: string, profileId: string, _state: FormState, _form: FormData): Promise<FormState> {
  return run((db, userId) => decideRequest(db, { cardId, userId, profileId, accept: false }));
}

/** An accepted player can't make it after all: the spot opens again. */
export async function leaveAction(cardId: string, _state: FormState, _form: FormData): Promise<FormState> {
  return run((db, userId) => leaveCard(db, { cardId, userId }));
}

/** The poster takes an accepted player off their game. */
export async function removePlayerAction(cardId: string, profileId: string, _state: FormState, _form: FormData): Promise<FormState> {
  return run((db, userId) => removeFromCard(db, { cardId, userId, profileId }));
}

/** The poster (or the venue's team) closes the card. */
export async function closeCardAction(cardId: string, _state: FormState, _form: FormData): Promise<FormState> {
  return run((db, userId) => closeCard(db, { cardId, userId }));
}
