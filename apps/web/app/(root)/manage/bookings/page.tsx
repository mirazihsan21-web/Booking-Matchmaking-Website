import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "cn";
import { ActionButton } from "@/components/forms/action-form";
import { sectionStyle } from "@/components/site/section-style";
import { sectionDay, type SlotBooking } from "@/lib/bookings/bookings";
import { addDays, parseDateParam } from "@/lib/bookings/slots";
import { formatDay, formatShortTime } from "@/lib/format";
import { brandBusinessDate } from "@/lib/manage/today";
import { loadSections } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";
import { setDeskStatusAction } from "../desk-actions";
import { cancelBookingAction } from "./actions";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
type Row = SlotBooking & { spaceName: string };

/** One booking: time, space, who (a walk-in's phone to call), its state, and what the desk can do now. */
function BookingRow({ row, timeZone }: { row: Row; timeZone: string }) {
  const time = `${formatShortTime(row.start.toISOString(), timeZone)}–${formatShortTime(row.end.toISOString(), timeZone)}`;
  const desk = m.manage.desk;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border-l-[3px] border-section bg-card px-4 py-3 text-sm">
      <span className="w-28 font-semibold">{time}</span>
      <span className="text-muted-foreground">{row.spaceName}</span>
      <span className="font-semibold">{row.name}</span>
      {row.phone && (
        <a href={`tel:${row.phone}`} className="text-muted-foreground underline-offset-4 hover:underline">
          {row.phone}
        </a>
      )}
      {row.phone && <span className="rounded-full bg-raised px-2 py-0.5 text-xs">{desk.walkIn}</span>}
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", row.status === "confirmed" ? "bg-raised" : "bg-section text-on-section")}>
        {desk.status[row.status] ?? row.status}
      </span>
      <span className="ml-auto flex flex-wrap gap-2">
        {row.status === "confirmed" ? (
          <>
            <ActionButton action={setDeskStatusAction.bind(null, "space", row.id, "attended")} label={desk.arrived} variant="section" />
            <ActionButton action={setDeskStatusAction.bind(null, "space", row.id, "no_show")} label={desk.noShow} />
            <ActionButton action={cancelBookingAction.bind(null, row.id)} label={desk.cancel} variant="ghost" />
          </>
        ) : row.status !== "cancelled" ? (
          <ActionButton action={setDeskStatusAction.bind(null, "space", row.id, "confirmed")} label={desk.undo} />
        ) : null}
      </span>
    </li>
  );
}

async function Bookings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const manager = await requireManager("staff");
  const db = createServiceClient();
  const sections = (await loadSections(db, manager.org.id)).filter((s) => manager.sectionIds.includes(s.id));
  if (sections.length === 0) return <p className="text-muted-foreground">{m.manage.noSections}</p>;

  const now = new Date();
  const tz = manager.org.timezone;
  const today = brandBusinessDate(sections, now, tz);
  const date = parseDateParam(one(query.date), today);
  const q = (one(query.q) ?? "").trim();
  const matches = (b: SlotBooking) => !q || b.name.toLowerCase().includes(q.toLowerCase()) || (b.phone ?? "").includes(q);

  const days = await Promise.all(sections.map((s) => sectionDay(db, { organizationId: manager.org.id, sectionId: s.id, date, now })));
  const groups = sections.map((section, i) => {
    const seen = new Map<string, Row>();
    for (const day of days[i] ?? []) {
      for (const b of [...day.slots.flatMap((slot) => slot.bookings ?? []), ...(day.extra ?? [])]) {
        if (!seen.has(b.id) && matches(b)) seen.set(b.id, { ...b, spaceName: day.resource.name });
      }
    }
    return { section, rows: [...seen.values()].sort((a, b) => a.start.getTime() - b.start.getTime()) };
  });
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const href = (d: string) => `/manage/bookings?date=${d}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl uppercase tracking-wide">{m.manage.bookingsPage.title}</h1>
        <nav aria-label={m.bookings.day} className="flex items-center gap-2">
          <Link href={href(addDays(date, -1))} aria-label={m.staffBookings.previousDay} className="rounded-full p-2 hover:bg-raised">
            <ChevronLeft className="size-5" />
          </Link>
          <span className="min-w-36 text-center font-semibold">{formatDay(date)}</span>
          <Link href={href(addDays(date, 1))} aria-label={m.staffBookings.nextDay} className="rounded-full p-2 hover:bg-raised">
            <ChevronRight className="size-5" />
          </Link>
        </nav>
      </div>
      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="date" value={date} />
        <label className="relative flex-1">
          <span className="sr-only">{m.manage.bookingsPage.search}</span>
          <Search aria-hidden className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={q} placeholder={m.manage.bookingsPage.search} className="h-10 w-full rounded-lg border border-input bg-card pr-3 pl-9 text-sm" />
        </label>
        <button type="submit" className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-raised">
          {m.manage.bookingsPage.searchButton}
        </button>
      </form>
      {total === 0 && <p className="text-muted-foreground">{q ? m.manage.bookingsPage.noMatches(q) : m.manage.bookingsPage.noBookings}</p>}
      {groups
        .filter((g) => g.rows.length > 0)
        .map(({ section, rows }) => (
          <section key={section.id} style={sectionStyle(section.accent)} className="flex flex-col gap-2">
            <h2 className="font-display text-2xl uppercase tracking-wide text-section">{section.name}</h2>
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <BookingRow key={row.id} row={row} timeZone={tz} />
              ))}
            </ul>
          </section>
        ))}
      <p className="text-sm text-muted-foreground">{m.manage.bookingsPage.walkIns}</p>
    </div>
  );
}

export default function BookingsPage({ searchParams }: PageProps<"/manage/bookings">) {
  return (
    <Suspense fallback={null}>
      <Bookings searchParams={searchParams} />
    </Suspense>
  );
}
