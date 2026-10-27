"use server";

import type { FormState } from "@/components/forms/action-form";
import { findOffer, respondToOffer } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getBrand } from "@/lib/tenancy/brand";
import { m } from "@/messages";
import { offerReply } from "../reply";

/**
 * Answers an offer from its email link, without signing in: whoever holds the link can press the
 * button, and the seat always goes to the player it was offered to. No refresh, so the reply stays
 * on screen beside the buttons.
 */
export async function respondByTokenAction(token: string, response: "accept" | "decline", _state: FormState, _form: FormData): Promise<FormState> {
  const brand = await getBrand();
  const db = createServiceClient();
  const offer = await findOffer(db, { token });
  if (!brand || !offer || offer.organizationSlug !== brand.slug) return { ok: false, message: m.openPlay.offerGone };
  return offerReply(await respondToOffer(db, { offerId: offer.id, response }));
}
