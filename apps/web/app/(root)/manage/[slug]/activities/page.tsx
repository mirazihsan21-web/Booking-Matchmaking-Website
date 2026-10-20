import { Suspense } from "react";
import { ActionButton, ActionForm } from "@/components/forms/action-form";
import { ActivityFields } from "@/components/manage/activity-fields";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";
import { getPreset } from "@/presets";
import { deleteActivityAction, saveActivityAction, setActivityActiveAction } from "../actions";

async function Activities({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await requireOrgRole(slug, "owner");
  const { labels } = getPreset(org.businessType);
  const supabase = await createClient();
  const { data: activities } = await supabase
    .from("activities")
    .select("id, name, team_mode, team_size, min_players, max_players, duration_min, active")
    .eq("organization_id", org.id)
    .order("name");

  return (
    <div className="flex flex-col gap-4">
      {(activities ?? []).map((a) => (
        <Card key={a.id} className={a.active ? undefined : "opacity-60"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {a.name}
              <Badge variant="outline">
                {a.team_mode === "two_teams" ? m.manage.versus(a.team_size!) : m.manage.players(a.min_players, a.max_players)}
              </Badge>
              {!a.active && <Badge variant="secondary">{m.manage.inactive}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ActionForm action={saveActivityAction.bind(null, org.slug, a.id)} submitLabel={m.manage.save}>
              <ActivityFields
                defaults={{
                  name: a.name,
                  teamMode: a.team_mode,
                  teamSize: a.team_size,
                  minPlayers: a.min_players,
                  maxPlayers: a.max_players,
                  durationMin: a.duration_min,
                }}
              />
            </ActionForm>
            <div className="flex flex-wrap gap-2">
              <ActionButton
                action={setActivityActiveAction.bind(null, org.slug, a.id, !a.active)}
                label={a.active ? m.manage.deactivate : m.manage.activate}
              />
              <ActionButton action={deleteActivityAction.bind(null, org.slug, a.id)} label={m.manage.delete} variant="destructive" />
            </div>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>
            {m.manage.add} {labels.activity}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveActivityAction.bind(null, org.slug, null)} submitLabel={m.manage.add} resetOnSuccess>
            <ActivityFields />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ActivitiesPage({ params }: PageProps<"/manage/[slug]/activities">) {
  return (
    <Suspense fallback={null}>
      <Activities params={params} />
    </Suspense>
  );
}
