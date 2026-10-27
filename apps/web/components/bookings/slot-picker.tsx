"use client";

import { useState } from "react";
import { ActionForm, FieldError, type FormAction } from "@/components/forms/action-form";
import { SlotChip } from "@/components/site/slot-chip";
import type { SlotState } from "@/lib/bookings/slots";
import { m } from "@/messages";

/**
 * A day's slots as chips: free ones can be picked as the start; taken, open-play and started ones are
 * shown but disabled. The picked slot, how long, the price and **Book** sit in a bar stuck to the bottom.
 * Submits `startsAt` (ISO) and `slots` (1–4) to the booking action.
 */
export function SlotPicker({
  action,
  slots,
  slotMinutes,
  priceLabel,
}: {
  action: FormAction;
  slots: Array<{ start: string; label: string; state: SlotState }>;
  slotMinutes: number;
  priceLabel: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  if (slots.length === 0) return <p className="text-muted-foreground">{m.bookings.closed}</p>;
  // Only a slot that is still free stays picked: once it is booked (by you or anyone) the refresh shows it taken.
  const pickedSlot = slots.find((s) => s.start === picked && s.state === "free");

  return (
    <ActionForm
      action={action}
      submitLabel={m.bookings.book}
      variant="section"
      footerClassName="sticky bottom-20 z-20 flex-wrap rounded-xl border border-border bg-raised/95 p-3 backdrop-blur md:bottom-4"
      footer={
        <div className="flex flex-1 flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold">{pickedSlot?.label ?? m.bookings.pickSlot}</span>
          <label className="flex items-center gap-2 text-muted-foreground">
            {m.bookings.howLong}
            <select name="slots" defaultValue="1" className="h-8 rounded-lg border border-input bg-card px-2 text-foreground">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {m.bookings.slots(n, slotMinutes)}
                </option>
              ))}
            </select>
          </label>
          <span className="text-muted-foreground">{priceLabel}</span>
        </div>
      }
    >
      <input type="hidden" name="startsAt" value={pickedSlot?.start ?? ""} />
      <fieldset className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <legend className="sr-only">{m.bookings.pickSlot}</legend>
        {slots.map((slot) => (
          <SlotChip key={slot.start} label={slot.label} state={slot.start === pickedSlot?.start ? "selected" : slot.state} onClick={() => setPicked(slot.start)} />
        ))}
      </fieldset>
      <FieldError name="startsAt" />
    </ActionForm>
  );
}
