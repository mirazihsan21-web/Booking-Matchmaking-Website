import type { ReactNode } from "react";
import { SiteNav } from "@/components/site/site-nav";
import { unreadCount } from "@/lib/notifications/inbox";
import { createClient } from "@/lib/supabase/server";
import type { Brand } from "@/lib/tenancy/brand";
import { getSitePlayer } from "@/lib/tenancy/player";

/** The brand's navigation (top bar, phone tab bar, bell) around a page. */
export async function SiteChrome({ brand, children }: { brand: Brand; children: ReactNode }) {
  const player = await getSitePlayer();
  const unread = player?.profileId ? await unreadCount(await createClient(), player.profileId, brand.id) : 0;
  return (
    // Bottom padding leaves room for the phone tab bar.
    <div className="flex min-h-full flex-1 flex-col pb-20 md:pb-0">
      <SiteNav
        brandName={brand.name}
        sections={brand.sections.map((s) => ({ slug: s.slug, name: s.name, kind: s.kind, accent: s.accent }))}
        signedIn={Boolean(player)}
        bell={player?.profileId ? { profileId: player.profileId, organizationId: brand.id, unread } : null}
      />
      {children}
    </div>
  );
}
