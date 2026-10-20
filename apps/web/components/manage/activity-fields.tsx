"use client";

import { useState } from "react";
import { Field, SelectField } from "@/components/forms/action-form";
import { m } from "@/messages";

export interface ActivityDefaults {
  name: string;
  teamMode: "none" | "two_teams";
  teamSize: number | null;
  minPlayers: number;
  maxPlayers: number;
  durationMin: number;
}

/** Two teams → ask for players per team; free-for-all → ask for min and max players. */
export function ActivityFields({ defaults }: { defaults?: ActivityDefaults }) {
  const [mode, setMode] = useState(defaults?.teamMode ?? "none");
  return (
    <>
      <Field name="name" label={m.manage.name} defaultValue={defaults?.name} required />
      <div
        onChange={(e) => {
          const target = e.target;
          if (target instanceof HTMLSelectElement && target.name === "teamMode") setMode(target.value as typeof mode);
        }}
      >
        <SelectField
          name="teamMode"
          label={m.manage.teamMode}
          defaultValue={mode}
          options={[
            { value: "none", label: m.manage.teamModes.none! },
            { value: "two_teams", label: m.manage.teamModes.two_teams! },
          ]}
        />
      </div>
      {mode === "two_teams" ? (
        <Field name="teamSize" label={m.manage.teamSize} type="number" min={1} max={15} defaultValue={defaults?.teamSize ?? 5} />
      ) : (
        <>
          <Field name="minPlayers" label={m.manage.minPlayers} type="number" min={1} max={30} defaultValue={defaults?.minPlayers ?? 2} />
          <Field name="maxPlayers" label={m.manage.maxPlayers} type="number" min={1} max={30} defaultValue={defaults?.maxPlayers ?? 4} />
        </>
      )}
      <Field name="durationMin" label={m.manage.duration} type="number" min={5} max={600} defaultValue={defaults?.durationMin ?? 60} />
    </>
  );
}
