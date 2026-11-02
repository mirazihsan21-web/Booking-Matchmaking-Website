import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { cn } from "cn";
import { Avatar } from "@/components/account/avatar";
import { MeTabs } from "@/components/site/me-tabs";
import { sectionStyle } from "@/components/site/section-style";
import { buttonVariants } from "@/components/ui/button";
import { listMyBookings } from "@/lib/bookings/bookings";
import { formatNight } from "@/lib/format";
import { displayPhone } from "@/lib/forms/profile";
import { listMySeats } from "@/lib/open-play/open-play";
import { availabilityLine, summariseProfile } from "@/lib/profiles/summary";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requirePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

/** A titled card on the profile. */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card p-5 sm:p-6">
      <h2 className="font-display text-2xl uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

/** The player's profile at the brand, to read: who they are, their levels and their play. Editing is /me/edit. */
async function Profile({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const player = await requirePlayer("/me");
  if (!player) return null; // the layout shows "Not open yet"
  const { user, brand } = player;
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("player_profiles")
    .select("id, display_name, phone, email_opt_in, created_at, profile_activities(rank, activities(name)), availability(weekday, start_time, end_time), profile_section_skills(section_id, skill)")
    .eq("organization_id", brand.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/me/edit");

  const db = createServiceClient();
  const [bookings, seats, query] = await Promise.all([
    listMyBookings(db, { organizationId: brand.id, profileId: profile.id }),
    // Every past seat, not My bookings' recent 20: "Games played" counts them all.
    listMySeats(db, { organizationId: brand.id, profileId: profile.id, pastLimit: null }),
    searchParams,
  ]);
  const summary = summariseProfile([...bookings.upcoming, ...bookings.past], [...seats.upcoming, ...seats.past], new Date());
  const ratings = new Map(((profile.profile_section_skills as Array<{ section_id: string; skill: number }> | null) ?? []).map((r) => [r.section_id, r.skill]));
  const favourites = [...((profile.profile_activities as unknown as Array<{ rank: number; activities: { name: string } | null }> | null) ?? [])]
    .sort((a, b) => a.rank - b.rank)
    .map((f) => f.activities?.name)
    .filter((n): n is string => Boolean(n));
  const usually = availabilityLine(
    ((profile.availability as Array<{ weekday: number; start_time: string; end_time: string }> | null) ?? []).map((a) => ({ weekday: a.weekday, start: a.start_time, end: a.end_time })),
  );
  const since = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: brand.timezone }).format(new Date(profile.created_at as string));
  const nextSection = summary.nextUp ? brand.sections.find((s) => s.id === summary.nextUp!.sectionId) : undefined;
  const p = m.profile;

  return (
    <div className="flex flex-col gap-6">
      <MeTabs active="profile" />
      {query.saved === "1" && (
        <p role="status" className="rounded-lg bg-card px-4 py-2 text-sm font-semibold">
          {p.saved}
        </p>
      )}

      <section className="rise flex flex-wrap items-center gap-4 rounded-xl bg-card p-5 sm:p-6">
        <Avatar name={profile.display_name as string} src={user.avatarUrl} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="font-display text-3xl uppercase tracking-wide sm:text-4xl">{profile.display_name as string}</h1>
          <p className="truncate text-sm">{user.email}</p>
          <p className="text-sm text-muted-foreground">{profile.phone ? displayPhone(profile.phone as string) : p.noPhone}</p>
          <p className="text-sm text-muted-foreground">{p.since(since)}</p>
        </div>
        <Link href="/me/edit" className={cn(buttonVariants({ variant: "outline" }), "press")}>
          {p.editProfile}
        </Link>
      </section>

      <Card title={p.levels}>
        <ul className="flex flex-col gap-2">
          {brand.sections.map((s) => {
            const level = ratings.get(s.id);
            return (
              <li key={s.id} style={sectionStyle(s.accent)} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full border border-section px-2.5 py-0.5 font-semibold text-section">
                  {s.name}
                  {level ? ` · ${level} ${p.skillLevels[level]}` : ""}
                </span>
                {!level && <span className="text-muted-foreground">{p.notRatedLine}</span>}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={p.play}>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-muted-foreground">{p.gamesPlayed}</dt>
            <dd className="font-display text-3xl">{summary.gamesPlayed}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{p.spacesBooked}</dt>
            <dd className="font-display text-3xl">{summary.spacesBooked}</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{p.nextUp}</p>
          {summary.nextUp ? (
            <Link href="/me/bookings" style={nextSection ? sectionStyle(nextSection.accent) : undefined} className="self-start font-semibold hover:underline">
              {nextSection && <span className="text-section">{nextSection.name} · </span>}
              {summary.nextUp.title} · {formatNight(summary.nextUp.startsAt, brand.timezone)}
            </Link>
          ) : (
            <p>
              {p.nothingBooked}{" "}
              <Link href="/" className="font-semibold underline underline-offset-4">
                {p.findGame}
              </Link>
            </p>
          )}
        </div>
      </Card>

      <section className="flex flex-col gap-2 rounded-xl bg-card p-5 text-sm sm:p-6">
        {favourites.length > 0 && (
          <p>
            <span className="text-muted-foreground">{p.favouritesLabel}: </span>
            {favourites.join(", ")}
          </p>
        )}
        {usually && (
          <p>
            <span className="text-muted-foreground">{p.usuallyPlays}: </span>
            {usually}
          </p>
        )}
        <p>{p.emails(Boolean(profile.email_opt_in))}</p>
      </section>
    </div>
  );
}

export default function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Suspense fallback={null}>
        <Profile searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
