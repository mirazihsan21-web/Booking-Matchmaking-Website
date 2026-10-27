import Link from "next/link";
import { cn } from "cn";
import { formatNight } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import type { UpcomingGame } from "@/lib/site/home";
import { m } from "@/messages";
import { SeatsBar } from "./seats-bar";
import { sectionStyle } from "./section-style";

/** One game on the board, in its section's colour: when, what, where, price and how full. */
export function GameCard({
  game,
  sectionName,
  accent,
  timeZone,
  index = 0,
  className,
}: {
  game: UpcomingGame;
  sectionName: string;
  accent: string;
  timeZone: string;
  /** Position in a list, so cards rise in one after another. */
  index?: number;
  className?: string;
}) {
  return (
    <Link
      href={`/sessions/${game.id}`}
      style={{ ...sectionStyle(accent), ["--i" as string]: index }}
      className={cn(
        "rise press flex flex-col gap-3 rounded-xl border-l-[3px] border-section bg-card p-4 outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-section",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{formatNight(game.startsAt, timeZone)}</span>
        <span className="font-semibold text-section">{sectionName}</span>
      </div>
      <div>
        <p className="font-display text-xl uppercase tracking-wide">{game.activityName ?? m.site.anyGame}</p>
        <p className="text-xs text-muted-foreground">{m.site.perSeat(formatBdt(game.pricePoisha))}</p>
      </div>
      <SeatsBar left={game.left} total={game.total} />
    </Link>
  );
}
