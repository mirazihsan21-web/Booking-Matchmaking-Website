import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton, ActionForm, Field, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { sectionDay, type SlotBooking, type SpaceDay } from "@/lib/bookings/bookings";
import { addDays, currentBusinessDate, parseDateParam } from "@/lib/bookings/slots";
import { formatDay, formatShortTime } from "@/lib/format";
import { loadSections } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { cn } from "@/lib/utils";
import { m } from "@/messages";
import { setBookingStatusAction, staffCancelBookingAction, walkInAction } from "./actions";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const slotOptions = [1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }));

/** Who booked, and what staff can do with it: attendance once it has started, cancel until it ends. */
function BookingDetails({ booking, slug, now }: { booking: SlotBooking; slug: string; now: Date }) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-2">
        {booking.name}
        {booking.phone && <span className="text-foreground/70">{booking.phone}</span>}
        {booking.phone && <Badge variant="outline">{m.staffBookings.walkInBadge}</Badge>}
        <Badge variant={booking.status === "confirmed" ? "default" : "secondary"}>{m.bookings.status[booking.status]}</Badge>
      </span>
      {booking.status === "confirmed" && (
        <span className="flex flex-wrap gap-1.5">
          {booking.start <= now && (
            <>
              <ActionButton action={setBookingStatusAction.bind(null, slug, booking.id, "attended")} label={m.staffBookings.attended} />
              <ActionButton action={setBookingStatusAction.bind(null, slug, booking.id, "no_show")} label={m.staffBookings.noShow} />
            </>
          )}
          {booking.end > now && <ActionButton action={staffCancelBookingAction.bind(null, slug, booking.id)} label={m.staffBookings.cancel} variant="destructive" />}
        </span>
      )}
    </>
  );
}

function SpaceColumn({ day, slug, timeZone, now }: { day: SpaceDay; slug: string; timeZone: string; now: Date }) {
  const time = (start: Date, end: Date) => `${formatShortTime(start.toISOString(), timeZone)}–${formatShortTime(end.toISOString(), timeZone)}`;
  const seen = new Set<string>();
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="flex items-center gap-2 font-semibold">
        {day.resource.name}
        {!day.resource.active && <Badge variant="secondary">{m.staffBookings.inactive}</Badge>}
      </h3>
      {day.slots.length === 0 && <p className="text-sm text-foreground/60">{m.staffBookings.closed}</p>}
      {day.slots.map((slot) => {
        const bookings = slot.bookings ?? [];
        const inProgress = slot.start <= now && now < slot.end;
        const canWalkIn = bookings.length === 0 && (slot.state === "free" || (slot.state === "past" && inProgress));
        return (
          <div
            key={slot.start.toISOString()}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2 text-sm",
              bookings.length > 0 && "border-primary/40 bg-primary/5",
              slot.state === "open_play" && "bg-accent/20",
              slot.state === "past" && !canWalkIn && bookings.length === 0 && "text-foreground/40",
            )}
          >
            <span className="font-medium">{time(slot.start, slot.end)}</span>
            {bookings.map((booking) => {
              const first = !seen.has(booking.id);
              seen.add(booking.id);
              return first ? (
                <BookingDetails key={booking.id} booking={booking} slug={slug} now={now} />
              ) : (
                <span key={booking.id} className="text-foreground/60">
                  {booking.name} ({m.staffBookings.continued})
                </span>
              );
            })}
            {bookings.length === 0 && slot.state === "open_play" && <span className="text-foreground/70">{m.staffBookings.openPlay}</span>}
            {canWalkIn && (
              <details>
                <summary className="cursor-pointer text-primary">{m.staffBookings.walkIn}</summary>
                <ActionForm action={walkInAction.bind(null, slug, day.resource.id, slot.start.toISOString())} submitLabel={m.staffBookings.add} className="mt-2">
                  <Field name="guestName" label={m.staffBookings.guestName} required maxLength={60} />
                  <Field name="guestPhone" label={m.staffBookings.guestPhone} type="tel" placeholder="01712345678" required />
                  <SelectField name="slots" label={m.staffBookings.howLong} options={slotOptions} defaultValue="1" />
                </ActionForm>
              </details>
            )}
            {bookings.length === 0 && slot.state === "past" && !canWalkIn && <span>{m.staffBookings.started}</span>}
          </div>
        );
      })}
      {(day.extra?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">{m.staffBookings.offGrid}</span>
          {day.extra!.map((booking) => (
            <div key={booking.id} className="flex flex-col gap-1.5">
              <span className="font-medium">{time(booking.start, booking.end)}</span>
              <BookingDetails booking={booking} slug={slug} now={now} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

async function Bookings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  const { org } = await requireOrgRole(slug, "staff");
  const supabase = await createClient();
  const sections = await loadSections(supabase, org.id);
  if (sections.length === 0) notFound();

  const asked = one(query.section);
  const section = asked === undefined ? sections[0]! : sections.find((s) => s.id === asked);
  if (!section) notFound();
  const now = new Date();
  // After midnight at a late-night venue, "today" is still last night's business day.
  const today = currentBusinessDate(section.openingHours, now, org.timezone);
  const date = parseDateParam(one(query.date), today);
  const days = await sectionDay(createServiceClient(), { organizationId: org.id, sectionId: section.id, date, now });
  if (!days) notFound();
  const link = (d: string) => `/manage/${org.slug}/bookings?section=${section.id}&date=${d}`;

  return (
    <div className="flex flex-col gap-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        {sections.length > 1 && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {m.staffBookings.section}
            <select name="section" defaultValue={section.id} className="h-9 rounded-lg border border-input bg-transparent px-2">
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {sections.length === 1 && <input type="hidden" name="section" value={section.id} />}
        <input type="date" name="date" defaultValue={date} aria-label={m.bookings.day} className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm" />
        <button type="submit" className="h-9 rounded-lg border border-border px-4 text-sm hover:bg-foreground/5">
          {m.staffBookings.show}
        </button>
      </form>
      <div className="flex items-center justify-between gap-3">
        <Link href={link(addDays(date, -1))} className="text-sm hover:underline">
          {m.staffBookings.previousDay}
        </Link>
        <h2 className="text-lg font-semibold">
          {section.name} · {formatDay(date)}
        </h2>
        <Link href={link(addDays(date, 1))} className="text-sm hover:underline">
          {m.staffBookings.nextDay}
        </Link>
      </div>
      {days.length === 0 ? (
        <p className="text-foreground/60">{m.staffBookings.noSpaces}</p>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {days.map((day) => (
            <SpaceColumn key={day.resource.id} day={day} slug={org.slug} timeZone={org.timezone} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BookingsPage({ params, searchParams }: PageProps<"/manage/[slug]/bookings">) {
  return (
    <Suspense fallback={null}>
      <Bookings params={params} searchParams={searchParams} />
    </Suspense>
  );
}
