import { Suspense } from "react";
import { ActionButton, ActionForm, Field } from "@/components/forms/action-form";
import { LogoUploader } from "@/components/manage/logo-uploader";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { logoUrl, rootUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";
import { publishBrandAction, saveBrandAction } from "./actions";

/** The brand (owner only): name, address and logo; Publish while the site isn't live. */
async function Brand() {
  const { org } = await requireManager("owner");
  const { data: venue } = await createServiceClient().from("organizations").select("address").eq("id", org.id).single();
  const b = m.manage.brandPage;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-4xl uppercase tracking-wide">{b.title}</h1>

      {org.status === "live" ? (
        <p className="text-sm text-muted-foreground">
          {b.liveAt}{" "}
          <a href={rootUrl()} className="font-semibold text-foreground underline underline-offset-4">
            {rootUrl().replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        </p>
      ) : org.status === "suspended" ? (
        <p className="text-destructive">{m.manage.suspendedNotice}</p>
      ) : (
        <section className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-card p-5">
          <h2 className="font-display text-2xl uppercase tracking-wide text-warning">{m.manage.today.notLive}</h2>
          <p className="text-sm text-muted-foreground">{b.publishIntro}</p>
          <ActionButton action={publishBrandAction} label={m.manage.publish} variant="default" />
        </section>
      )}

      <section className="flex max-w-2xl flex-col gap-4 rounded-xl bg-card p-5">
        <ActionForm action={saveBrandAction} submitLabel={m.manage.save} variant="default" className="gap-5">
          <Field name="name" label={m.manage.name} defaultValue={org.name} required maxLength={80} />
          <div className="flex flex-col gap-1">
            <Field name="address" label={m.manage.address} defaultValue={venue?.address ?? ""} maxLength={200} />
            <p className="text-xs text-muted-foreground">{b.addressHint}</p>
          </div>
          <LogoUploader organizationId={org.id} currentPath={org.branding.logo_path} currentUrl={logoUrl(org.branding.logo_path)} />
        </ActionForm>
      </section>
    </div>
  );
}

export default function BrandPage() {
  return (
    <Suspense fallback={null}>
      <Brand />
    </Suspense>
  );
}
