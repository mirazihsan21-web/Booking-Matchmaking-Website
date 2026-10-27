"use client";

import { Dices, Gamepad2, Goal, House, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { Bell } from "@/components/notifications/bell";
import type { BusinessType } from "@/presets/types";
import { m } from "@/messages";
import { sectionStyle } from "./section-style";

const KIND_ICON: Record<BusinessType, LucideIcon> = { turf: Goal, boardgame_cafe: Dices, gaming_lounge: Gamepad2 };

export interface NavSection {
  slug: string;
  name: string;
  kind: BusinessType;
  accent: string;
}

/**
 * The site's navigation. Phones: a slim top bar (brand, bell) and a bottom tab bar Home · sections · Me,
 * the current tab tinted. Desktop: one top bar with the brand, the sections in their colours, My bookings,
 * the bell and Profile / Sign in.
 */
export function SiteNav({
  brandName,
  sections,
  signedIn,
  bell,
}: {
  brandName: string;
  sections: NavSection[];
  signedIn: boolean;
  bell: { profileId: string; organizationId: string; unread: number } | null;
}) {
  const path = usePathname();
  const on = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const meHref = signedIn ? "/me" : "/signin";

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="font-display text-2xl uppercase tracking-wide">
            {brandName}
          </Link>
          <nav className="hidden items-center gap-5 text-sm font-semibold md:flex">
            {sections.map((s) => (
              <Link
                key={s.slug}
                href={`/${s.slug}`}
                style={sectionStyle(s.accent)}
                className={cn("text-section hover:underline", on(`/${s.slug}`) && "underline underline-offset-8")}
              >
                {s.name}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {signedIn && (
              <Link href="/me/bookings" className="hidden rounded-lg px-3 py-1.5 hover:bg-raised md:inline-block">
                {m.site.nav.myBookings}
              </Link>
            )}
            {bell && <Bell key={bell.unread} profileId={bell.profileId} organizationId={bell.organizationId} initialUnread={bell.unread} />}
            <Link href={meHref} className="hidden rounded-lg px-3 py-1.5 font-semibold hover:bg-raised md:inline-block">
              {signedIn ? m.site.nav.profile : m.site.nav.signIn}
            </Link>
          </div>
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="mx-auto flex max-w-md items-stretch justify-around">
          <Tab href="/" label={m.site.nav.home} Icon={House} active={on("/")} />
          {sections.map((s) => (
            <Tab key={s.slug} href={`/${s.slug}`} label={s.name} Icon={KIND_ICON[s.kind]} active={on(`/${s.slug}`)} accent={s.accent} />
          ))}
          <Tab href={meHref} label={m.site.nav.me} Icon={UserRound} active={on("/me") || on("/signin")} />
        </ul>
      </nav>
    </>
  );
}

function Tab({ href, label, Icon, active, accent }: { href: string; label: string; Icon: LucideIcon; active: boolean; accent?: string }) {
  return (
    <li className="flex-1">
      <Link
        href={href}
        style={accent ? sectionStyle(accent) : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "press flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-semibold",
          active ? (accent ? "text-section" : "text-foreground") : "text-muted-foreground",
        )}
      >
        <Icon aria-hidden className="size-5" />
        <span className="max-w-full truncate">{label}</span>
      </Link>
    </li>
  );
}
