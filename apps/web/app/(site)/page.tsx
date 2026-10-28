import { Suspense } from "react";
import { AutoRefresh } from "@/components/site/auto-refresh";
import { GameCard } from "@/components/site/game-card";
import { Hero } from "@/components/site/landing/hero";
import { HoursAndLocation } from "@/components/site/landing/hours-and-location";
import { HowItWorks } from "@/components/site/landing/how-it-works";
import { ServiceRow } from "@/components/site/landing/service-row";
import { WhyPlayHere } from "@/components/site/landing/why-play-here";
import { localDayAndMinutes } from "@/lib/schedule/time";
import { createServiceClient } from "@/lib/service-client";
import { loadComingUp, loadSectionFacts } from "@/lib/site/home";
import { statusNow } from "@/lib/site/hours";
import { getBrand } from "@/lib/tenancy/brand";
import { m } from "@/messages";

const NO_FACTS = { spaces: 0, fromPoisha: null, games: [] };

/** The brand's landing page: hero, services, how it works, games coming up, why play here, hours and location. */
async function Home() {
  const brand = await getBrand();
  if (!brand) return null; // the layout shows "Not open yet"
  const now = new Date();
  const db = createServiceClient();
  const [games, facts] = await Promise.all([loadComingUp(db, { organizationId: brand.id, now }), loadSectionFacts(db, brand.id)]);
  const sectionOf = new Map(brand.sections.map((s) => [s.id, s]));

  return (
    <>
      <Hero brandName={brand.name} sections={brand.sections} status={statusNow(brand.sections.map((s) => s.openingHours), brand.timezone, now)} />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-24 px-4 py-16 sm:px-6 sm:py-24">
        <section id="services" className="flex scroll-mt-20 flex-col gap-14">
          <h2 className="font-display text-4xl uppercase tracking-wide">{m.site.landing.servicesTitle}</h2>
          {brand.sections.map((s, i) => (
            <ServiceRow
              key={s.id}
              section={s}
              facts={facts.get(s.id) ?? NO_FACTS}
              status={statusNow([s.openingHours], brand.timezone, now)}
              hasGames={games.some((g) => g.sectionId === s.id)}
              flip={i % 2 === 1}
            />
          ))}
        </section>

        <HowItWorks />

        <section id="coming-up" className="flex scroll-mt-20 flex-col gap-6">
          <h2 className="font-display text-4xl uppercase tracking-wide">{m.site.comingUp}</h2>
          {games.length === 0 ? (
            <p className="text-muted-foreground">{m.site.nothingComingUp}</p>
          ) : (
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
              {games.map((g, i) => {
                const section = sectionOf.get(g.sectionId);
                return (
                  <GameCard
                    key={g.id}
                    game={g}
                    sectionName={section?.name ?? ""}
                    accent={section?.accent ?? "#43a66b"}
                    timeZone={brand.timezone}
                    index={i}
                    className="w-64 shrink-0 snap-start"
                  />
                );
              })}
            </div>
          )}
        </section>

        <WhyPlayHere />

        <HoursAndLocation sections={brand.sections} address={brand.address} today={localDayAndMinutes(now, brand.timezone).weekday} />
        <AutoRefresh />
      </main>
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}
