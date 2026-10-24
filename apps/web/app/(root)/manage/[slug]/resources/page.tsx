import { Suspense } from "react";
import { ActionButton, ActionForm, Field, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RESOURCE_KINDS } from "@/lib/forms/resource";
import { formatBdt } from "@/lib/money";
import { loadSections } from "@/lib/sections/sections";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";
import { getPreset } from "@/presets";
import { saveResourceAction, setResourceActiveAction } from "../actions";

const kindOptions = RESOURCE_KINDS.map((k) => ({ value: k, label: m.manage.resourceKinds[k]! }));
const taka = (poisha: number | null) => (poisha === null ? "" : String(poisha / 100));

async function Resources({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await requireOrgRole(slug, "owner");
  const { labels } = getPreset(org.businessType);
  const supabase = await createClient();
  const [sections, { data: resources }] = await Promise.all([
    loadSections(supabase, org.id),
    supabase
      .from("resources")
      .select("id, section_id, name, kind, capacity, price_per_hour_poisha, slot_minutes, active")
      .eq("organization_id", org.id)
      .order("name"),
  ]);
  const sectionName = new Map(sections.map((s) => [s.id, s.name]));

  return (
    <div className="flex flex-col gap-4">
      {(resources ?? []).map((r) => (
        <Card key={r.id} className={r.active ? undefined : "opacity-60"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {r.name}
              <Badge variant="outline">{sectionName.get(r.section_id)}</Badge>
              {!r.active && <Badge variant="secondary">{m.manage.inactive}</Badge>}
              <span className="text-sm font-normal text-foreground/60">
                {r.price_per_hour_poisha === null ? m.manage.noPrice : `${formatBdt(r.price_per_hour_poisha)} ${m.manage.perHour}`}
                {" · "}
                {m.manage.slots(r.slot_minutes)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ActionForm action={saveResourceAction.bind(null, org.slug, r.id)} submitLabel={m.manage.save} className="sm:grid sm:grid-cols-5 sm:items-end">
              <Field name="name" label={m.manage.name} defaultValue={r.name} required />
              <SelectField name="kind" label={m.manage.kind} options={kindOptions} defaultValue={r.kind} />
              <Field name="capacity" label={m.manage.capacity} type="number" min={1} max={30} defaultValue={r.capacity} />
              <Field name="price" label={m.manage.pricePerHour} inputMode="decimal" defaultValue={taka(r.price_per_hour_poisha)} />
              <Field name="slotMinutes" label={m.manage.slotMinutes} type="number" min={15} max={240} step={15} defaultValue={r.slot_minutes} />
            </ActionForm>
            <ActionButton
              action={setResourceActiveAction.bind(null, org.slug, r.id, !r.active)}
              label={r.active ? m.manage.deactivate : m.manage.activate}
            />
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>
            {m.manage.add} {labels.resource}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveResourceAction.bind(null, org.slug, null)} submitLabel={m.manage.add} resetOnSuccess className="sm:grid sm:grid-cols-6 sm:items-end">
            <SelectField name="sectionId" label={m.manage.section} options={sections.map((s) => ({ value: s.id, label: s.name }))} />
            <Field name="name" label={m.manage.name} required />
            <SelectField name="kind" label={m.manage.kind} options={kindOptions} defaultValue={getPreset(org.businessType).resources[0]?.kind} />
            <Field name="capacity" label={m.manage.capacity} type="number" min={1} max={30} defaultValue={4} />
            <Field name="price" label={m.manage.pricePerHour} inputMode="decimal" />
            <Field name="slotMinutes" label={m.manage.slotMinutes} type="number" min={15} max={240} step={15} defaultValue={60} />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResourcesPage({ params }: PageProps<"/manage/[slug]/resources">) {
  return (
    <Suspense fallback={null}>
      <Resources params={params} />
    </Suspense>
  );
}
