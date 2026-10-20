import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton, ActionForm, Field, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { branchDay, type SpaceDay } from "@/lib/bookings/bookings";
import { addDays, localDate, parseDateParam } from "@/lib/bookings/slots";
import { formatDay, formatShortTime } from "@/lib/format";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { cn } from "@/lib/utils";
import { m } from "@/messages";
import { setBookingStatusAction, staffCancelBookingAction, walkInAction } from "./actions";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const slotOptions = [1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }));

function SpaceColumn({ day, slug, timeZone }: { day: SpaceDay; slug: string; timeZone: string }) {
  const seen = new Set<string>();
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="font-semibold">{day.resource.name}</h3>
      {day.slots.length === 0 && <p className="text-sm text-foreground/60">{m.staffBookings.closed}</p>}
      {day.slots.map((slot) => {
        const time = `${formatShortTime(slot.start.toISOString(), timeZone)}–${formatShortTime(slot.end.toISOString(), timeZone)}`;
        const booking = slot.booking;
        const first = booking ? !seen.has(booking.id) : false;
        if (booking) seen.add(booking.id);
        return (
          <div
            key={slot.start.toISOString()}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2 text-sm",
              booking && "border-primary/40 bg-primary/5",
              slot.state === "open_play" && "bg-accent/20",
              slot.state === "past" && !booking && "text-foreground/40",
            )}
          >
            <span className="font-medium">{time}</span>
            {booking && first && (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  {booking.name}
                  {booking.phone && <span className="text-foreground/70">{booking.phone}</span>}
                  {booking.phone && <Badge variant="outline">{m.staffBookings.walkInBadge}</Badge>}
                  <Badge variant={booking.status === "confirmed" ? "default" : "secondary"}>{m.bookings.status[booking.status]}</Badge>
                </span>
                {booking.status === "confirmed" && (
                  <span className="flex flex-wrap gap-1.5">
                    <ActionButton action={setBookingStatusAction.bind(null, slug, booking.id, "attended")} label={m.staffBookings.attended} />
                    <ActionButton action={setBookingStatusAction.bind(null, slug, booking.id, "no_show")} label={m.staffBookings.noShow} />
                    <ActionButton action={staffCancelBookingAction.bind(null, slug, booking.id)} label={m.staffBookings.cancel} variant="destructive" />
                  </span>
                )}
              </>
            )}
            {booking && !first && <span className="text-foreground/60">{booking.name} ({m.staffBookings.continued})</span>}
            {!booking && slot.state === "open_play" && <span className="text-foreground/70">{m.staffBookings.openPlay}</span>}
            {!booking && slot.state === "free" && (
              <details>
                <summary className="cursor-pointer text-primary">{m.staffBookings.walkIn}</summary>
                <ActionForm action={walkInAction.bind(null, slug, day.resource.id, slot.start.toISOString())} submitLabel={m.staffBookings.add} className="mt-2">
                  <Field name="guestName" label={m.staffBookings.guestName} required maxLength={60} />
                  <Field name="guestPhone" label={m.staffBookings.guestPhone} type="tel" placeholder="01712345678" required />
                  <SelectField name="slots" label={m.staffBookings.howLong} options={slotOptions} defaultValue="1" />
                </ActionForm>
              </details>
            )}
            {!booking && slot.state === "past" && <span>{m.staffBookings.started}</span>}
          </div>
        );
      })}
    </section>
  );
}

async function Bookings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  const { org } = await requireOrgRole(slug, "staff");
  const supabase = await createClient();
  const { data: branches } = await supabase.from("branches").select("id, name").eq("organization_id", org.id).order("created_at");
  if (!branches || branches.length === 0) notFound();

  const asked = one(query.branch);
  const branch = asked === undefined ? branches[0]! : branches.find((b) => b.id === asked);
  if (!branch) notFound();
  const today = localDate(new Date(), org.timezone);
  const date = parseDateParam(one(query.date), today);
  const days = await branchDay(createServiceClient(), { organizationId: org.id, branchId: branch.id, date });
  if (!days) notFound();
  const link = (d: string) => `/manage/${org.slug}/bookings?branch=${branch.id}&date=${d}`;

  return (
    <div className="flex flex-col gap-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        {branches.length > 1 && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {m.staffBookings.branch}
            <select name="branch" defaultValue={branch.id} className="h-9 rounded-lg border border-input bg-transparent px-2">
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {branches.length === 1 && <input type="hidden" name="branch" value={branch.id} />}
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
          {branch.name} · {formatDay(date)}
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
            <SpaceColumn key={day.resource.id} day={day} slug={org.slug} timeZone={org.timezone} />
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
