import { Suspense } from "react";
import { ActionForm, Field } from "@/components/forms/action-form";
import { LogoUploader } from "@/components/manage/logo-uploader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { logoUrl, tenantUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";
import { getPreset } from "@/presets";
import { saveBookingSettingsAction, saveSettingsAction } from "../actions";

async function Settings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await requireOrgRole(slug, "owner");
  const palette = getPreset(org.businessType).palette;
  const supabase = await createClient();
  const { data: rules } = await supabase
    .from("organizations")
    .select("booking_horizon_days, cancel_cutoff_minutes, match_cutoff_minutes, max_upcoming_bookings")
    .eq("id", org.id)
    .single();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="pt-6">
          <ActionForm action={saveSettingsAction.bind(null, org.slug)} submitLabel={m.manage.save}>
            <Field name="name" label={m.manage.name} defaultValue={org.name} required />
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
      {rules && (
        <Card>
          <CardHeader>
            <CardTitle>{m.manage.bookingSettings}</CardTitle>
            <CardDescription>{m.manage.bookingSettingsIntro}</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveBookingSettingsAction.bind(null, org.slug)} submitLabel={m.manage.save} className="sm:grid sm:grid-cols-2 sm:items-end">
              <Field name="horizonDays" label={m.manage.horizonDays} type="number" min={1} max={90} defaultValue={rules.booking_horizon_days} />
              <Field name="maxUpcoming" label={m.manage.maxUpcoming} type="number" min={1} max={20} defaultValue={rules.max_upcoming_bookings} />
              <Field name="cancelCutoffHours" label={m.manage.cancelCutoffHours} type="number" min={0} max={168} defaultValue={rules.cancel_cutoff_minutes / 60} />
              <Field name="matchCutoffHours" label={m.manage.matchCutoffHours} type="number" min={0} max={168} defaultValue={rules.match_cutoff_minutes / 60} />
            </ActionForm>
          </CardContent>
        </Card>
      )}
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
