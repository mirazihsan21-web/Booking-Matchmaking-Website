import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cn } from "cn";
import { SlotPicker } from "@/components/bookings/slot-picker";
import { sectionStyle } from "@/components/site/section-style";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { spaceDay } from "@/lib/bookings/bookings";
import { addDays, currentBusinessDate, parseDateParam } from "@/lib/bookings/slots";
import { formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { createServiceClient } from "@/lib/service-client";
import { dayWindow } from "@/lib/site/days";
import { findSection } from "@/lib/site/home";
import { kindWords } from "@/lib/site/kinds";
import { bookPath, sectionPath } from "@/lib/site/paths";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { bookSpaceAction } from "./actions";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const DAY_MS = 86_400_000;

/** "Fri" and "30" for a YYYY-MM-DD date (a calendar date, so read in UTC). */
const dayParts = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return { weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d), day: d.getUTCDate() };
};

async function Book({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { section: slug } = await params;
  const query = await searchParams;
  await requireUser(bookPath(slug));
  const player = await getSitePlayer();
  if (!player) return null;
  const { brand } = player;
  const section = findSection(brand.sections, slug);
  if (!section) notFound();

  if (!player.profileId) {
    return (
      <div className="flex max-w-xl flex-col gap-4 rounded-xl bg-card p-6">
        <p>{m.bookings.createProfileFirst}</p>
        <Link href="/me" className={cn(buttonVariants({ variant: "section", size: "lg" }), "self-start px-4")}>
          {m.bookings.createProfile}
        </Link>
      </div>
    );
  }

  const db = createServiceClient();
  const { data: spaces } = await db
    .from("resources")
    .select("id, name, slot_minutes, price_per_hour_poisha")
    .eq("section_id", section.id)
    .eq("active", true)
    .order("name");
  if (!spaces || spaces.length === 0) return <p className="text-muted-foreground">{m.bookings.unavailable}</p>;

  // Junk or foreign ?resource= falls back to the first space; a date outside the window to today.
  const space = spaces.find((s) => s.id === one(query.resource)) ?? spaces[0]!;
  // After midnight at a late-night section, "today" is still last night's business day.
  const today = currentBusinessDate(section.openingHours, new Date(), brand.timezone);
  const lastDay = addDays(today, section.rules.bookingHorizonDays);
  const asked = parseDateParam(one(query.date), today);
  const date = asked < today || asked > lastDay ? today : asked;
  // The day strip shows the week (from today, in steps of 7) that holds the chosen day.
  const weekOffset = Math.floor((Date.parse(date) - Date.parse(today)) / DAY_MS / 7) * 7;
  const strip = dayWindow(today, section.rules.bookingHorizonDays, addDays(today, weekOffset));
  const day = await spaceDay(db, { organizationId: brand.id, resourceId: space.id, date, withNames: false });

  const price =
    space.price_per_hour_poisha === null ? m.bookings.priceAtVenue : m.bookings.perSlot(formatBdt(Math.round((space.price_per_hour_poisha * space.slot_minutes) / 60)));
  const chip = (active: boolean) =>
    cn("press shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold", active ? "border-section bg-section text-on-section" : "border-border bg-card hover:border-section");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={sectionPath(section.slug)} className="font-display text-xl uppercase tracking-wide text-section hover:underline">
          {section.name}
        </Link>
        <h1 className="font-display text-4xl uppercase tracking-wide sm:text-5xl">{kindWords(section.kind).book}</h1>
        <p className="text-muted-foreground">{m.bookings.intro}</p>
      </div>

      <nav aria-label={m.bookings.space} className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {spaces.map((s) => (
          <Link key={s.id} href={bookPath(section.slug, { resource: s.id, date })} className={chip(s.id === space.id)}>
            {s.name}
          </Link>
        ))}
      </nav>

      <nav aria-label={m.bookings.day} className="flex items-center gap-2">
        {strip.prev ? (
          <Link href={bookPath(section.slug, { resource: space.id, date: strip.prev })} aria-label={m.bookings.previousDay} className="rounded-full p-2 hover:bg-raised">
            <ChevronLeft className="size-5" />
          </Link>
        ) : (
          <span className="w-9" />
        )}
        <div className="grid flex-1 grid-cols-7 gap-1.5">
          {strip.days.map((d) => {
            const { weekday, day: n } = dayParts(d);
            return (
              <Link
                key={d}
                href={bookPath(section.slug, { resource: space.id, date: d })}
                aria-current={d === date ? "date" : undefined}
                className={cn(
                  "press flex flex-col items-center rounded-xl border py-2 text-xs",
                  d === date ? "border-section bg-section text-on-section" : "border-border bg-card hover:border-section",
                )}
              >
                <span className="font-semibold uppercase">{weekday}</span>
                <span className="font-display text-xl">{n}</span>
              </Link>
            );
          })}
        </div>
        {strip.next ? (
          <Link href={bookPath(section.slug, { resource: space.id, date: strip.next })} aria-label={m.bookings.nextDay} className="rounded-full p-2 hover:bg-raised">
            <ChevronRight className="size-5" />
          </Link>
        ) : (
          <span className="w-9" />
        )}
      </nav>

      <SlotPicker
        key={`${space.id}-${date}`}
        action={bookSpaceAction.bind(null, space.id)}
        slotMinutes={space.slot_minutes}
        priceLabel={price}
        slots={(day?.slots ?? []).map((s) => ({
          start: s.start.toISOString(),
          label: `${formatShortTime(s.start.toISOString(), brand.timezone)}–${formatShortTime(s.end.toISOString(), brand.timezone)}`,
          state: s.state,
        }))}
      />
    </div>
  );
}

async function Shell({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { section: slug } = await params;
  const player = await getSitePlayer();
  const accent = player ? findSection(player.brand.sections, slug)?.accent : undefined;
  return (
    <main style={accent ? sectionStyle(accent) : undefined} className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Book params={params} searchParams={searchParams} />
    </main>
  );
}

export default function BookPage({ params, searchParams }: PageProps<"/[section]/book">) {
  return (
    <Suspense fallback={null}>
      <Shell params={params} searchParams={searchParams} />
    </Suspense>
  );
}
