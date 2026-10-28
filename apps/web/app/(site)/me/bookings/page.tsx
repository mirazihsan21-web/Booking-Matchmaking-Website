import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { cn } from "cn";
import { ActionButton } from "@/components/forms/action-form";
import { MeTabs } from "@/components/site/me-tabs";
import { sectionStyle } from "@/components/site/section-style";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { listMyBookings, type MyBooking } from "@/lib/bookings/bookings";
import { formatNight, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { listMySeats, type MySeat } from "@/lib/open-play/open-play";
import type { Section } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { cancelMyBookingAction, cancelSeatAction } from "./actions";

/** One row: a side line and name in its section's colour, then what, when, price and the action. */
function RowShell({ section, faded, children }: { section: Section | undefined; faded?: boolean; children: ReactNode }) {
  return (
    <li
      style={section ? sectionStyle(section.accent) : undefined}
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border-l-[3px] border-section bg-card px-4 py-3 text-sm", faded && "opacity-70")}
    >
      {section && <span className="w-full font-display text-sm uppercase tracking-wide text-section">{section.name}</span>}
      {children}
    </li>
  );
}

function BookingRow({ booking, section, timeZone, upcoming }: { booking: MyBooking; section: Section | undefined; timeZone: string; upcoming: boolean }) {
  return (
    <RowShell section={section} faded={!upcoming}>
      <span className="font-semibold">{booking.resourceName}</span>
      <span>
        {formatNight(booking.startsAt, timeZone)}–{formatShortTime(booking.endsAt, timeZone)}
      </span>
      <span className="text-muted-foreground">{booking.pricePoisha > 0 ? formatBdt(booking.pricePoisha) : m.bookings.priceAtVenue}</span>
      <span className="rounded-full bg-raised px-2.5 py-0.5 text-xs font-semibold">{m.bookings.status[booking.status]}</span>
      {booking.paid && <span className="rounded-full bg-section px-2.5 py-0.5 text-xs font-semibold text-on-section">{m.bookings.paid}</span>}
      {upcoming && (
        <span className="ml-auto">
          {booking.paid ? (
            <span className="text-muted-foreground">{m.bookings.paidContact}</span>
          ) : booking.cancellable ? (
            <ActionButton action={cancelMyBookingAction.bind(null, booking.id)} label={m.bookings.cancel} />
          ) : (
            <span className="text-muted-foreground">{m.bookings.contactVenue}</span>
          )}
        </span>
      )}
    </RowShell>
  );
}

function SeatRow({ seat, section, timeZone }: { seat: MySeat; section: Section | undefined; timeZone: string }) {
  return (
    <RowShell section={section}>
      <Link href={`/sessions/${seat.sessionId}`} className="font-semibold hover:underline">
        {seat.activityName}
      </Link>
      <span>
        {formatNight(seat.startsAt, timeZone)}–{formatShortTime(seat.endsAt, timeZone)}
      </span>
      <span className="text-muted-foreground">
        {seat.resourceName}
        {seat.team !== null && ` · ${m.openPlay.team(seat.team)}`}
      </span>
      <span className="text-muted-foreground">{formatBdt(seat.pricePoisha)}</span>
      {seat.paid && <span className="rounded-full bg-section px-2.5 py-0.5 text-xs font-semibold text-on-section">{m.bookings.paid}</span>}
      <span className="ml-auto">
        {seat.paid ? (
          <span className="text-muted-foreground">{m.bookings.paidContact}</span>
        ) : seat.cancellable ? (
          <ActionButton action={cancelSeatAction.bind(null, seat.bookingId)} label={m.bookings.cancel} />
        ) : (
          <span className="text-muted-foreground">{m.bookings.contactVenue}</span>
        )}
      </span>
    </RowShell>
  );
}

function List({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-2xl uppercase tracking-wide">{title}</h2>
      {children.length === 0 ? <p className="text-muted-foreground">{empty}</p> : <ul className="flex flex-col gap-2">{children}</ul>}
    </section>
  );
}

async function MyBookings() {
  await requireUser("/me/bookings");
  const player = await getSitePlayer();
  if (!player) return null;
  if (!player.profileId) {
    return (
      <div className="flex flex-col gap-6">
        <MeTabs active="bookings" />
        <div className="flex max-w-xl flex-col gap-4 rounded-xl bg-card p-6">
          <p>{m.bookings.createProfileFirst}</p>
          <Link href="/me" className={cn(buttonVariants({ size: "lg" }), "self-start px-4")}>
            {m.bookings.createProfile}
          </Link>
        </div>
      </div>
    );
  }
  const { brand, profileId } = player;
  const db = createServiceClient();
  const [{ upcoming, past }, seats] = await Promise.all([
    listMyBookings(db, { organizationId: brand.id, profileId }),
    listMySeats(db, { organizationId: brand.id, profileId }),
  ]);
  const sectionOf = (id: string) => brand.sections.find((s) => s.id === id);
  const tz = brand.timezone;

  return (
    <div className="flex flex-col gap-8">
      <MeTabs active="bookings" />
      <h1 className="font-display text-4xl uppercase tracking-wide sm:text-5xl">{m.bookings.mine}</h1>
      <List title={m.openPlay.mySeats} empty={m.openPlay.noSeats}>
        {seats.upcoming.map((seat) => (
          <SeatRow key={seat.bookingId} seat={seat} section={sectionOf(seat.sectionId)} timeZone={tz} />
        ))}
      </List>
      <List title={m.bookings.upcoming} empty={m.bookings.noneUpcoming}>
        {upcoming.map((b) => (
          <BookingRow key={b.id} booking={b} section={sectionOf(b.sectionId)} timeZone={tz} upcoming />
        ))}
      </List>
      <List title={m.bookings.past} empty={m.bookings.nonePast}>
        {past.map((b) => (
          <BookingRow key={b.id} booking={b} section={sectionOf(b.sectionId)} timeZone={tz} upcoming={false} />
        ))}
      </List>
    </div>
  );
}

export default function MyBookingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Suspense fallback={null}>
        <MyBookings />
      </Suspense>
    </main>
  );
}
