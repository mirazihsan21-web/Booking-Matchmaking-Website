import Link from "next/link";
import { Suspense } from "react";
import { ActionButton, ActionForm, Field, FieldError, SelectField } from "@/components/forms/action-form";
import { sectionStyle } from "@/components/site/section-style";
import { formatNight } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { loadSections } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";
import { cancelSessionAction, scheduleAction } from "./actions";

/** Open games coming up in the sections this person runs, by section, and the form to schedule more. */
async function Schedule() {
  const manager = await requireManager("staff");
  const { org } = manager;
  const db = createServiceClient();
  const allowed = manager.sectionIds;
  if (allowed.length === 0) return <p className="text-muted-foreground">{m.manage.noSections}</p>;
  const [all, { data: resources }, { data: activities }, { data: sessions }] = await Promise.all([
    loadSections(db, org.id),
    db.from("resources").select("id, name, section_id").eq("organization_id", org.id).in("section_id", allowed).eq("active", true).order("name"),
    db.from("activities").select("id, name, duration_min, section_id").eq("organization_id", org.id).in("section_id", allowed).eq("active", true).order("name"),
    db
      .from("open_play_sessions")
      .select("id, section_id, starts_at, seat_price_poisha, status, activities(name), open_play_session_resources(resources(name))")
      .eq("organization_id", org.id)
      .in("section_id", allowed)
      .gte("starts_at", new Date().toISOString())
      .neq("status", "cancelled")
      .order("starts_at")
      .limit(50),
  ]);
  const sections = all.filter((s) => allowed.includes(s.id));
  const sectionName = new Map(sections.map((s) => [s.id, s.name]));
  const p = m.manage.schedulePage;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-4xl uppercase tracking-wide">{p.title}</h1>
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl uppercase tracking-wide">{p.upcoming}</h2>
        {(sessions ?? []).length === 0 && <p className="text-muted-foreground">{m.schedule.none}</p>}
        {sections.map((section) => {
          const mine = (sessions ?? []).filter((s) => s.section_id === section.id);
          if (mine.length === 0) return null;
          return (
            <div key={section.id} style={sectionStyle(section.accent)} className="flex flex-col gap-2">
              <h3 className="font-display text-xl uppercase tracking-wide text-section">{section.name}</h3>
              <ul className="flex flex-col gap-2">
                {mine.map((s) => {
                  const game = (s.activities as unknown as { name: string } | null)?.name ?? m.schedule.playersChoose;
                  const where = (s.open_play_session_resources as unknown as Array<{ resources: { name: string } }>).map((r) => r.resources.name).join(", ");
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border-l-[3px] border-section bg-card px-4 py-3 text-sm">
                      <Link href={`/manage/games/${s.id}`} className="w-40 font-semibold underline-offset-4 hover:underline">
                        {formatNight(s.starts_at, org.timezone)}
                      </Link>
                      <span className="font-semibold">{game}</span>
                      <span className="text-muted-foreground">{where}</span>
                      <span className="rounded-full bg-raised px-2 py-0.5 text-xs">{formatBdt(s.seat_price_poisha)}</span>
                      {s.status !== "open" && <span className="rounded-full bg-section px-2 py-0.5 text-xs font-semibold text-on-section">{m.staffSession.status[s.status] ?? s.status}</span>}
                      <span className="ml-auto">
                        <ActionButton action={cancelSessionAction.bind(null, s.id)} label={m.schedule.cancel} variant="ghost" />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-4 rounded-xl bg-card p-4 sm:p-5">
        <h2 className="font-display text-2xl uppercase tracking-wide">{m.schedule.add}</h2>
        <ActionForm action={scheduleAction} submitLabel={m.schedule.submit} variant="default" className="gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField name="sectionId" label={m.manage.section} options={sections.map((s) => ({ value: s.id, label: s.name }))} />
            <SelectField
              name="activityId"
              label={p.game}
              options={[{ value: "", label: m.schedule.playersChoose }, ...(activities ?? []).map((a) => ({ value: a.id, label: `${a.name} (${sectionName.get(a.section_id)})` }))]}
            />
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">{p.spaces}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {(resources ?? []).map((r) => (
                <label key={r.id} className="flex items-center gap-1.5">
                  <input type="checkbox" name="resourceIds" value={r.id} className="size-4 accent-foreground" />
                  {r.name} <span className="text-muted-foreground">({sectionName.get(r.section_id)})</span>
                </label>
              ))}
            </div>
            <FieldError name="resourceIds" />
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-5">
            <Field name="date" label={m.schedule.date} type="date" required />
            <Field name="time" label={m.schedule.time} type="time" defaultValue="20:00" required />
            <Field name="durationMin" label={m.manage.duration} type="number" min={15} max={600} defaultValue={activities?.[0]?.duration_min ?? 60} />
            <Field name="weeks" label={m.schedule.weeks} type="number" min={1} max={12} defaultValue={1} />
            <Field name="seatPrice" label={m.schedule.seatPrice} inputMode="decimal" defaultValue="300" />
          </div>
        </ActionForm>
      </section>
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={null}>
      <Schedule />
    </Suspense>
  );
}
