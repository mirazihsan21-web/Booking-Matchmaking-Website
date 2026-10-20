import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/dal";
import { listMyBookings, type MyBooking } from "@/lib/bookings/bookings";
import { formatNight, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { createServiceClient } from "@/lib/service-client";
import { getPlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { cancelMyBookingAction } from "./actions";

function Row({ booking, slug, timeZone, upcoming }: { booking: MyBooking; slug: string; timeZone: string; upcoming: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-4 py-3 text-sm">
      <span className="font-medium">{booking.resourceName}</span>
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
  const { upcoming, past } = await listMyBookings(createServiceClient(), { organizationId: player.org.id, profileId: player.profileId });
  const tz = player.org.timezone;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">{m.bookings.mine}</h1>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{m.bookings.upcoming}</h2>
        {upcoming.length === 0 ? (
          <p className="text-foreground/60">{m.bookings.noneUpcoming}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((b) => (
              <Row key={b.id} booking={b} slug={slug} timeZone={tz} upcoming />
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
              <Row key={b.id} booking={b} slug={slug} timeZone={tz} upcoming={false} />
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
