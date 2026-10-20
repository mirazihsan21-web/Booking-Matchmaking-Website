import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNight } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import type { OpeningHours, Weekday } from "@/lib/opening-hours";
import { createClient } from "@/lib/supabase/server";
import { getLiveOrganization } from "@/lib/tenancy/org";
import { logoUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todaysHours(hours: OpeningHours, timeZone: string): string {
  const today = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(new Date());
  const window = hours[String(DAYS.indexOf(today)) as Weekday];
  return window ? m.tenant.todayHours(`${window[0]}–${window[1]}`) : m.tenant.closedToday;
}

async function VenueHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getLiveOrganization(slug);
  if (!org) return null; // the layout already shows "not available"
  const supabase = await createClient();
  const now = new Date();
  const fortnight = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const [{ data: branches }, { data: activities }, { data: sessions }] = await Promise.all([
    supabase.from("branches").select("id, name, address, opening_hours").eq("organization_id", org.id).order("created_at"),
    supabase.from("activities").select("id, name, team_mode, team_size, min_players, max_players").eq("organization_id", org.id).eq("active", true).order("name"),
    supabase
      .from("open_play_sessions")
      .select("id, starts_at, seat_price_poisha, activities(name)")
      .eq("organization_id", org.id)
      .eq("status", "open")
      .gte("starts_at", now.toISOString())
      .lt("starts_at", fortnight.toISOString())
      .order("starts_at"),
  ]);
  const logo = logoUrl(org.branding.logo_path);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- venue logos are user uploads on Supabase Storage */}
        {logo && <img src={logo} alt="" className="h-14 w-14 rounded-xl object-contain" />}
        <h1 className="text-4xl font-semibold text-primary">{org.name}</h1>
        <nav className="ml-auto flex gap-3 text-sm">
          <Link href="/me" className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90">
            {m.tenant.myProfile}
          </Link>
        </nav>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{m.tenant.upcoming}</h2>
        {(sessions ?? []).length === 0 ? (
          <p className="text-foreground/60">{m.tenant.nothingUpcoming}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions!.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3">
                <span className="w-40 font-medium">{formatNight(s.starts_at, org.timezone)}</span>
                <span>{(s.activities as unknown as { name: string } | null)?.name ?? m.tenant.anyActivity}</span>
                <Badge variant="secondary" className="ml-auto">
                  {formatBdt(s.seat_price_poisha)} {m.tenant.perSeat}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{m.tenant.whatWePlay}</h2>
        <div className="flex flex-wrap gap-2">
          {(activities ?? []).map((a) => (
            <Badge key={a.id} variant="outline" className="px-3 py-1 text-sm">
              {a.name} · {a.team_mode === "two_teams" ? m.manage.versus(a.team_size!) : m.manage.players(a.min_players, a.max_players)}
            </Badge>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {(branches ?? []).map((b) => (
          <Card key={b.id}>
            <CardHeader>
              <CardTitle>{b.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm text-foreground/70">
              {b.address && <span>{b.address}</span>}
              <span>{todaysHours(b.opening_hours as OpeningHours, org.timezone)}</span>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}

export default function TenantHome({ params }: PageProps<"/t/[slug]">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={null}>
        <VenueHome params={params} />
      </Suspense>
    </main>
  );
}
