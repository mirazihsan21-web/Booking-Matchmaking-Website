import type { FormState } from "@/components/forms/action-form";
import type { RespondOutcome } from "@/lib/open-play/open-play";
import { m } from "@/messages";

/** What a player sees after Take the seat / No thanks. Anything but a fresh answer: no longer available. */
export function offerReply(outcome: RespondOutcome): FormState {
  const message = m.openPlay.offerReply[outcome];
  return message ? { ok: true, message } : { ok: false, message: m.openPlay.offerGone };
}
