import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import type { TeamDeskLink } from "@/lib/manage/team-links";
import { m } from "@/messages";

const LABEL: Record<TeamDeskLink["label"], string> = { space: m.team.openSpace, game: m.team.openGame, today: m.team.goToday };

/** In place of Book / Request a seat for the brand's team (venue-only logins): where to do it in Manage. */
export function TeamNote({ brandName, link }: { brandName: string; link: TeamDeskLink }) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 rounded-xl bg-card p-6">
      <p>{m.team.note(brandName)}</p>
      <Link href={link.href} className={cn(buttonVariants({ variant: "section", size: "lg" }), "press px-4")}>
        {LABEL[link.label]}
      </Link>
    </div>
  );
}
