import Link from "next/link";
import { Bell } from "@/components/notifications/bell";
import { unreadCount } from "@/lib/notifications/inbox";
import { createClient } from "@/lib/supabase/server";
import { getLiveOrganization } from "@/lib/tenancy/org";
import { getPlayer } from "@/lib/tenancy/player";
import { logoUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";

/** The venue site's top bar: venue name, Book a space, My bookings, profile or sign-in, and the live bell. */
export async function TenantHeader({ slug }: { slug: string }) {
  const org = await getLiveOrganization(slug);
  if (!org) return null;
  const player = await getPlayer(slug);
  const unread = player?.profileId ? await unreadCount(await createClient(), player.profileId, org.id) : 0;
  const logo = logoUrl(org.branding.logo_path);

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element -- venue logos are user uploads on Supabase Storage */}
          {logo && <img src={logo} alt="" className="size-7 rounded-md object-contain" />}
          {org.name}
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/book" className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90">
            {m.tenant.bookSpace}
          </Link>
          {player && (
            <Link href="/me/bookings" className="rounded-lg px-3 py-1.5 hover:bg-foreground/5">
              {m.tenant.myBookings}
            </Link>
          )}
          <Link href={player ? "/me" : "/signin"} className="rounded-lg px-3 py-1.5 hover:bg-foreground/5">
            {player ? m.tenant.profile : m.tenant.signIn}
          </Link>
          {player?.profileId && <Bell key={unread} profileId={player.profileId} initialUnread={unread} />}
        </nav>
      </div>
    </header>
  );
}
