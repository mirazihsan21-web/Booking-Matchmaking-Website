import { Suspense, type ReactNode } from "react";
import { NotOpen } from "@/components/site/not-open";
import { SiteNav } from "@/components/site/site-nav";
import { unreadCount } from "@/lib/notifications/inbox";
import { createClient } from "@/lib/supabase/server";
import { getBrand } from "@/lib/tenancy/brand";
import { getSitePlayer } from "@/lib/tenancy/player";

async function Shell({ children }: { children: ReactNode }) {
  const brand = await getBrand();
  if (!brand) return <NotOpen />;
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

/** Every public page: the brand's navigation around the page, or "Not open yet" while there's no live brand. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
