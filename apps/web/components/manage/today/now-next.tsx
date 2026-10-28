import Link from "next/link";
import { cn } from "cn";
import { ActionButton, ActionForm } from "@/components/forms/action-form";
import { sectionStyle } from "@/components/site/section-style";
import { formatShortTime } from "@/lib/format";
import { amountInput, formatBdt } from "@/lib/money";
import type { DeskBooking, DeskGame, DeskSpace } from "@/lib/manage/desk-day";
import type { Section } from "@/lib/sections/sections";
import { m } from "@/messages";
import { BookingPanel } from "./booking-panel";
import { panelFor } from "./panel-props";

type Item = { at: Date; section: Section; spaceName: string } & ({ booking: DeskBooking } | { game: DeskGame });

/**
 * The day on a phone: spaces free this hour as chips, then everything by start time with one-tap
 * Arrived / No-show (or Undo); what already ended folds into "Earlier today".
 */
export function NowNext({
  sections,
  games,
  now,
  timeZone,
}: {
  sections: Array<{ section: Section; spaces: DeskSpace[] }>;
  games: DeskGame[];
  now: Date;
  timeZone: string;
}) {
  const time = (s: Date, e: Date) => `${formatShortTime(s.toISOString(), timeZone)}–${formatShortTime(e.toISOString(), timeZone)}`;
  const free = sections.flatMap(({ section, spaces }) =>
    spaces.flatMap((space) => space.gaps.filter((g) => g.start <= now && now < g.end).map((g) => ({ section, space, gap: g }))),
  );
  const spaceName = new Map(sections.flatMap(({ spaces }) => spaces.map((s) => [s.id, s.name] as const)));
  const sectionOf = new Map(sections.map(({ section }) => [section.id, section]));
  const items: Item[] = [
    ...sections.flatMap(({ section, spaces }) =>
      spaces.flatMap((space) => space.bookings.filter((b) => b.status !== "cancelled").map((b): Item => ({ at: b.start, section, spaceName: space.name, booking: b }))),
    ),
    ...games.map((g): Item => ({ at: g.start, section: sectionOf.get(g.sectionId)!, spaceName: g.resourceIds.map((id) => spaceName.get(id)).filter(Boolean).join(", "), game: g })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const ended = (item: Item) => ("booking" in item ? item.booking.end : item.game.end) <= now;
  const earlier = items.filter(ended);
  const coming = items.filter((i) => !ended(i));

  const card = (item: Item) => {
    if ("game" in item) {
      const g = item.game;
      return (
        <li key={g.sessionId} style={sectionStyle(item.section.accent)}>
          <Link href={`/manage/games/${g.sessionId}`} className="flex flex-col gap-1 rounded-xl border border-dashed border-section bg-card px-4 py-3 text-sm">
            <span className="font-semibold">{time(g.start, g.end)}</span>
            <span className="text-section">{item.spaceName}</span>
            <span className="font-semibold">
              {g.name ?? m.site.anyGame} · {m.manage.today.seats(g.seats.total - g.seats.left, g.seats.total)}
            </span>
          </Link>
        </li>
      );
    }
    const b = item.booking;
    const { booking, actions } = panelFor(b, item.spaceName);
    return (
      <li key={b.id} style={sectionStyle(item.section.accent)} className="flex flex-col gap-2 rounded-xl border-l-[3px] border-section bg-card px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">{time(b.start, b.end)}</span>
          <span className="text-section">{item.spaceName}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", b.status === "confirmed" ? "bg-raised" : "bg-section text-on-section")}>
            {m.manage.desk.status[b.status] ?? b.status}
          </span>
          {b.payment && <span className="rounded-full bg-raised px-2 py-0.5 text-xs">{m.manage.today.paid}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3">
          <span className="font-semibold">{b.name}</span>
          {b.phone && (
            <a href={`tel:${b.phone}`} className="text-muted-foreground underline underline-offset-4">
              {b.phone}
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {b.status === "confirmed" ? (
            <>
              <ActionButton action={actions.arrived} label={m.manage.desk.arrived} variant="section" />
              <ActionButton action={actions.noShow} label={m.manage.desk.noShow} />
            </>
          ) : (
            <ActionButton action={actions.undo} label={m.manage.desk.undo} />
          )}
          {!b.payment && b.pricePoisha > 0 && (
            <ActionForm action={actions.pay} submitLabel={`${m.manage.desk.paid} ${formatBdt(b.pricePoisha)}`} className="flex-row">
              <input type="hidden" name="amount" value={amountInput(b.pricePoisha)} />
            </ActionForm>
          )}
          <BookingPanel booking={booking} actions={actions} timeZone={timeZone} className="h-8 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-raised">
            {m.manage.panel.details}
          </BookingPanel>
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {free.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{m.manage.today.freeNow}</h2>
          <div className="flex flex-wrap gap-2">
            {free.map(({ section, space, gap }) => (
              <Link
                key={`${space.id}-${gap.start.toISOString()}`}
                href={`/manage?book=${space.id}&at=${encodeURIComponent(gap.start.toISOString())}`}
                style={sectionStyle(section.accent)}
                className="rounded-full border border-section px-3 py-1.5 text-sm font-semibold"
              >
                {space.name}
              </Link>
            ))}
          </div>
        </div>
      )}
      {items.length === 0 && <p className="text-muted-foreground">{m.manage.today.nothingToday}</p>}
      {earlier.length > 0 && (
        <details className="rounded-xl bg-card/50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">{m.manage.today.earlier(earlier.length)}</summary>
          <ul className="mt-2 flex flex-col gap-2">{earlier.map(card)}</ul>
        </details>
      )}
      <ul className="flex flex-col gap-2">{coming.map(card)}</ul>
    </div>
  );
}
