import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { formatNight } from "@/lib/format";
import type { Section } from "@/lib/sections/sections";
import type { UpcomingGame } from "@/lib/site/home";
import type { OpenStatus } from "@/lib/site/hours";
import { kindWords } from "@/lib/site/kinds";
import { bookPath, sectionPath } from "@/lib/site/paths";
import { m } from "@/messages";
import { SeatsBar } from "./seats-bar";
import { sectionStyle } from "./section-style";
import { StatusPill } from "./status-pill";

/** A section on the brand home: its colour line, name, today's hours, next game and the two main actions. */
export function SectionCard({
  section,
  status,
  next,
  timeZone,
  index = 0,
}: {
  section: Section;
  status: OpenStatus;
  next: UpcomingGame | null;
  timeZone: string;
  index?: number;
}) {
  const words = kindWords(section.kind);
  return (
    <article style={{ ...sectionStyle(section.accent), ["--i" as string]: index }} className="rise flex flex-col gap-4 rounded-xl border-l-[3px] border-section bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={sectionPath(section.slug)} className="font-display text-3xl uppercase tracking-wide text-section hover:underline">
          {section.name}
        </Link>
        <StatusPill status={status} />
      </div>
      {next ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {formatNight(next.startsAt, timeZone)} · <span className="text-foreground">{next.activityName ?? m.site.anyGame}</span>
          </p>
          <SeatsBar left={next.left} total={next.total} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{words.noGames}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href={next ? `/sessions/${next.id}` : sectionPath(section.slug)} className={cn(buttonVariants({ variant: "section", size: "lg" }), "press px-4")}>
          {words.join}
        </Link>
        <Link href={bookPath(section.slug)} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "press px-4")}>
          {words.book}
        </Link>
      </div>
    </article>
  );
}
