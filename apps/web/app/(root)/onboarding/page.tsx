import Link from "next/link";
import { Suspense } from "react";
import { ActionButton, ActionForm, Field } from "@/components/forms/action-form";
import { LogoUploader } from "@/components/manage/logo-uploader";
import { SectionFields } from "@/components/manage/section-fields";
import { NameAndSlug } from "@/components/onboarding/name-and-slug";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/dal";
import { formatBdt } from "@/lib/money";
import { loadSections } from "@/lib/sections/sections";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { logoUrl, tenantUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";
import { PRESETS, getPreset, type BusinessType } from "@/presets";
import { publishAction, saveSectionAction, saveSettingsAction } from "../manage/[slug]/actions";
import { createOrganizationAction } from "./actions";

const STEPS = ["type", "name", "branding", "branch", "review", "publish"] as const;
type Step = (typeof STEPS)[number];
const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

function Progress({ step }: { step: Step }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s}>
          <Badge variant={s === step ? "default" : "outline"}>
            {i + 1}. {m.onboarding.steps[s]}
          </Badge>
        </li>
      ))}
    </ol>
  );
}

const next = (slug: string, step: Step) => (
  <Link href={`/onboarding?org=${slug}&step=${step}`} className="self-end text-sm font-medium text-primary hover:underline">
    {m.onboarding.continue} →
  </Link>
);

/** Steps 1–2: no organization yet. */
function NewVenue({ type }: { type?: string }) {
  if (!type || !(type in PRESETS)) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {Object.values(PRESETS).map((p) => (
          <Link key={p.businessType} href={`/onboarding?step=name&type=${p.businessType}`}>
            <Card className="h-full hover:bg-muted">
              <CardHeader>
                <CardTitle>{m.onboarding.types[p.businessType]}</CardTitle>
                <CardDescription>{m.onboarding.typeBlurb[p.businessType]}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-foreground/70">
                {m.onboarding.starter(p.resources.length, p.labels.resourcePlural, p.activities.length, p.labels.activityPlural)}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.onboarding.types[type as BusinessType]}</CardTitle>
      </CardHeader>
      <CardContent>
        <ActionForm action={createOrganizationAction} submitLabel={m.onboarding.create}>
          <input type="hidden" name="businessType" value={type} />
          <NameAndSlug rootDomain={ROOT} />
        </ActionForm>
      </CardContent>
    </Card>
  );
}

/** Steps 3–6: the owner's new organization. */
async function ExistingVenue({ slug, step }: { slug: string; step: Step }) {
  const { org } = await requireOrgRole(slug, "owner");
  const preset = getPreset(org.businessType);
  const supabase = await createClient();

  if (step === "branding") {
    const { data: venue } = await supabase.from("organizations").select("address").eq("id", org.id).single();
    const address = venue?.address;
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <ActionForm action={saveSettingsAction.bind(null, org.slug)} submitLabel={m.manage.save}>
            <input type="hidden" name="name" value={org.name} />
            <Field name="address" label={m.manage.address} defaultValue={address ?? ""} />
            <div className="grid grid-cols-2 gap-3">
              <Field name="primary" label={m.manage.primaryColour} type="color" defaultValue={org.branding.primary ?? preset.palette.primary} />
              <Field name="accent" label={m.manage.accentColour} type="color" defaultValue={org.branding.accent ?? preset.palette.accent} />
            </div>
            <LogoUploader organizationId={org.id} currentPath={org.branding.logo_path} currentUrl={logoUrl(org.branding.logo_path)} />
          </ActionForm>
          {next(org.slug, "branch")}
        </CardContent>
      </Card>
    );
  }

  if (step === "branch") {
    const [section] = await loadSections(supabase, org.id);
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          {section && (
            <ActionForm action={saveSectionAction.bind(null, org.slug, section.id)} submitLabel={m.manage.save}>
              <SectionFields section={section} />
            </ActionForm>
          )}
          {next(org.slug, "review")}
        </CardContent>
      </Card>
    );
  }

  if (step === "review") {
    const [{ data: resources }, { data: activities }] = await Promise.all([
      supabase.from("resources").select("name, capacity, price_per_hour_poisha").eq("organization_id", org.id).order("name"),
      supabase.from("activities").select("name, team_mode, team_size, min_players, max_players").eq("organization_id", org.id).order("name"),
    ]);
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="capitalize">{preset.labels.resourcePlural}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {(resources ?? []).map((r) => (
              <span key={r.name}>
                {r.name} · {r.capacity} · {r.price_per_hour_poisha === null ? m.manage.noPrice : `${formatBdt(r.price_per_hour_poisha)} ${m.manage.perHour}`}
              </span>
            ))}
            <Link href={`/manage/${org.slug}/resources`} className="text-primary hover:underline">
              {m.onboarding.edit}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="capitalize">{preset.labels.activityPlural}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {(activities ?? []).map((a) => (
              <span key={a.name}>
                {a.name} · {a.team_mode === "two_teams" ? m.manage.versus(a.team_size!) : m.manage.players(a.min_players, a.max_players)}
              </span>
            ))}
            <Link href={`/manage/${org.slug}/activities`} className="text-primary hover:underline">
              {m.onboarding.edit}
            </Link>
          </CardContent>
        </Card>
        {next(org.slug, "publish")}
      </div>
    );
  }

  // publish
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        {org.status === "live" ? (
          <>
            <p>{m.manage.published}</p>
            <a href={tenantUrl(org.slug)} className="font-medium text-primary hover:underline">
              {tenantUrl(org.slug)} ↗
            </a>
            <Link href={`/manage/${org.slug}`} className="text-sm hover:underline">
              {m.onboarding.toDashboard}
            </Link>
          </>
        ) : (
          <>
            <p className="text-foreground/70">{m.onboarding.publishBlurb(tenantUrl(org.slug))}</p>
            <ActionButton action={publishAction.bind(null, org.slug)} label={m.manage.publish} variant="default" />
          </>
        )}
      </CardContent>
    </Card>
  );
}

async function Wizard({ searchParams }: { searchParams: Promise<{ step?: string; type?: string; org?: string }> }) {
  await requireUser("/onboarding");
  const params = await searchParams;
  const step: Step = STEPS.includes(params.step as Step) ? (params.step as Step) : "type";
  const orgStep = params.org && !["type", "name"].includes(step);
  return (
    <div className="flex flex-col gap-6">
      <Progress step={orgStep ? step : params.type ? "name" : "type"} />
      {orgStep ? <ExistingVenue slug={params.org!} step={step} /> : <NewVenue type={params.type} />}
    </div>
  );
}

export default function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">{m.onboarding.title}</h1>
      <Suspense fallback={null}>
        <Wizard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
