"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { m } from "@/messages";

/** The tabs of one section's setup: Spaces, Games, Hours & rules, Website. */
export function SectionTabs({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/manage/sections/${slug}`;
  const tabs = [
    { href: base, label: m.manage.sectionsPage.tabs.spaces },
    { href: `${base}/games`, label: m.manage.sectionsPage.tabs.games },
    { href: `${base}/hours`, label: m.manage.sectionsPage.tabs.hours },
    { href: `${base}/website`, label: m.manage.sectionsPage.tabs.website },
  ];
  return (
    <nav aria-label={m.manage.nav.sections} className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold",
              active ? "border-section bg-section text-on-section" : "border-border bg-card hover:border-section",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
