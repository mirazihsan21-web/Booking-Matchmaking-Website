import Link from "next/link";
import { Suspense } from "react";
import { SlotPicker } from "@/components/bookings/slot-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/dal";
import { spaceDay } from "@/lib/bookings/bookings";
import { addDays, currentBusinessDate, parseDateParam } from "@/lib/bookings/slots";
import { formatDay, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import type { OpeningHours } from "@/lib/opening-hours";
import { createServiceClient } from "@/lib/service-client";
import { getPlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { bookSpaceAction } from "./actions";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Book({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  await requireUser("/book");
  const player = await getPlayer(slug);
  if (!player) return null;
  if (!player.profileId) {
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{m.bookings.title}</CardTitle>
          <CardDescription>{m.bookings.createProfileFirst}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/me" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            {m.bookings.createProfile}
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { org } = player;
  const db = createServiceClient();
  const [{ data: rules }, { data: allSpaces }, { data: allBranches }] = await Promise.all([
    db.from("organizations").select("booking_horizon_days").eq("id", org.id).single(),
    db.from("resources").select("id, name, slot_minutes, price_per_hour_poisha, branch_id").eq("organization_id", org.id).eq("active", true).order("name"),
    db.from("branches").select("id, name, opening_hours").eq("organization_id", org.id).order("created_at"),
  ]);
  const branches = (allBranches ?? []).filter((b) => (allSpaces ?? []).some((s) => s.branch_id === b.id));
  if (branches.length === 0) return <p className="text-foreground/60">{m.bookings.unavailable}</p>;

  // Branch first (when there are several), then a space there. Junk or foreign ?branch=/?resource=
  // and junk or out-of-window ?date= fall back to the first branch, its first space, and today.
  const askedSpace = (allSpaces ?? []).find((s) => s.id === one(query.resource));
  const branch = branches.find((b) => b.id === one(query.branch)) ?? branches.find((b) => b.id === askedSpace?.branch_id) ?? branches[0]!;
  const spaces = (allSpaces ?? []).filter((s) => s.branch_id === branch.id);
  const space = spaces.find((s) => s.id === askedSpace?.id) ?? spaces[0]!;
  // After midnight at a late-night venue, "today" is still last night's business day.
  const today = currentBusinessDate(branch.opening_hours as OpeningHours, new Date(), org.timezone);
  const lastDay = addDays(today, rules?.booking_horizon_days ?? 14);
  const asked = parseDateParam(one(query.date), today);
  const date = asked < today || asked > lastDay ? today : asked;
  const day = await spaceDay(db, { organizationId: org.id, resourceId: space.id, date, withNames: false });

  const link = (d: string) => `/book?branch=${branch.id}&resource=${space.id}&date=${d}`;
  const price = space.price_per_hour_poisha === null ? m.bookings.priceAtVenue : m.bookings.perSlot(formatBdt(Math.round((space.price_per_hour_poisha * space.slot_minutes) / 60)));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{m.bookings.title}</h1>
        <p className="text-foreground/70">{m.bookings.intro}</p>
      </div>
      <form action="/book" method="get" className="flex flex-wrap items-end gap-3">
        {branches.length > 1 && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {m.bookings.branch}
            <select name="branch" defaultValue={branch.id} className="h-9 rounded-lg border border-input bg-transparent px-2">
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {m.bookings.space}
          <select name="resource" defaultValue={space.id} className="h-9 rounded-lg border border-input bg-transparent px-2">
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {m.bookings.day}
          <input type="date" name="date" defaultValue={date} min={today} max={lastDay} className="h-9 rounded-lg border border-input bg-transparent px-2" />
        </label>
        <button type="submit" className="h-9 rounded-lg border border-border px-4 text-sm hover:bg-foreground/5">
          {m.bookings.show}
        </button>
      </form>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          {date > today ? <Link href={link(addDays(date, -1))} className="text-sm hover:underline">{m.bookings.previousDay}</Link> : <span />}
          <h2 className="text-lg font-semibold">
            {space.name}
            {branches.length > 1 && ` (${branch.name})`} · {formatDay(date)}
          </h2>
          {date < lastDay ? <Link href={link(addDays(date, 1))} className="text-sm hover:underline">{m.bookings.nextDay}</Link> : <span />}
        </div>
        <SlotPicker
          key={`${space.id}-${date}`}
          action={bookSpaceAction.bind(null, org.slug, space.id)}
          slotMinutes={space.slot_minutes}
          priceLabel={price}
          slots={(day?.slots ?? []).map((s) => ({
            start: s.start.toISOString(),
            label: `${formatShortTime(s.start.toISOString(), org.timezone)}–${formatShortTime(s.end.toISOString(), org.timezone)}`,
            state: s.state,
          }))}
        />
      </section>
    </div>
  );
}

export default function BookPage({ params, searchParams }: PageProps<"/t/[slug]/book">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <Suspense fallback={null}>
        <Book params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
