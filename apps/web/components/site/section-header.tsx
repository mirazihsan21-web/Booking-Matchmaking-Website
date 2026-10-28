import Image from "next/image";
import type { ReactNode } from "react";
import type { Section } from "@/lib/sections/sections";
import type { OpenStatus } from "@/lib/site/hours";
import { kindWords, sectionPhotoUrl } from "@/lib/site/kinds";
import { sectionStyle } from "./section-style";
import { StatusPill } from "./status-pill";

/** The top of a section page: its photo behind a dark fade, its name in its colour, today's hours, actions. */
export function SectionHeader({ section, status, children }: { section: Section; status: OpenStatus; children?: ReactNode }) {
  return (
    <header style={sectionStyle(section.accent)} className="relative isolate overflow-hidden">
      <Image src={sectionPhotoUrl(section)} alt="" fill preload sizes="100vw" className="-z-20 object-cover" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/75 to-background/25" />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 pt-24 pb-6 sm:px-6 sm:pt-36">
        <StatusPill status={status} className="self-start" />
        <h1 className="font-display text-5xl uppercase leading-none tracking-wide text-section sm:text-7xl">{section.name}</h1>
        <p className="text-sm text-foreground/80 capitalize">{kindWords(section.kind).games}</p>
        {children && <div className="mt-2 flex flex-wrap gap-2">{children}</div>}
      </div>
    </header>
  );
}
