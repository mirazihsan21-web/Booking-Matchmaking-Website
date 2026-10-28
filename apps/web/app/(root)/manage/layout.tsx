import { Suspense, type ReactNode } from "react";
import { ManageNav } from "@/components/manage/manage-nav";
import { logoUrl } from "@/lib/tenancy/urls";
import { getManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

// Manage pages render only for the brand's team (checked per request), so dev-time instant-navigation
// validation can't see the page from outside; navigations within /manage are still checked.
export const instant = false;

async function Shell({ children }: { children: ReactNode }) {
  const manager = await getManager();
  if (!manager) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-16">
        <h1 className="font-display text-4xl uppercase tracking-wide">{m.manage.nav.label}</h1>
        <p className="text-muted-foreground">{m.manage.noVenues}</p>
      </main>
    );
  }
  return (
    <div className="flex min-h-full flex-1">
      <ManageNav isOwner={manager.role === "owner"} brandName={manager.org.name} logoUrl={logoUrl(manager.org.branding.logo_path)} />
      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-8 md:pb-10">{children}</main>
    </div>
  );
}

/** Every manage page: the team's navigation around it, or "You don't run any venues yet." for anyone else. */
export default function ManageLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
