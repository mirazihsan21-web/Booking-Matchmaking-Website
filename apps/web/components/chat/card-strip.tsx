import Link from "next/link";
import { sectionStyle } from "@/components/site/section-style";
import type { ChatCard } from "@/lib/chat/rows";
import { cardWhen } from "@/lib/chat/time";
import { m } from "@/messages";
import { cardHref, cardLeft } from "./card-item";

/** The open cards above the room, soonest game first, so they don't scroll away under the chat. */
export function CardStrip({ cards, timeZone }: { cards: Array<{ card: ChatCard; seatsLeft: number | null }>; timeZone: string }) {
  if (cards.length === 0) return null;
  return (
    <section aria-label={m.chat.stripTitle} className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.chat.stripTitle}</h2>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {cards.map(({ card, seatsLeft }) => (
          <li key={card.id} className="shrink-0">
            <Link
              href={cardHref(card)}
              style={sectionStyle(card.sectionAccent)}
              className="press flex w-56 flex-col gap-0.5 rounded-xl border-l-[3px] border-section bg-card p-3 text-sm hover:bg-raised"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-section">{card.sectionName}</span>
              <span className="font-semibold">{card.title}</span>
              <span className="text-muted-foreground">{cardWhen(card, timeZone)}</span>
              <span className="font-semibold text-section">{cardLeft(card, seatsLeft)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
