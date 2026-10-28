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
  const unread = player?.profileId ? await unreadCount(await createClient(), player.profileId, brand.id) : 0;
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
        bell={player?.profileId ? { profileId: player.profileId, organizationId: brand.id, unread } : null}
      />
      {children}
      <SiteFooter brandName={brand.name} logoUrl={logo} address={brand.address} sections={sections} signedIn={Boolean(player)} year={new Date().getFullYear()} />
    </div>
  );
}
