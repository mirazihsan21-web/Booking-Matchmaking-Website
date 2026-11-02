import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { hasUnreadRoom, privateUnread } from "@/lib/chat/reads";
import { TeamInviteBar } from "@/components/site/team-invite-bar";
import { unreadCount } from "@/lib/notifications/inbox";
import { createClient } from "@/lib/supabase/server";
import type { Brand } from "@/lib/tenancy/brand";
import { logoUrl } from "@/lib/tenancy/urls";
import { getSitePlayer } from "@/lib/tenancy/player";
import { getMyTeamInvite } from "@/lib/tenancy/team-invite";

/** The brand's navigation (top bar, phone tab bar, bell, Chat link and its dot), a bar when a team invite waits for you, and the footer around a page. */
export async function SiteChrome({ brand, children }: { brand: Brand; children: ReactNode }) {
  const player = await getSitePlayer();
  // Team logins are venue-only: no player bell, and the menu leads to Manage.
  const bellProfileId = player && !player.isTeam ? player.profileId : null;
  const supabase = await createClient();
  const [unread, invite, chatUnread, chatPrivate] = await Promise.all([
    bellProfileId ? unreadCount(supabase, bellProfileId, brand.id) : 0,
    getMyTeamInvite(),
    player ? hasUnreadRoom(supabase, { organizationId: brand.id, userId: player.user.id }) : false,
    bellProfileId ? privateUnread(supabase, brand.id) : 0,
  ]);
  const team = player?.isTeam ? { name: player.teamName ?? player.user.name ?? player.user.email ?? "", avatarUrl: player.user.avatarUrl } : null;
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
        chat={player ? { organizationId: brand.id, userId: player.user.id, unread: chatUnread, privateUnread: chatPrivate } : null}
      />
      {invite && <TeamInviteBar brandName={brand.name} />}
      {children}
      <SiteFooter brandName={brand.name} logoUrl={logo} address={brand.address} sections={sections} signedIn={Boolean(player)} team={Boolean(team)} year={new Date().getFullYear()} />
    </div>
  );
}
