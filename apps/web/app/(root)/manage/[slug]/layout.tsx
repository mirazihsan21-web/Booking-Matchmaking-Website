import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { tenantUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";
import { getPreset } from "@/presets";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function Nav({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org, role } = await requireOrgRole(slug, "staff");
  const { labels } = getPreset(org.businessType);
  const links = [
    { href: "", label: m.manage.overview },
    { href: "/schedule", label: m.manage.schedule },
    { href: "/bookings", label: m.manage.bookings },
    ...(role === "owner"
      ? [
          { href: "/sections", label: m.manage.sections },
          { href: "/resources", label: cap(labels.resourcePlural) },
          { href: "/activities", label: cap(labels.activityPlural) },
          { href: "/staff", label: m.manage.staff },
          { href: "/settings", label: m.manage.settings },
        ]
      : []),
  ];
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/manage" className="text-sm text-foreground/60 hover:underline">
          {m.manage.myVenues}
        </Link>
        <span className="text-foreground/40">/</span>
        <h1 className="text-xl font-semibold">{org.name}</h1>
        <Badge variant={org.status === "live" ? "default" : "secondary"}>{m.status[org.status]}</Badge>
        {org.status === "live" && (
          <a href={tenantUrl(org.slug)} className="text-sm text-primary hover:underline">
            {m.manage.publicPage} ↗
          </a>
        )}
      </div>
      <nav className="flex flex-wrap gap-4 text-sm">
        {links.map((l) => (
          <Link key={l.href} href={`/manage/${org.slug}${l.href}`} className="text-foreground/80 hover:text-foreground hover:underline">
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export default function ManageVenueLayout({ children, params }: LayoutProps<"/manage/[slug]">) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <Suspense fallback={<div className="h-16" />}>
        <Nav params={params} />
      </Suspense>
      {children}
    </div>
  );
}
