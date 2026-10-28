import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "cn";
import { sectionStyle } from "@/components/site/section-style";
import { addDays, parseDateParam } from "@/lib/bookings/slots";
import { formatDay } from "@/lib/format";
import { brandBusinessDate } from "@/lib/manage/today";
import { formatBdt } from "@/lib/money";
import { takingsDay, takingsWeek } from "@/lib/payments/takings";
import { loadSections } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The owner's takings: a business day per section with a total, and the last seven days' cash. */
async function Takings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const manager = await requireManager("owner");
  const db = createServiceClient();
  const tz = manager.org.timezone;
  const sections = await loadSections(db, manager.org.id);
  const today = brandBusinessDate(sections, new Date(), tz);
  const date = parseDateParam(one(query.date), today);
  const [day, week] = await Promise.all([
    takingsDay(db, { organizationId: manager.org.id, date, timeZone: tz }),
    takingsWeek(db, { organizationId: manager.org.id, endDate: today, timeZone: tz }),
  ]);
  const t = m.manage.takings;
  const cell = "px-3 py-2 text-right tabular-nums";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl uppercase tracking-wide">{t.title}</h1>
        <nav aria-label={m.bookings.day} className="flex items-center gap-2">
          <Link href={`/manage/takings?date=${addDays(date, -1)}`} aria-label={m.staffBookings.previousDay} className="rounded-full p-2 hover:bg-raised">
            <ChevronLeft className="size-5" />
          </Link>
          <span className="min-w-36 text-center font-semibold">{formatDay(date)}</span>
          <Link href={`/manage/takings?date=${addDays(date, 1)}`} aria-label={m.staffBookings.nextDay} className="rounded-full p-2 hover:bg-raised">
            <ChevronRight className="size-5" />
          </Link>
        </nav>
      </div>

      <div className="overflow-x-auto rounded-xl bg-card">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="px-3 py-2 text-left font-semibold">{t.section}</th>
              <th scope="col" className={cn(cell, "font-semibold")}>{t.cash}</th>
              <th scope="col" className={cn(cell, "font-semibold")}>{t.bookings}</th>
              <th scope="col" className={cn(cell, "font-semibold")}>{t.seats}</th>
              <th scope="col" className={cn(cell, "font-semibold")}>{t.arrived}</th>
              <th scope="col" className={cn(cell, "font-semibold")}>{t.noShows}</th>
            </tr>
          </thead>
          <tbody>
            {day.rows.map((row) => {
              const section = sections.find((s) => s.id === row.sectionId);
              return (
                <tr key={row.sectionId} style={section ? sectionStyle(section.accent) : undefined} className="border-b border-border">
                  <th scope="row" className="border-l-[3px] border-section px-3 py-2 text-left font-semibold text-section">
                    {section?.name}
                  </th>
                  <td className={cn(cell, "font-semibold")}>{formatBdt(row.cashPoisha)}</td>
                  <td className={cell}>{row.bookings}</td>
                  <td className={cell}>{row.seats}</td>
                  <td className={cell}>{row.arrived}</td>
                  <td className={cell}>{row.noShows}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="px-3 py-2 text-left">{t.total}</th>
              <td className={cn(cell, "text-base")}>{formatBdt(day.total.cashPoisha)}</td>
              <td className={cell}>{day.total.bookings}</td>
              <td className={cell}>{day.total.seats}</td>
              <td className={cell}>{day.total.arrived}</td>
              <td className={cell}>{day.total.noShows}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide">{t.lastWeek}</h2>
        <ul className="flex max-w-md flex-col">
          {week.map((d) => (
            <li key={d.date}>
              <Link
                href={`/manage/takings?date=${d.date}`}
                aria-current={d.date === date ? "date" : undefined}
                className={cn("flex justify-between rounded-lg px-3 py-2 text-sm hover:bg-raised", d.date === date && "bg-raised font-semibold")}
              >
                <span>{formatDay(d.date)}</span>
                <span className="tabular-nums">{formatBdt(d.cashPoisha)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function TakingsPage({ searchParams }: PageProps<"/manage/takings">) {
  return (
    <Suspense fallback={null}>
      <Takings searchParams={searchParams} />
    </Suspense>
  );
}
