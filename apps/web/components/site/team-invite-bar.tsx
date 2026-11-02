"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { m } from "@/messages";

/** Under the top bar on every page while an invite to the brand's team waits for the signed-in person (not on /join itself). */
export function TeamInviteBar({ brandName }: { brandName: string }) {
  if (usePathname() === "/join") return null;
  return (
    <aside aria-label={m.join.seeInvite} className="border-b border-border bg-raised">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm sm:px-6">
        <p className="font-semibold">{m.join.bar(brandName)}</p>
        <Link href="/join" className={cn(buttonVariants({ size: "sm" }), "press")}>
          {m.join.seeInvite}
        </Link>
      </div>
    </aside>
  );
}
