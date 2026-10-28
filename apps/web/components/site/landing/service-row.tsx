import { Banknote, LayoutGrid } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { formatBdt } from "@/lib/money";
import type { Section } from "@/lib/sections/sections";
import type { SectionFacts } from "@/lib/site/home";
import type { OpenStatus } from "@/lib/site/hours";
import { kindWords, sectionPhoto } from "@/lib/site/kinds";
import { bookPath, sectionPath } from "@/lib/site/paths";
import { m } from "@/messages";
import { sectionStyle } from "../section-style";
import { StatusPill } from "../status-pill";

/**
 * One service on the landing page: its photo, what it is, the facts that matter (price, spaces, today's
 * hours), what you can play, and its two actions in its own words. `flip` puts the photo on the right.
 */
export function ServiceRow({ section, facts, status, hasGames, flip }: { section: Section; facts: SectionFacts; status: OpenStatus; hasGames: boolean; flip: boolean }) {
  const words = kindWords(section.kind);
  const button = (primary: boolean) => cn(buttonVariants({ variant: primary ? "section" : "outline", size: "lg" }), "press h-10 px-4");
  return (
    <article style={sectionStyle(section.accent)} className="grid items-center gap-6 md:grid-cols-2 md:gap-12">
      <div className={cn("relative aspect-[16/10] overflow-hidden rounded-xl border-b-[3px] border-section", flip && "md:order-2")}>
        <Image src={sectionPhoto(section.kind)} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
      </div>
      <div className="flex flex-col gap-4">
        <h3 className="font-display text-4xl uppercase leading-none tracking-wide text-section sm:text-5xl">{section.name}</h3>
        <p className="max-w-prose text-foreground/85">{m.site.landing.blurb[section.kind]}</p>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex items-center gap-2">
            <Banknote aria-hidden className="size-4 text-section" />
            {facts.fromPoisha === null ? m.site.landing.priceAtVenue : m.site.landing.from(formatBdt(facts.fromPoisha))}
          </li>
          <li className="flex items-center gap-2">
            <LayoutGrid aria-hidden className="size-4 text-section" />
            {m.site.landing.spaces(facts.spaces)}
          </li>
          <li>
            <StatusPill status={status} />
          </li>
        </ul>
        {facts.games.length > 0 && (
          <ul aria-label={m.site.whatYouCanPlay} className="flex flex-wrap gap-2">
            {facts.games.map((g) => (
              <li key={g} className="rounded-full bg-card px-3 py-1 text-sm">
                {g}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {hasGames && (
            <Link href={sectionPath(section.slug)} className={button(true)}>
              {words.join}
            </Link>
          )}
          <Link href={bookPath(section.slug)} className={button(!hasGames)}>
            {words.book}
          </Link>
          {!hasGames && <span className="text-sm text-muted-foreground">{words.noGames}</span>}
        </div>
      </div>
    </article>
  );
}
