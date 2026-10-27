"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { requestSeat, withdrawRequest } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

const OK = new Set(["requested", "seated", "waitlisted", "withdrawn"]);

/** A player with a profile asks for a seat in a game. */
export async function requestSeatAction(sessionId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player?.profileId) return { ok: false, message: m.openPlay.createProfile };
  const result = await requestSeat(createServiceClient(), { organizationId: player.brand.id, sessionId, profileId: player.profileId });
  refresh();
  return { ok: OK.has(result), message: m.openPlay.outcome[result] };
}

/** Takes back a request, or leaves the waitlist. */
export async function withdrawAction(sessionId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player?.profileId) return { ok: false, message: m.openPlay.createProfile };
  const result = await withdrawRequest(createServiceClient(), { organizationId: player.brand.id, sessionId, profileId: player.profileId });
  refresh();
  return { ok: OK.has(result), message: m.openPlay.outcome[result] };
}
