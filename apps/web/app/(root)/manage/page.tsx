import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "cn";
import { NotLiveBanner } from "@/components/manage/not-live-banner";
import { NowNext } from "@/components/manage/today/now-next";
import { Timeline } from "@/components/manage/today/timeline";
import { AutoRefresh } from "@/components/site/auto-refresh";
import { sectionStyle } from "@/components/site/section-style";
import { buttonVariants } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { loadDeskDay } from "@/lib/manage/desk-day";
import { brandBusinessDate } from "@/lib/manage/today";
import { formatBdt } from "@/lib/money";
import { loadSections } from "@/lib/sections/sections";
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

export default function TodayPage({ searchParams }: PageProps<"/manage">) {
  return (
    <Suspense fallback={null}>
      <Today searchParams={searchParams} />
    </Suspense>
  );
}
