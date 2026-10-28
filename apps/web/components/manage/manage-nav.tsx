"use client";

import { Banknote, CalendarClock, CalendarRange, ExternalLink, LayoutGrid, ListChecks, LogOut, Menu, Store, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "cn";
import { m } from "@/messages";

type Item = { href: string; label: string; Icon: LucideIcon; ownerOnly?: boolean };

const DESK: Item[] = [
  { href: "/manage", label: m.manage.nav.today, Icon: CalendarClock },
  { href: "/manage/bookings", label: m.manage.nav.bookings, Icon: ListChecks },
  { href: "/manage/schedule", label: m.manage.nav.schedule, Icon: CalendarRange },
];
const OWNER: Item[] = [
  { href: "/manage/takings", label: m.manage.nav.takings, Icon: Banknote, ownerOnly: true },
  { href: "/manage/sections", label: m.manage.nav.sections, Icon: LayoutGrid, ownerOnly: true },
  { href: "/manage/staff", label: m.manage.nav.staff, Icon: Users, ownerOnly: true },
  { href: "/manage/brand", label: m.manage.nav.brand, Icon: Store, ownerOnly: true },
];

/**
 * The manage area's navigation. Laptop: a left sidebar with the brand, every page this person may open,
 * the public site and Sign out. Phone: a bottom bar with Today, Bookings, Schedule and More (the rest).
 */
export function ManageNav({ isOwner, brandName, logoUrl }: { isOwner: boolean; brandName: string; logoUrl: string | null }) {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const on = (href: string) => (href === "/manage" ? path === "/manage" : path === href || path.startsWith(`${href}/`));
  const owner = isOwner ? OWNER : [];
  const link = (item: Item, onClick?: () => void) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={onClick}
      aria-current={on(item.href) ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold",
        on(item.href) ? "bg-raised text-foreground" : "text-muted-foreground hover:bg-raised hover:text-foreground",
      )}
    >
      <item.Icon aria-hidden className="size-4" />
      {item.label}
    </Link>
  );
  const extras = (
    <>
      <Link href="/" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-raised hover:text-foreground">
        <ExternalLink aria-hidden className="size-4" />
        {m.manage.nav.viewSite}
      </Link>
      <form action="/auth/signout" method="post">
        <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-raised hover:text-foreground">
          <LogOut aria-hidden className="size-4" />
          {m.manage.nav.signOut}
        </button>
      </form>
    </>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-6 border-r border-border px-3 py-5 md:flex">
        <Link href="/manage" className="flex items-center gap-2 px-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a small uploaded logo from public storage */}
          {logoUrl && <img src={logoUrl} alt="" className="size-8 rounded object-contain" />}
          <span className="font-display text-xl uppercase tracking-wide">{brandName}</span>
        </Link>
        <nav aria-label={m.manage.nav.label} className="flex flex-1 flex-col gap-1">
          {DESK.map((item) => link(item))}
          {owner.length > 0 && <div className="my-2 border-t border-border" />}
          {owner.map((item) => link(item))}
        </nav>
        <div className="flex flex-col gap-1">{extras}</div>
      </aside>

      <nav aria-label={m.manage.nav.label} className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {moreOpen && (
          <div className="flex flex-col gap-1 border-b border-border px-3 py-3">
            {owner.map((item) => link(item, () => setMoreOpen(false)))}
            {extras}
          </div>
        )}
        <div className="grid grid-cols-4">
          {DESK.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={on(item.href) ? "page" : undefined}
              className={cn("flex flex-col items-center gap-1 py-2 text-[11px] font-semibold", on(item.href) ? "text-foreground" : "text-muted-foreground")}
            >
              <item.Icon aria-hidden className="size-5" />
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
            className={cn("flex flex-col items-center gap-1 py-2 text-[11px] font-semibold", moreOpen ? "text-foreground" : "text-muted-foreground")}
          >
            <Menu aria-hidden className="size-5" />
            {m.manage.nav.more}
          </button>
        </div>
      </nav>
    </>
  );
}
