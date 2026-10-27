"use server";

import type { FormState } from "@/components/forms/action-form";
import { findOffer, respondToOffer } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { offerReply } from "../../../offers/reply";

/** The signed-in player answers their own offer (from the bell or the game page). */
export async function respondMyOfferAction(offerId: string, response: "accept" | "decline", _state: FormState, _form: FormData): Promise<FormState> {
  const player = await getSitePlayer();
  if (!player?.profileId) return { ok: false, message: m.openPlay.offerGone };
  const db = createServiceClient();
  const offer = await findOffer(db, { offerId, profileId: player.profileId, organizationId: player.brand.id });
  if (!offer) return { ok: false, message: m.openPlay.offerGone };
  return offerReply(await respondToOffer(db, { offerId: offer.id, response }));
}
