import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ActionButton, ActionForm, Field, SelectField } from "@/components/forms/action-form";
import { sectionStyle } from "@/components/site/section-style";
import { localDayAndMinutes } from "@/lib/schedule/time";
import { loadSections } from "@/lib/sections/sections";
import { clockLabel } from "@/lib/site/hours";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";
import { addSectionAction, deleteSectionAction } from "./actions";

const kindOptions = Object.entries(m.manage.sectionKinds).map(([value, label]) => ({ value, label }));

/** The brand's sections, each opening its setup; add a section; remove one that nothing uses. */
async function Sections() {
  const { org } = await requireManager("owner");
  const db = createServiceClient();
  const [sections, { data: spaces }, { data: games }] = await Promise.all([
    loadSections(db, org.id),
    db.from("resources").select("section_id").eq("organization_id", org.id).eq("active", true),
    db.from("activities").select("section_id").eq("organization_id", org.id).eq("active", true),
  ]);
  const count = (rows: Array<{ section_id: string }> | null, id: string) => (rows ?? []).filter((r) => r.section_id === id).length;
  const weekday = String(localDayAndMinutes(new Date(), org.timezone).weekday) as keyof (typeof sections)[number]["openingHours"];
  const p = m.manage.sectionsPage;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-4xl uppercase tracking-wide">{p.title}</h1>
      <ul className="flex flex-col gap-3">
        {sections.map((s) => {
          const hours = s.openingHours[weekday];
          return (
            <li key={s.id} style={sectionStyle(s.accent)} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border-l-[3px] border-section bg-card px-4 py-3">
              <Link href={`/manage/sections/${s.slug}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-display text-2xl uppercase tracking-wide text-section">{s.name}</span>
                <span className="text-sm text-muted-foreground">{p.counts(count(spaces, s.id), count(games, s.id))}</span>
                <span className="text-sm text-muted-foreground">{hours ? p.todayHours(`${clockLabel(hours[0])} – ${clockLabel(hours[1])}`) : p.closedToday}</span>
                <ChevronRight aria-hidden className="ml-auto size-5 text-muted-foreground" />
              </Link>
              <ActionButton action={deleteSectionAction.bind(null, s.id)} label={p.remove} variant="ghost" />
            </li>
          );
        })}
      </ul>
      <section className="flex max-w-xl flex-col gap-3 rounded-xl bg-card p-5">
        <h2 className="font-display text-2xl uppercase tracking-wide">{m.manage.addSection}</h2>
        <p className="text-sm text-muted-foreground">{m.manage.addSectionIntro}</p>
        <ActionForm action={addSectionAction} submitLabel={m.manage.add} resetOnSuccess>
          <SelectField name="kind" label={m.manage.sectionKind} options={kindOptions} />
          <Field name="name" label={m.manage.name} required />
        </ActionForm>
      </section>
    </div>
  );
}

export default function SectionsPage() {
  return (
    <Suspense fallback={null}>
      <Sections />
    </Suspense>
  );
}
