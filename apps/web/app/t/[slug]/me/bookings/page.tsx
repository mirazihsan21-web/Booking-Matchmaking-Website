import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/dal";
import { listMyBookings, type MyBooking } from "@/lib/bookings/bookings";
import { formatNight, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { listMySeats, type MySeat } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getPlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { cancelMyBookingAction, cancelSeatAction } from "./actions";

function Row({ booking, slug, timeZone, upcoming, showBranch }: { booking: MyBooking; slug: string; timeZone: string; upcoming: boolean; showBranch: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-4 py-3 text-sm">
      <span className="font-medium">
        {booking.resourceName}
        {showBranch && <span className="font-normal text-foreground/70"> · {booking.branchName}</span>}
      </span>
      <span>
        {formatNight(booking.startsAt, timeZone)}–{formatShortTime(booking.endsAt, timeZone)}
      </span>
      <span className="text-foreground/70">{booking.pricePoisha > 0 ? formatBdt(booking.pricePoisha) : m.bookings.priceAtVenue}</span>
      <Badge variant={booking.status === "confirmed" ? "default" : "secondary"}>{m.bookings.status[booking.status]}</Badge>
      {upcoming && (
        <span className="ml-auto">
          {booking.cancellable ? (
            <ActionButton action={cancelMyBookingAction.bind(null, slug, booking.id)} label={m.bookings.cancel} variant="outline" />
          ) : (
            <span className="text-foreground/60">{m.bookings.contactVenue}</span>
          )}
        </span>
      )}
    </li>
  );
}

function SeatRow({ seat, slug, timeZone }: { seat: MySeat; slug: string; timeZone: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-4 py-3 text-sm">
      <Link href={`/sessions/${seat.sessionId}`} className="font-medium hover:underline">
        {seat.activityName}
      </Link>
      <span>
        {formatNight(seat.startsAt, timeZone)}–{formatShortTime(seat.endsAt, timeZone)}
      </span>
      <span className="text-foreground/70">
        {seat.resourceName}
        {seat.team !== null && ` · ${m.openPlay.team(seat.team)}`}
      </span>
      <span className="text-foreground/70">{formatBdt(seat.pricePoisha)}</span>
      <span className="ml-auto">
        {seat.cancellable ? (
          <ActionButton action={cancelSeatAction.bind(null, slug, seat.bookingId)} label={m.bookings.cancel} variant="outline" />
        ) : (
          <span className="text-foreground/60">{m.bookings.contactVenue}</span>
        )}
      </span>
    </li>
  );
}

async function MyBookings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireUser("/me/bookings");
  const player = await getPlayer(slug);
  if (!player) return null;
  if (!player.profileId) {
    return (
      <p>
        {m.bookings.createProfileFirst}{" "}
        <Link href="/me" className="text-primary hover:underline">
          {m.bookings.createProfile}
        </Link>
      </p>
    );
  }
  const db = createServiceClient();
  const [{ upcoming, past }, seats, { count: branchCount }] = await Promise.all([
    listMyBookings(db, { organizationId: player.org.id, profileId: player.profileId }),
    listMySeats(db, { organizationId: player.org.id, profileId: player.profileId }),
    db.from("branches").select("id", { count: "exact", head: true }).eq("organization_id", player.org.id),
  ]);
  const showBranch = (branchCount ?? 0) > 1;
  const tz = player.org.timezone;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">{m.bookings.mine}</h1>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{m.openPlay.mySeats}</h2>
        {seats.upcoming.length === 0 ? (
          <p className="text-foreground/60">{m.openPlay.noSeats}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {seats.upcoming.map((seat) => (
              <SeatRow key={seat.bookingId} seat={seat} slug={slug} timeZone={tz} />
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{m.bookings.upcoming}</h2>
        {upcoming.length === 0 ? (
          <p className="text-foreground/60">{m.bookings.noneUpcoming}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((b) => (
              <Row key={b.id} booking={b} slug={slug} timeZone={tz} upcoming showBranch={showBranch} />
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{m.bookings.past}</h2>
        {past.length === 0 ? (
          <p className="text-foreground/60">{m.bookings.nonePast}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {past.map((b) => (
              <Row key={b.id} booking={b} slug={slug} timeZone={tz} upcoming={false} showBranch={showBranch} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function MyBookingsPage({ params }: PageProps<"/t/[slug]/me/bookings">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <Suspense fallback={null}>
        <MyBookings params={params} />
      </Suspense>
    </main>
  );
}
