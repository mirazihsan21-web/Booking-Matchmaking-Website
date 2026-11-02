import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { unreadCount } from "@/lib/notifications/inbox";
import { createClient } from "@/lib/supabase/server";
import type { Brand } from "@/lib/tenancy/brand";
import { logoUrl } from "@/lib/tenancy/urls";
import { getSitePlayer } from "@/lib/tenancy/player";

/** The brand's navigation (top bar, phone tab bar, bell) and footer around a page. */
export async function SiteChrome({ brand, children }: { brand: Brand; children: ReactNode }) {
  const player = await getSitePlayer();
  // Team logins are venue-only: no player bell, and the menu leads to Manage.
  const bellProfileId = player && !player.isTeam ? player.profileId : null;
  const unread = bellProfileId ? await unreadCount(await createClient(), bellProfileId, brand.id) : 0;
  const team = player?.isTeam ? { name: player.user.name ?? player.user.email ?? "", avatarUrl: player.user.avatarUrl } : null;
  const logo = logoUrl(brand.branding.logo_path);
  const sections = brand.sections.map((s) => ({ slug: s.slug, name: s.name, kind: s.kind, accent: s.accent }));
  return (
    // Bottom padding leaves room for the phone tab bar.
    <div className="flex min-h-full flex-1 flex-col pb-20 md:pb-0">
      <SiteNav
        brandName={brand.name}
        logoUrl={logo}
        sections={sections}
        signedIn={Boolean(player)}
        team={team}
        bell={bellProfileId ? { profileId: bellProfileId, organizationId: brand.id, unread } : null}
      />
      {children}
      <SiteFooter brandName={brand.name} logoUrl={logo} address={brand.address} sections={sections} signedIn={Boolean(player)} team={Boolean(team)} year={new Date().getFullYear()} />
    </div>
  );
}
