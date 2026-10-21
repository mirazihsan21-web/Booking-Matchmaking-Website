import { ActionButton, type FormAction } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNight, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import type { OfferView } from "@/lib/open-play/open-play";
import { m } from "@/messages";
import { MinutesLeft } from "./minutes-left";

/** True while the offer can still be answered. */
export const offerIsOpen = (offer: OfferView | null): offer is OfferView =>
  offer !== null && offer.status === "pending" && new Date(offer.expiresAt) > new Date();

/**
 * A seat offer: the session, space, team, price and time left, with Take the seat / No thanks.
 * Both are POSTs (server actions); opening the page never accepts. The buttons stay after an answer
 * so the reply shows next to them; pressing again says the offer is no longer available.
 */
export function OfferCard({ offer, timeZone, accept, decline }: { offer: OfferView; timeZone: string; accept: FormAction; decline: FormAction }) {
  const { session } = offer;
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-2xl">{m.openPlay.offerTitle}</CardTitle>
        <CardDescription>
          {session.activityName}, {formatNight(session.startsAt, timeZone)}–{formatShortTime(session.endsAt, timeZone)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{session.resourceName}</Badge>
          {offer.team !== null && <Badge variant="outline">{m.openPlay.team(offer.team)}</Badge>}
          <Badge variant="secondary">{m.openPlay.perSeat(formatBdt(session.pricePoisha))}</Badge>
        </div>
        <p className="text-sm text-foreground/70">
          {m.openPlay.offerEnds(formatShortTime(offer.expiresAt, timeZone))} · <MinutesLeft until={offer.expiresAt} />
        </p>
        <div className="flex flex-wrap gap-3">
          <ActionButton action={accept} label={m.openPlay.takeSeat} variant="default" />
          <ActionButton action={decline} label={m.openPlay.noThanks} />
        </div>
      </CardContent>
    </Card>
  );
}

export function OfferGone() {
  return <p className="text-foreground/70">{m.openPlay.offerGone}</p>;
}
