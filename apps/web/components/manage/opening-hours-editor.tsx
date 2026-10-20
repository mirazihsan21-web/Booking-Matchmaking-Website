"use client";

import { FieldError } from "@/components/forms/action-form";
import { WEEKDAYS, type OpeningHours } from "@/lib/opening-hours";
import { m } from "@/messages";

/** Seven rows of open/close times with a "closed" box. Field names match parseOpeningHours. */
export function OpeningHoursEditor({ value }: { value: OpeningHours }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{m.manage.openingHours}</legend>
      {WEEKDAYS.map((d) => {
        const day = value[d];
        return (
          <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24">{m.weekdays[Number(d)]}</span>
            <input type="time" name={`hours.${d}.open`} defaultValue={day?.[0] ?? "10:00"} className="rounded-md border border-input px-2 py-1" />
            <span>–</span>
            <input type="time" name={`hours.${d}.close`} defaultValue={day?.[1] ?? "23:00"} className="rounded-md border border-input px-2 py-1" />
            <label className="flex items-center gap-1">
              <input type="checkbox" name={`hours.${d}.closed`} defaultChecked={day === null} />
              {m.manage.closed}
            </label>
            <FieldError name={`hours.${d}`} />
          </div>
        );
      })}
    </fieldset>
  );
}
