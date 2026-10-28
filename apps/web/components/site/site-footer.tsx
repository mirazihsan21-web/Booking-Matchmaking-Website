import Link from "next/link";
import { sectionPath } from "@/lib/site/paths";
import { m } from "@/messages";

const link = "text-muted-foreground hover:text-foreground hover:underline";

/** The bottom of every site page: the brand and where it is, its sections, and the player's own pages. */
export function SiteFooter({
  brandName,
  address,
  sections,
  signedIn,
  year,
}: {
  brandName: string;
  address: string;
  sections: Array<{ slug: string; name: string }>;
  signedIn: boolean;
  year: number;
}) {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-10 sm:grid-cols-[2fr_1fr_1fr] sm:px-6">
        <div className="flex flex-col gap-2">
          <p className="font-display text-2xl uppercase tracking-wide">{brandName}</p>
          {address && <p className="max-w-xs text-sm text-muted-foreground">{address}</p>}
          <p className="mt-4 text-xs text-muted-foreground">{m.site.landing.rights(brandName, year)}</p>
        </div>
        <nav aria-label={m.site.landing.footerPlay} className="flex flex-col gap-2 text-sm">
          <p className="font-semibold">{m.site.landing.footerPlay}</p>
          {sections.map((s) => (
            <Link key={s.slug} href={sectionPath(s.slug)} className={link}>
              {s.name}
            </Link>
          ))}
        </nav>
        <nav aria-label={m.site.landing.footerAccount} className="flex flex-col gap-2 text-sm">
          <p className="font-semibold">{m.site.landing.footerAccount}</p>
          {signedIn ? (
            <>
              <Link href="/me/bookings" className={link}>
                {m.site.nav.myBookings}
              </Link>
              <Link href="/me" className={link}>
                {m.site.nav.profile}
              </Link>
              <Link href="/me/notifications" className={link}>
                {m.notifications.title}
              </Link>
            </>
          ) : (
            <Link href="/signin" className={link}>
              {m.site.nav.signIn}
            </Link>
          )}
        </nav>
      </div>
    </footer>
  );
}
