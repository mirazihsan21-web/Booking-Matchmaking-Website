import Link from "next/link";
import { cn } from "cn";
import { sectionStyle } from "@/components/site/section-style";
import type { ChatCard } from "@/lib/chat/rows";
import { cardWhen } from "@/lib/chat/time";
import { formatBdt } from "@/lib/money";
import { m } from "@/messages";

/** "3 spots left" / "6 seats left · ৳300 a seat", or the card's state once it isn't open. */
export function cardLeft(card: ChatCard, seatsLeft: number | null): string {
  if (card.status !== "open") return m.chat.card.status[card.status] ?? "";
  if (card.kind === "booking") return m.chat.card.spotsLeft((card.spotsNeeded ?? 0) - card.spotsTaken);
  const price = card.seatPricePoisha ? m.chat.card.perSeat(formatBdt(card.seatPricePoisha)) : null;
  return [seatsLeft === null ? null : m.chat.card.seatsLeft(seatsLeft), price].filter(Boolean).join(" · ");
}

/** Where a card's button goes: its game page (booking cards), or the open-play game's own page (seats). */
export const cardHref = (card: ChatCard) => (card.kind === "session" ? `/sessions/${card.sessionId}` : `/chat/games/${card.id}`);

/**
 * A "Need players" card as it shows in the room: the section's colour, what and when, who posted it, the note, and
 * what's left — with I'm in (or Your game for the poster), or Get a seat for an open-play game, while it's open.
 */
export function CardItem({ card, timeZone, mine, seatsLeft = null }: { card: ChatCard; timeZone: string; mine: boolean; seatsLeft?: number | null }) {
  const open = card.status === "open";
  return (
    <article style={sectionStyle(card.sectionAccent)} className="flex flex-col gap-1.5 rounded-lg border-l-[3px] border-section bg-background/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-section">
        {card.sectionName} · {card.kind === "booking" ? m.chat.card.needPlayers(card.spotsNeeded ?? 0) : m.chat.card.openPlay}
      </p>
      <p className="font-display text-xl uppercase leading-tight tracking-wide">{card.title}</p>
      <p className="text-sm text-muted-foreground">
        {cardWhen(card, timeZone)} · {card.kind === "session" && card.posterProfileId ? m.chat.card.going(card.posterName) : m.chat.card.postedBy(card.posterName)}
      </p>
      {card.note && <p className="whitespace-pre-wrap break-words text-sm">{card.note}</p>}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <span className={cn("text-sm font-semibold", open ? "text-section" : "text-muted-foreground")}>{cardLeft(card, seatsLeft)}</span>
        {open && (
          <Link href={cardHref(card)} className="press rounded-lg bg-section px-3 py-1.5 text-sm font-bold text-on-section">
            {card.kind === "session" ? m.chat.card.getSeat : mine ? m.chat.card.yourGame : m.chat.card.imIn}
          </Link>
        )}
      </div>
    </article>
  );
}
