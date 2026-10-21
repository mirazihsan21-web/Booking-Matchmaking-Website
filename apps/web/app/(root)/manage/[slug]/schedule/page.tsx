import Link from "next/link";
import { Suspense } from "react";
import { ActionButton, ActionForm, Field, FieldError, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNight } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";
import { getPreset } from "@/presets";
import { cancelSessionAction, scheduleAction } from "./actions";

async function Schedule({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await requireOrgRole(slug, "staff");
  const preset = getPreset(org.businessType);
  const supabase = await createClient();
  const [{ data: branches }, { data: resources }, { data: activities }, { data: sessions }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("organization_id", org.id).order("created_at"),
    supabase.from("resources").select("id, name, branch_id").eq("organization_id", org.id).eq("active", true).order("name"),
    supabase.from("activities").select("id, name, duration_min").eq("organization_id", org.id).eq("active", true).order("name"),
    supabase
      .from("open_play_sessions")
      .select("id, starts_at, seat_price_poisha, status, activities(name), open_play_session_resources(resources(name))")
      .eq("organization_id", org.id)
      .gte("starts_at", new Date().toISOString())
      .neq("status", "cancelled")
      .order("starts_at")
      .limit(50),
  ]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="capitalize">{preset.labels.sessionPlural}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(sessions ?? []).length === 0 && <p className="text-sm text-foreground/60">{m.schedule.none}</p>}
          {(sessions ?? []).map((s) => {
            const activity = (s.activities as unknown as { name: string } | null)?.name ?? m.schedule.playersChoose;
            const where = (s.open_play_session_resources as unknown as Array<{ resources: { name: string } }>).map((r) => r.resources.name).join(", ");
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-3 border-b border-border pb-2 text-sm last:border-0">
                <Link href={`/manage/${org.slug}/sessions/${s.id}`} className="w-40 font-medium text-primary hover:underline">
                  {formatNight(s.starts_at, org.timezone)}
                </Link>
                <span>{activity}</span>
                {s.status !== "open" && <Badge>{m.staffSession.status[s.status] ?? s.status}</Badge>}
                <span className="text-foreground/60">{where}</span>
                <Badge variant="outline">{formatBdt(s.seat_price_poisha)}</Badge>
                <ActionButton action={cancelSessionAction.bind(null, org.slug, s.id)} label={m.schedule.cancel} variant="ghost" />
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{m.schedule.add}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={scheduleAction.bind(null, org.slug)} submitLabel={m.schedule.submit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField name="branchId" label={m.manage.branch} options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
              <SelectField
                name="activityId"
                label={preset.labels.activity}
                options={[{ value: "", label: m.schedule.playersChoose }, ...(activities ?? []).map((a) => ({ value: a.id, label: a.name }))]}
              />
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium capitalize">{preset.labels.resourcePlural}</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                {(resources ?? []).map((r) => (
                  <label key={r.id} className="flex items-center gap-1.5">
                    <input type="checkbox" name="resourceIds" value={r.id} />
                    {r.name} <span className="text-foreground/50">({branchName.get(r.branch_id)})</span>
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
              <Field name="seatPrice" label={m.schedule.seatPrice} inputMode="decimal" defaultValue={String(preset.seatPricePoisha / 100)} />
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SchedulePage({ params }: PageProps<"/manage/[slug]/schedule">) {
  return (
    <Suspense fallback={null}>
      <Schedule params={params} />
    </Suspense>
  );
}
