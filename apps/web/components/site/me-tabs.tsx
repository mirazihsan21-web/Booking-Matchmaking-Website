import Link from "next/link";
import { cn } from "cn";
import { m } from "@/messages";

const TABS = [
  { key: "profile", href: "/me", label: m.site.nav.profile },
  { key: "bookings", href: "/me/bookings", label: m.site.nav.myBookings },
  { key: "notifications", href: "/me/notifications", label: m.notifications.title },
] as const;

/** The player's own pages (Profile · My bookings · Notifications) and Sign out — on phones this is the only way between them. */
export function MeTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label={m.site.nav.me} className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === active ? "page" : undefined}
            className={cn(
              "press shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold",
              t.key === active ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:border-foreground/60",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <form action="/auth/signout" method="post">
        <button type="submit" className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-raised hover:text-foreground">
          {m.auth.signOut}
        </button>
      </form>
    </div>
  );
}
