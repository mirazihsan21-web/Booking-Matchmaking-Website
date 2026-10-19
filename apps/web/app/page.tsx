import { getSkin } from "@/skins";

const skin = getSkin("boardgame");

export default function Home() {
  const { brand, labels, catalogue } = skin;
  const seats = catalogue.tables.reduce((sum, t) => sum + t.capacity, 0);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="flex max-w-2xl flex-col items-center gap-6 text-center">
        <span className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">
          Live demo coming soon
        </span>
        <h1 className="text-5xl font-semibold tracking-tight text-primary">{brand.name}</h1>
        <p className="text-xl text-foreground/80">{brand.tagline}</p>
        <p className="text-base text-foreground/60">
          {catalogue.games.length} {labels.activityPlural} · {catalogue.tables.length} {labels.resourcePlural} ·{" "}
          {seats} seats · {catalogue.nights.length} {labels.sessionPlural} a week
        </p>
      </div>
    </main>
  );
}
