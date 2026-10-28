import Link from "next/link";
import { cn } from "cn";
import { sectionStyle } from "@/components/site/section-style";
import { formatShortTime } from "@/lib/format";
import type { DeskGame, DeskSpace } from "@/lib/manage/desk-day";
import { placeOnTimeline } from "@/lib/manage/today";
import type { Section } from "@/lib/sections/sections";
import { m } from "@/messages";
import { BookingPanel } from "./booking-panel";
import { panelFor } from "./panel-props";

const HOUR = 3_600_000;
const bookPanelHref = (resourceId: string, at: Date) => `/manage?book=${resourceId}&at=${encodeURIComponent(at.toISOString())}`;

/**
 * The day on a laptop or tablet: one row per space, grouped by section in its colour; hours across from
 * the earliest opening to the latest close (stretched to cover any booking); bookings open their panel,
 * games link to their page, free gaps open Book for a customer; a line marks now.
 */
export function Timeline({
  window,
  sections,
  games,
  now,
  timeZone,
}: {
  window: { start: Date; end: Date };
  sections: Array<{ section: Section; spaces: DeskSpace[] }>;
  games: DeskGame[];
  now: Date;
  timeZone: string;
}) {
  const ticks: Date[] = [];
  for (let t = Math.ceil(window.start.getTime() / HOUR) * HOUR; t < window.end.getTime(); t += HOUR) ticks.push(new Date(t));
  const nowAt = placeOnTimeline(window, now, new Date(now.getTime() + 1));
  const style = (p: { leftPct: number; widthPct: number }) => ({ left: `${p.leftPct}%`, width: `${p.widthPct}%` });

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[56rem]">
        <div className="grid grid-cols-[10rem_1fr]">
          <span />
          <div className="relative h-6 text-xs text-muted-foreground">
            {ticks.map((t) => {
              const at = placeOnTimeline(window, t, new Date(t.getTime() + 1))!;
              return (
                <span key={t.toISOString()} className="absolute -translate-x-1/2" style={{ left: `${at.leftPct}%` }}>
                  {formatShortTime(t.toISOString(), timeZone)}
                </span>
              );
            })}
          </div>
        </div>
        {sections.map(({ section, spaces }) => (
          <div key={section.id} style={sectionStyle(section.accent)} className="mt-4 flex flex-col gap-1.5">
            <h2 className="font-display text-xl uppercase tracking-wide text-section">{section.name}</h2>
            {spaces.length === 0 && <p className="text-sm text-muted-foreground">{m.manage.today.closed}</p>}
            {spaces.map((space) => (
              <div key={space.id} className="grid grid-cols-[10rem_1fr] items-center">
                <span className="flex items-center gap-2 truncate border-l-[3px] border-section pl-2 text-sm font-semibold">
                  {space.name}
                  {!space.active && <span className="rounded-full bg-raised px-1.5 text-[10px] font-normal text-muted-foreground">{m.manage.today.off}</span>}
                </span>
                <div className="relative h-12 rounded-lg bg-card">
                  {space.gaps.map((gap) => {
                    const at = placeOnTimeline(window, gap.start, gap.end);
                    return at ? (
                      <Link
                        key={gap.start.toISOString()}
                        href={bookPanelHref(space.id, gap.start)}
                        title={`${m.manage.today.free} ${formatShortTime(gap.start.toISOString(), timeZone)}–${formatShortTime(gap.end.toISOString(), timeZone)}`}
                        className="absolute top-1 bottom-1 rounded-md border border-dashed border-transparent hover:border-section"
                        style={style(at)}
                      >
                        <span className="sr-only">{m.manage.today.free}</span>
                      </Link>
                    ) : null;
                  })}
                  {games
                    .filter((g) => g.resourceIds.includes(space.id))
                    .map((g) => {
                      const at = placeOnTimeline(window, g.start, g.end);
                      return at ? (
                        <Link
                          key={g.sessionId}
                          href={`/manage/games/${g.sessionId}`}
                          className="absolute top-1 bottom-1 flex items-center gap-2 overflow-hidden rounded-md border border-dashed border-section bg-raised px-2 text-xs font-semibold"
                          style={style(at)}
                        >
                          <span className="truncate">{g.name ?? m.site.anyGame}</span>
                          <span className="shrink-0 text-section">{m.manage.today.seats(g.seats.total - g.seats.left, g.seats.total)}</span>
                        </Link>
                      ) : null;
                    })}
                  {space.bookings
                    .filter((b) => b.status !== "cancelled")
                    .map((b) => {
                      const at = placeOnTimeline(window, b.start, b.end);
                      if (!at) return null;
                      const { booking, actions } = panelFor(b, space.name);
                      return (
                        <span key={b.id} className="absolute top-1 bottom-1" style={style(at)}>
                          <BookingPanel
                            booking={booking}
                            actions={actions}
                            timeZone={timeZone}
                            className={cn(
                              "flex h-full w-full items-center gap-1.5 overflow-hidden rounded-md px-2 text-left text-xs font-semibold",
                              b.status === "attended" ? "bg-section text-on-section" : "border-l-[3px] border-section bg-raised",
                              b.status === "no_show" && "text-muted-foreground line-through",
                            )}
                          >
                            <span className="truncate">{b.name}</span>
                            {b.status === "attended" && <span aria-hidden>✓</span>}
                            {b.payment && <span className="shrink-0 rounded bg-background/30 px-1">{m.manage.today.paid}</span>}
                          </BookingPanel>
                        </span>
                      );
                    })}
                  {nowAt && <span aria-label={m.manage.today.now} className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-warning" style={{ left: `${nowAt.leftPct}%` }} />}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
