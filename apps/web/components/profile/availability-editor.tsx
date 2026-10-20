"use client";

import { FieldError } from "@/components/forms/action-form";
import { WEEKDAYS } from "@/lib/opening-hours";
import { m } from "@/messages";

export type AvailabilityValue = Partial<Record<string, { start: string; end: string }>>;

/** One row per weekday: a tick box plus usual start/end. Field names match parseProfileForm. */
export function AvailabilityEditor({ value }: { value: AvailabilityValue }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{m.profile.availability}</legend>
      {WEEKDAYS.map((d) => {
        const day = value[d];
        return (
          <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex w-32 items-center gap-1.5">
              <input type="checkbox" name={`avail.${d}.on`} defaultChecked={Boolean(day)} />
              {m.weekdays[Number(d)]}
            </label>
            <input type="time" name={`avail.${d}.start`} defaultValue={day?.start ?? "18:00"} className="rounded-md border border-input px-2 py-1" />
            <span>–</span>
            <input type="time" name={`avail.${d}.end`} defaultValue={day?.end ?? "22:00"} className="rounded-md border border-input px-2 py-1" />
            <FieldError name={`avail.${d}`} />
          </div>
        );
      })}
    </fieldset>
  );
}
