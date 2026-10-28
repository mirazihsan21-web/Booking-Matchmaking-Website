import { Suspense } from "react";
import { cn } from "cn";
import { ActionButton, ActionForm } from "@/components/forms/action-form";
import { ActivityFields } from "@/components/manage/activity-fields";
import { createServiceClient } from "@/lib/service-client";
import { m } from "@/messages";
import { deleteActivityAction, saveActivityAction, setActivityActiveAction } from "../../actions";
import { ownerSection } from "../owner-section";

/** A section's games: each editable, switchable on/off and removable (unless games use it); add one. */
async function Games({ params }: { params: Promise<{ section: string }> }) {
  const { manager, section } = await ownerSection(params);
  const { data: games } = await createServiceClient()
    .from("activities")
    .select("id, name, team_mode, team_size, min_players, max_players, duration_min, active")
    .eq("organization_id", manager.org.id)
    .eq("section_id", section.id)
    .order("name");

  return (
    <div className="flex flex-col gap-4">
      {(games ?? []).map((a) => (
        <section key={a.id} className={cn("flex flex-col gap-3 rounded-xl border-l-[3px] border-section bg-card p-4", !a.active && "opacity-70")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold">{a.name}</h2>
            <span className="text-sm text-muted-foreground">
              {a.team_mode === "two_teams" ? m.manage.versus(a.team_size!) : m.manage.players(a.min_players, a.max_players)}
            </span>
            {!a.active && <span className="rounded-full bg-raised px-2 py-0.5 text-xs">{m.manage.inactive}</span>}
            <span className="ml-auto flex gap-2">
              <ActionButton action={setActivityActiveAction.bind(null, a.id, !a.active)} label={a.active ? m.manage.deactivate : m.manage.activate} variant="ghost" />
              <ActionButton action={deleteActivityAction.bind(null, a.id)} label={m.manage.delete} variant="ghost" />
            </span>
          </div>
          <ActionForm action={saveActivityAction.bind(null, section.id, a.id)} submitLabel={m.manage.save}>
            <ActivityFields
              defaults={{ name: a.name, teamMode: a.team_mode, teamSize: a.team_size, minPlayers: a.min_players, maxPlayers: a.max_players, durationMin: a.duration_min }}
            />
          </ActionForm>
        </section>
      ))}
      <section className="flex flex-col gap-3 rounded-xl bg-card p-4">
        <h2 className="font-display text-2xl uppercase tracking-wide">{m.manage.sectionsPage.addGame}</h2>
        <ActionForm action={saveActivityAction.bind(null, section.id, null)} submitLabel={m.manage.add} resetOnSuccess>
          <ActivityFields />
        </ActionForm>
      </section>
    </div>
  );
}

export default function GamesPage({ params }: PageProps<"/manage/sections/[section]/games">) {
  return (
    <Suspense fallback={null}>
      <Games params={params} />
    </Suspense>
  );
}
