import { Suspense } from "react";
import { ActionForm, Field } from "@/components/forms/action-form";
import { LogoUploader } from "@/components/manage/logo-uploader";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { logoUrl, tenantUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";
import { getPreset } from "@/presets";
import { saveSettingsAction } from "../actions";

async function Settings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await requireOrgRole(slug, "owner");
  const palette = getPreset(org.businessType).palette;
  const supabase = await createClient();
  // Booking rules are per section now (the Sections page).
  const { data: venue } = await supabase.from("organizations").select("address").eq("id", org.id).single();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="pt-6">
          <ActionForm action={saveSettingsAction.bind(null, org.slug)} submitLabel={m.manage.save}>
            <Field name="name" label={m.manage.name} defaultValue={org.name} required />
            <Field name="address" label={m.manage.address} defaultValue={venue?.address ?? ""} />
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">{m.manage.slug}</span>
              <code>{tenantUrl(org.slug)}</code>
              {org.status === "live" && <span className="text-xs text-foreground/60">{m.manage.slugLocked}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field name="primary" label={m.manage.primaryColour} type="color" defaultValue={org.branding.primary ?? palette.primary} />
              <Field name="accent" label={m.manage.accentColour} type="color" defaultValue={org.branding.accent ?? palette.accent} />
            </div>
            <LogoUploader organizationId={org.id} currentPath={org.branding.logo_path} currentUrl={logoUrl(org.branding.logo_path)} />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage({ params }: PageProps<"/manage/[slug]/settings">) {
  return (
    <Suspense fallback={null}>
      <Settings params={params} />
    </Suspense>
  );
}
