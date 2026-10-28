import { Suspense } from "react";
import { cn } from "cn";
import { ActionButton, ActionForm, Field, SelectField } from "@/components/forms/action-form";
import { RESOURCE_KINDS } from "@/lib/forms/resource";
import { formatBdt } from "@/lib/money";
import { createServiceClient } from "@/lib/service-client";
import { m } from "@/messages";
import { saveResourceAction, setResourceActiveAction } from "../actions";
import { ownerSection } from "./owner-section";

const kindOptions = RESOURCE_KINDS.map((k) => ({ value: k, label: m.manage.resourceKinds[k]! }));
const taka = (poisha: number | null) => (poisha === null ? "" : String(poisha / 100));

/** A section's spaces: each editable (name, type, capacity, price, slot length) and switchable on/off; add one. */
async function Spaces({ params }: { params: Promise<{ section: string }> }) {
  const { manager, section } = await ownerSection(params);
  const { data: spaces } = await createServiceClient()
    .from("resources")
    .select("id, name, kind, capacity, price_per_hour_poisha, slot_minutes, active")
    .eq("organization_id", manager.org.id)
    .eq("section_id", section.id)
    .order("name");

  return (
    <div className="flex flex-col gap-4">
      {(spaces ?? []).map((r) => (
        <section key={r.id} className={cn("flex flex-col gap-3 rounded-xl border-l-[3px] border-section bg-card p-4", !r.active && "opacity-70")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold">{r.name}</h2>
            {!r.active && <span className="rounded-full bg-raised px-2 py-0.5 text-xs">{m.manage.inactive}</span>}
            <span className="text-sm text-muted-foreground">
              {r.price_per_hour_poisha === null ? m.manage.noPrice : `${formatBdt(r.price_per_hour_poisha)} ${m.manage.perHour}`} · {m.manage.slots(r.slot_minutes)}
            </span>
            <span className="ml-auto">
              <ActionButton action={setResourceActiveAction.bind(null, r.id, !r.active)} label={r.active ? m.manage.deactivate : m.manage.activate} variant="ghost" />
            </span>
          </div>
          <ActionForm action={saveResourceAction.bind(null, section.id, r.id)} submitLabel={m.manage.save} className="sm:grid sm:grid-cols-5 sm:items-end">
            <Field name="name" label={m.manage.name} defaultValue={r.name} required />
            <SelectField name="kind" label={m.manage.kind} options={kindOptions} defaultValue={r.kind} />
            <Field name="capacity" label={m.manage.capacity} type="number" min={1} max={30} defaultValue={r.capacity} />
            <Field name="price" label={m.manage.pricePerHour} inputMode="decimal" defaultValue={taka(r.price_per_hour_poisha)} />
            <Field name="slotMinutes" label={m.manage.slotMinutes} type="number" min={15} max={240} step={15} defaultValue={r.slot_minutes} />
          </ActionForm>
        </section>
      ))}
      <section className="flex flex-col gap-3 rounded-xl bg-card p-4">
        <h2 className="font-display text-2xl uppercase tracking-wide">{m.manage.sectionsPage.addSpace}</h2>
        <ActionForm action={saveResourceAction.bind(null, section.id, null)} submitLabel={m.manage.add} resetOnSuccess className="sm:grid sm:grid-cols-5 sm:items-end">
          <Field name="name" label={m.manage.name} required />
          <SelectField name="kind" label={m.manage.kind} options={kindOptions} defaultValue={spaces?.[0]?.kind ?? RESOURCE_KINDS[0]} />
          <Field name="capacity" label={m.manage.capacity} type="number" min={1} max={30} defaultValue={4} />
          <Field name="price" label={m.manage.pricePerHour} inputMode="decimal" />
          <Field name="slotMinutes" label={m.manage.slotMinutes} type="number" min={15} max={240} step={15} defaultValue={60} />
        </ActionForm>
      </section>
    </div>
  );
}

export default function SpacesPage({ params }: PageProps<"/manage/sections/[section]">) {
  return (
    <Suspense fallback={null}>
      <Spaces params={params} />
    </Suspense>
  );
}
