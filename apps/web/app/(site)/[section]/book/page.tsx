import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cn } from "cn";
import { SlotPicker } from "@/components/bookings/slot-picker";
import { AutoRefresh } from "@/components/site/auto-refresh";
import { sectionStyle } from "@/components/site/section-style";
import { TeamNote } from "@/components/site/team-note";
import { spaceDay } from "@/lib/bookings/bookings";
import { addDays, currentBusinessDate, parseDateParam } from "@/lib/bookings/slots";
import { formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { createServiceClient } from "@/lib/service-client";
import { dayWindow } from "@/lib/site/days";
import { findSection } from "@/lib/site/home";
import { teamDeskHref } from "@/lib/manage/team-links";
import { kindWords } from "@/lib/site/kinds";
import { bookPath, sectionPath } from "@/lib/site/paths";
import { paymentNumbers } from "@/lib/payments/numbers";
import { getBrand } from "@/lib/tenancy/brand";
import { getSitePlayer, getTeamSectionIds } from "@/lib/tenancy/player";
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
  // Anyone may look at the grid; booking needs sign-in and a profile (the bar says which).
  const player = await getSitePlayer();
  const brand = player?.brand ?? (await getBrand());
  if (!brand) return null; // the layout shows "Not open yet"
  const section = findSection(brand.sections, slug);
  if (!section) notFound();

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

  // Team logins are venue-only: they can still pick a space, but the page says where the desk books it
  // instead of showing the day and slots.
  const teamLink = player?.isTeam ? teamDeskHref({ kind: "space", sectionId: section.id, resourceId: space.id }, await getTeamSectionIds(player)) : null;
  // After midnight at a late-night section, "today" is still last night's business day.
  const today = currentBusinessDate(section.openingHours, new Date(), brand.timezone);
  const lastDay = addDays(today, section.rules.bookingHorizonDays);
  const asked = parseDateParam(one(query.date), today);
  const date = asked < today || asked > lastDay ? today : asked;
  // The day strip shows the week (from today, in steps of 7) that holds the chosen day.
  const weekOffset = Math.floor((Date.parse(date) - Date.parse(today)) / DAY_MS / 7) * 7;
  const strip = dayWindow(today, section.rules.bookingHorizonDays, addDays(today, weekOffset));
  const day = teamLink ? null : await spaceDay(db, { organizationId: brand.id, resourceId: space.id, date, withNames: false });
  // Signed out → sign in and come back to this space and day; no profile yet → make one first.
  const blocked = !player
    ? { href: `/signin?next=${encodeURIComponent(bookPath(section.slug, { resource: space.id, date }))}`, label: m.bookings.signInToBook }
    : !player.profileId
      ? { href: "/me/edit", label: m.bookings.createProfileToBook }
      : null;

  const perSlotPoisha = space.price_per_hour_poisha === null ? 0 : Math.round((space.price_per_hour_poisha * space.slot_minutes) / 60);
  const price = space.price_per_hour_poisha === null ? m.bookings.priceAtVenue : m.bookings.perSlot(formatBdt(perSlotPoisha));
  // A priced space is paid by bKash or Nagad before the venue confirms — and can't be requested until it has a number.
  const numbers = perSlotPoisha > 0 && !blocked ? await paymentNumbers(db, brand.id) : null;
  const payOnline = numbers && (numbers.bkash || numbers.nagad) ? { perSlotPoisha } : null;
  const paused = numbers && !payOnline ? m.payments.closed(brand.address) : null;
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

      {teamLink ? (
        <TeamNote brandName={brand.name} link={teamLink} />
      ) : (
        <>
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
            blocked={blocked}
            slotMinutes={space.slot_minutes}
            priceLabel={price}
            payOnline={payOnline}
            paused={paused}
            slots={(day?.slots ?? []).map((s) => ({
              start: s.start.toISOString(),
              label: `${formatShortTime(s.start.toISOString(), brand.timezone)}–${formatShortTime(s.end.toISOString(), brand.timezone)}`,
              state: s.state,
            }))}
          />
        </>
      )}
      {/* Slots others book while this page is open turn Taken within half a minute. */}
      <AutoRefresh />
    </div>
  );
}

async function Shell({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { section: slug } = await params;
  const brand = (await getSitePlayer())?.brand ?? (await getBrand());
  const accent = brand ? findSection(brand.sections, slug)?.accent : undefined;
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
