import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "cn";
import { NotLiveBanner } from "@/components/manage/not-live-banner";
import { BookForCustomer } from "@/components/manage/today/book-for-customer";
import { NowNext } from "@/components/manage/today/now-next";
import { Timeline } from "@/components/manage/today/timeline";
import { AutoRefresh } from "@/components/site/auto-refresh";
import { sectionStyle } from "@/components/site/section-style";
import { buttonVariants } from "@/components/ui/button";
import { spaceDay } from "@/lib/bookings/bookings";
import { currentBusinessDate, parseDateParam } from "@/lib/bookings/slots";
import { formatDay, formatShortTime } from "@/lib/format";
import { loadDeskDay } from "@/lib/manage/desk-day";
import { brandBusinessDate, isDeskFree } from "@/lib/manage/today";
import { formatBdt } from "@/lib/money";
import { loadSections, type Section } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Today: the desk's day across the sections this person runs (or one of them, by its chip). */
async function Today({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const manager = await requireManager("staff");
  const db = createServiceClient();
  const allowed = (await loadSections(db, manager.org.id)).filter((s) => manager.sectionIds.includes(s.id));
  const picked = allowed.filter((s) => s.slug === one(query.section));
  const shown = picked.length ? picked : allowed;
  const now = new Date();
  const tz = manager.org.timezone;
  const date = brandBusinessDate(shown, now, tz);
  const day = await loadDeskDay(db, { organizationId: manager.org.id, sectionIds: shown.map((s) => s.id), date, now, timeZone: tz });

  // The timeline runs over opening hours, stretched to cover any booking or game outside them.
  const times = [
    ...(day.window ? [day.window.start, day.window.end] : []),
    ...day.sections.flatMap((s) => s.spaces.flatMap((sp) => sp.bookings.flatMap((b) => [b.start, b.end]))),
    ...day.games.flatMap((g) => [g.start, g.end]),
  ].map((d) => d.getTime());
  const window = times.length ? { start: new Date(Math.min(...times)), end: new Date(Math.max(...times)) } : null;
  const panel = one(query.book) ? await bookPanel(db, { allowed, shown, query, now, organizationId: manager.org.id, timeZone: tz }) : null;
  const chip = (active: boolean) => cn("press shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold", active ? "border-section bg-section text-on-section" : "border-border bg-card hover:border-section");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl uppercase tracking-wide">{m.manage.today.title}</h1>
          <p className="text-muted-foreground">{formatDay(date)}</p>
        </div>
        <Link href="/manage?book=new" className={cn(buttonVariants({ size: "lg" }), "press h-10 gap-2 px-4")}>
          <Plus aria-hidden className="size-4" />
          {m.manage.today.bookForCustomer}
        </Link>
      </div>
      {manager.org.status !== "live" && <NotLiveBanner isOwner={manager.role === "owner"} />}
      {panel}
      {allowed.length > 1 && (
        <nav aria-label={m.staffBookings.section} className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Link href="/manage" className={chip(picked.length === 0)} style={{ ["--section" as string]: "var(--foreground)" }}>
            {m.manage.today.all}
          </Link>
          {allowed.map((s) => (
            <Link key={s.id} href={`/manage?section=${s.slug}`} style={sectionStyle(s.accent)} className={chip(picked[0]?.id === s.id)}>
              {s.name}
            </Link>
          ))}
        </nav>
      )}
      <p className="text-sm text-muted-foreground">
        {m.manage.today.counts(day.counts.bookings, day.counts.arrived, day.counts.noShows, formatBdt(day.counts.cashPoisha))}
      </p>
      {window ? (
        <>
          <div className="hidden md:block">
            <Timeline window={window} sections={day.sections} games={day.games} now={now} timeZone={tz} />
          </div>
          <div className="md:hidden">
            <NowNext sections={day.sections} games={day.games} now={now} timeZone={tz} />
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">{m.manage.today.closed}</p>
      )}
      <AutoRefresh />
    </div>
  );
}

/**
 * Book for a customer, opened by `?book=<space id>` (or `new`), optionally `&at=<ISO>` from a free gap and
 * `&date=`: the allowed active spaces by section, and the chosen space's free starts that business day.
 */
async function bookPanel(
  db: ReturnType<typeof createServiceClient>,
  input: { allowed: Section[]; shown: Section[]; query: Record<string, string | string[] | undefined>; now: Date; organizationId: string; timeZone: string },
) {
  const { data } = await db
    .from("resources")
    .select("id, name, section_id")
    .in("section_id", input.allowed.map((s) => s.id))
    .eq("active", true)
    .order("name");
  const spaces = data ?? [];
  const chosen = spaces.find((r) => r.id === one(input.query.book)) ?? spaces.find((r) => input.shown.some((s) => s.id === r.section_id)) ?? spaces[0];
  if (!chosen) return null;
  const section = input.allowed.find((s) => s.id === chosen.section_id)!;
  const at = one(input.query.at);
  const atDate = at ? new Date(at) : null;
  const base = currentBusinessDate(section.openingHours, atDate && !Number.isNaN(atDate.getTime()) ? atDate : input.now, input.timeZone);
  const date = parseDateParam(one(input.query.date), base);
  const day = await spaceDay(db, { organizationId: input.organizationId, resourceId: chosen.id, date, withNames: true, now: input.now });
  const label = (d: Date) => formatShortTime(d.toISOString(), input.timeZone);
  const starts = (day?.slots ?? []).filter((s) => isDeskFree(s, input.now)).map((s) => ({ value: s.start.toISOString(), label: `${label(s.start)}–${label(s.end)}` }));
  const picked = atDate && starts.some((s) => s.value === atDate.toISOString()) ? atDate.toISOString() : null;
  const groups = input.allowed
    .map((s) => ({ name: s.name, spaces: spaces.filter((r) => r.section_id === s.id).map((r) => ({ id: r.id as string, name: r.name as string })) }))
    .filter((g) => g.spaces.length > 0);
  return <BookForCustomer groups={groups} resourceId={chosen.id} date={date} starts={starts} picked={picked} />;
}

export default function TodayPage({ searchParams }: PageProps<"/manage">) {
  return (
    <Suspense fallback={null}>
      <Today searchParams={searchParams} />
    </Suspense>
  );
}
