import { MapPin } from "lucide-react";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/site/auto-refresh";
import { GameCard } from "@/components/site/game-card";
import { SectionCard } from "@/components/site/section-card";
import { StatusPill } from "@/components/site/status-pill";
import { createServiceClient } from "@/lib/service-client";
import { loadComingUp } from "@/lib/site/home";
import { statusNow } from "@/lib/site/hours";
import { getBrand } from "@/lib/tenancy/brand";
import { m } from "@/messages";

async function Home() {
  const brand = await getBrand();
  if (!brand) return null; // the layout shows "Not open yet"
  const now = new Date();
  const games = await loadComingUp(createServiceClient(), { organizationId: brand.id, now });
  const sectionOf = new Map(brand.sections.map((s) => [s.id, s]));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-8 sm:px-6 sm:py-12">
      <section className="rise flex flex-col gap-3">
        <StatusPill status={statusNow(brand.sections.map((s) => s.openingHours), brand.timezone, now)} className="self-start" />
        <h1 className="font-display text-6xl uppercase leading-[0.9] tracking-wide sm:text-8xl">{brand.name}</h1>
        <p className="text-muted-foreground">{brand.sections.map((s) => s.name).join(" · ")}</p>
        {brand.address && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin aria-hidden className="size-4" />
            {brand.address}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-3xl uppercase tracking-wide">{m.site.comingUp}</h2>
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

      <section className="grid gap-4 md:grid-cols-3">
        {brand.sections.map((s, i) => (
          <SectionCard
            key={s.id}
            section={s}
            status={statusNow([s.openingHours], brand.timezone, now)}
            next={games.find((g) => g.sectionId === s.id) ?? null}
            timeZone={brand.timezone}
            index={i + 1}
          />
        ))}
      </section>
      <AutoRefresh />
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}
