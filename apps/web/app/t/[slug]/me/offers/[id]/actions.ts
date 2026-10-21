"use server";

import type { FormState } from "@/components/forms/action-form";
import { findOffer, respondToOffer } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getPlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { offerReply } from "../../../offers/reply";

/** The signed-in player answers their own offer (from the bell or the session page). */
export async function respondMyOfferAction(slug: string, offerId: string, response: "accept" | "decline", _state: FormState, _form: FormData): Promise<FormState> {
  const player = await getPlayer(slug);
  if (!player?.profileId) return { ok: false, message: m.openPlay.offerGone };
  const db = createServiceClient();
  const offer = await findOffer(db, { offerId, profileId: player.profileId, organizationId: player.org.id });
  if (!offer) return { ok: false, message: m.openPlay.offerGone };
  return offerReply(await respondToOffer(db, { offerId: offer.id, response }));
}
