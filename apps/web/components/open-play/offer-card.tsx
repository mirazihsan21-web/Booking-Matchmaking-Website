import { ActionButton, type FormAction } from "@/components/forms/action-form";
import { formatNight, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import type { OfferView } from "@/lib/open-play/open-play";
import { m } from "@/messages";
import { MinutesLeft } from "./minutes-left";

/** True while the offer can still be answered. */
export const offerIsOpen = (offer: OfferView | null): offer is OfferView =>
  offer !== null && offer.status === "pending" && new Date(offer.expiresAt) > new Date();

/**
 * A seat offer: the game, space, team, price and time left, with Take the seat / No thanks.
 * Both are POSTs (server actions); opening the page never accepts. The buttons stay after an answer
 * so the reply shows next to them; pressing again says the offer is no longer available.
 */
export function OfferCard({ offer, timeZone, accept, decline }: { offer: OfferView; timeZone: string; accept: FormAction; decline: FormAction }) {
  const { session } = offer;
  const pill = "rounded-full bg-raised px-3 py-1 text-xs font-semibold";
  return (
    <section className="rise flex max-w-xl flex-col gap-4 rounded-xl border-l-[3px] border-section bg-card p-5 sm:p-6">
      <h1 className="font-display text-4xl uppercase leading-none tracking-wide">{m.openPlay.offerTitle}</h1>
      <p className="text-muted-foreground">
        {session.activityName}, {formatNight(session.startsAt, timeZone)}–{formatShortTime(session.endsAt, timeZone)}
      </p>
      <div className="flex flex-wrap gap-2">
        <span className={pill}>{session.resourceName}</span>
        {offer.team !== null && <span className={pill}>{m.openPlay.team(offer.team)}</span>}
        <span className={pill}>{m.site.perSeat(formatBdt(session.pricePoisha))}</span>
      </div>
      <p className="text-sm font-semibold text-warning">
        {m.openPlay.offerEnds(formatShortTime(offer.expiresAt, timeZone))} · <MinutesLeft until={offer.expiresAt} />
      </p>
      <div className="flex flex-wrap gap-3">
        <ActionButton action={accept} label={m.openPlay.takeSeat} variant="section" />
        <ActionButton action={decline} label={m.openPlay.noThanks} />
      </div>
    </section>
  );
}

export function OfferGone() {
  return <p className="text-muted-foreground">{m.openPlay.offerGone}</p>;
}
