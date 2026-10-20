import type { CSSProperties, ReactNode } from "react";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { TenantHeader } from "@/components/tenant/tenant-header";
import { getPreset } from "@/presets";
import { getLiveOrganization } from "@/lib/tenancy/org";
import { brandingToCssVars } from "@/lib/theme";

async function TenantShell({ params, children }: { params: Promise<{ slug: string }>; children: ReactNode }) {
  const { slug } = await params;
  const org = await getLiveOrganization(slug);
  if (!org) notFound();
  const vars = brandingToCssVars(org.branding, getPreset(org.businessType).palette);
  return (
    <div className="flex min-h-full flex-1 flex-col" style={vars as CSSProperties}>
      <TenantHeader slug={slug} />
      {children}
    </div>
  );
}

/** Every page on a venue's subdomain: branded with the venue's colours; 404 unless the venue is live. */
export default function TenantLayout({ children, params }: LayoutProps<"/t/[slug]">) {
  return (
    <Suspense fallback={null}>
      <TenantShell params={params}>{children}</TenantShell>
    </Suspense>
  );
}
