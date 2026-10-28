import Image from "next/image";
import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import type { Section } from "@/lib/sections/sections";
import type { OpenStatus } from "@/lib/site/hours";
import { sectionPhotoUrl } from "@/lib/site/kinds";
import { sectionPath } from "@/lib/site/paths";
import { m } from "@/messages";
import { sectionStyle } from "../section-style";
import { StatusPill } from "../status-pill";

/**
 * The landing page's opening: the sections' photos side by side as one picture — each panel links to its
 * section and ends in its colour and name — with the brand, one line about it and the two main actions.
 */
export function Hero({ brandName, sections, status }: { brandName: string; sections: Section[]; status: OpenStatus }) {
  return (
    <section className="relative isolate flex min-h-[78svh] flex-col md:min-h-[84svh]">
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}>
        {sections.map((s) => (
          <Link
            key={s.id}
            href={sectionPath(s.slug)}
            style={sectionStyle(s.accent)}
            className="group relative flex flex-col justify-end overflow-hidden border-l border-background outline-none first:border-l-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-section"
          >
            <Image src={sectionPhotoUrl(s)} alt="" fill preload sizes="34vw" className="object-cover" />
            <span aria-hidden className="absolute inset-0 bg-gradient-to-b from-background/85 via-background/70 to-background/95 transition-colors group-hover:via-background/55" />
            {/* A fixed-height block, so the colour bars line up even when a name wraps to two lines. */}
            <span className="relative flex h-24 flex-col px-3 sm:h-28 sm:px-6">
              <span aria-hidden className="mb-2 block h-[3px] w-10 bg-section transition-[width] group-hover:w-20" />
              <span className="font-display text-lg uppercase leading-none tracking-wide sm:text-3xl">{s.name}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* The words sit over the panels without blocking them; only the buttons take clicks. */}
      <div className="rise pointer-events-none relative mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-5 px-4 pt-12 pb-32 sm:px-6 sm:pb-40">
        <StatusPill status={status} className="self-start" />
        <h1 className="font-display text-[clamp(3.5rem,14vw,10rem)] uppercase leading-[0.85] tracking-wide">{brandName}</h1>
        <p className="max-w-xl text-lg text-foreground/90 sm:text-xl">{m.site.landing.tagline}</p>
        <div className="pointer-events-auto flex flex-wrap gap-3">
          <a href="#services" className={cn(buttonVariants({ size: "lg" }), "press h-11 px-5 text-base")}>
            {m.site.landing.bookSpace}
          </a>
          <a href="#coming-up" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "press h-11 bg-background/60 px-5 text-base backdrop-blur")}>
            {m.site.landing.joinGame}
          </a>
        </div>
      </div>
    </section>
  );
}
