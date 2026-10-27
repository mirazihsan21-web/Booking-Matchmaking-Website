import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cn } from "cn";
import { AutoRefresh } from "@/components/site/auto-refresh";
import { GameCard } from "@/components/site/game-card";
import { SectionHeader } from "@/components/site/section-header";
import { sectionStyle } from "@/components/site/section-style";
import { buttonVariants } from "@/components/ui/button";
import { localDayAndMinutes } from "@/lib/schedule/time";
import { WEEKDAYS } from "@/lib/opening-hours";
import { createServiceClient } from "@/lib/service-client";
import { findSection, loadComingUp } from "@/lib/site/home";
import { clockLabel, statusNow } from "@/lib/site/hours";
import { kindWords } from "@/lib/site/kinds";
import { bookPath } from "@/lib/site/paths";
import { getBrand } from "@/lib/tenancy/brand";
import { m } from "@/messages";

async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: slug } = await params;
  const brand = await getBrand();
  if (!brand) return null; // the layout shows "Not open yet"
  const section = findSection(brand.sections, slug);
  if (!section) notFound();

  const db = createServiceClient();
  const now = new Date();
  const [games, { data: activities }] = await Promise.all([
    loadComingUp(db, { organizationId: brand.id, now }),
    db
      .from("activities")
      .select("id, name, min_players, max_players, team_mode, team_size")
      .eq("section_id", section.id)
      .eq("active", true)
      .order("popularity", { ascending: false })
      .order("name"),
  ]);
  const mine = games.filter((g) => g.sectionId === section.id);
  const words = kindWords(section.kind);
  const today = localDayAndMinutes(now, brand.timezone).weekday;

  return (
    <>
      <SectionHeader section={section} status={statusNow([section.openingHours], brand.timezone, now)}>
        <Link href={bookPath(section.slug)} className={cn(buttonVariants({ variant: "section", size: "lg" }), "press px-5")}>
          {m.site.bookSpace}
        </Link>
      </SectionHeader>

      <main style={sectionStyle(section.accent)} className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-3xl uppercase tracking-wide">{words.games}</h2>
          {mine.length === 0 ? (
            <p className="text-muted-foreground">{words.noGames}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mine.map((g, i) => (
                <GameCard key={g.id} game={g} sectionName={section.name} accent={section.accent} timeZone={brand.timezone} index={i} />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="font-display text-3xl uppercase tracking-wide">{m.site.whatYouCanPlay}</h2>
          <ul className="flex flex-wrap gap-2">
            {(activities ?? []).map((a) => (
              <li key={a.id} className="rounded-full bg-card px-3 py-1.5 text-sm">
                <span className="font-semibold">{a.name}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {a.team_mode === "two_teams" && a.team_size ? m.manage.versus(a.team_size) : m.manage.players(a.min_players, a.max_players)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="font-display text-3xl uppercase tracking-wide">{m.site.hoursThisWeek}</h2>
          <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            {WEEKDAYS.map((d) => {
              const hours = section.openingHours[d];
              const isToday = Number(d) === today;
              return (
                <div key={d} className={cn("contents", isToday && "font-semibold text-section")}>
                  <dt>{m.weekdays[Number(d)]}</dt>
                  <dd className={cn(!isToday && "text-muted-foreground")}>{hours ? `${clockLabel(hours[0])} – ${clockLabel(hours[1])}` : m.manage.closed}</dd>
                </div>
              );
            })}
          </dl>
        </section>
        <AutoRefresh />
      </main>
    </>
  );
}

export default function SectionRoute({ params }: PageProps<"/[section]">) {
  return (
    <Suspense fallback={null}>
      <SectionPage params={params} />
    </Suspense>
  );
}
