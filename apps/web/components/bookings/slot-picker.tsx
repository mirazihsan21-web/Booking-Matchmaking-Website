"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { cn } from "cn";
import { ActionForm, FieldError, type FormAction } from "@/components/forms/action-form";
import { SlotChip, slotChipClass } from "@/components/site/slot-chip";
import { buttonVariants } from "@/components/ui/button";
import type { SlotState } from "@/lib/bookings/slots";
import { m } from "@/messages";

const KEY_STATES: SlotState[] = ["free", "taken", "open_play", "past"];
const BAR = "sticky bottom-20 z-20 flex-wrap rounded-xl border border-border bg-raised/95 p-3 backdrop-blur md:bottom-4";

type Slot = { start: string; label: string; state: SlotState };

/**
 * A day's slots as chips: free ones can be picked as the start; taken, open-play and started ones are
 * shown but disabled, with a key beneath saying what each look means (each chip points screen readers at
 * its word). The picked slot, how long, the price and **Book** sit in a bar stuck to the bottom. Submits
 * `startsAt` (ISO) and `slots` (1–4) to the booking action.
 *
 * With `blocked` (a visitor who isn't signed in, or has no profile yet) the grid is the same, but the bar
 * links to `blocked.href` instead of booking.
 */
export function SlotPicker({
  action,
  blocked,
  slots,
  slotMinutes,
  priceLabel,
}: {
  action: FormAction;
  blocked?: { href: string; label: string } | null;
  slots: Slot[];
  slotMinutes: number;
  priceLabel: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const keyId = useId();
  if (slots.length === 0) return <p className="text-muted-foreground">{m.bookings.closed}</p>;
  // Only a slot that is still free stays picked: once it is booked (by you or anyone) the refresh shows it taken.
  const pickedSlot = slots.find((s) => s.start === picked && s.state === "free");

  const grid = (
    <>
      <fieldset className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <legend className="sr-only">{m.bookings.pickSlot}</legend>
        {slots.map((slot) => (
          <SlotChip
            key={slot.start}
            label={slot.label}
            value={slot.start}
            state={slot.start === pickedSlot?.start ? "selected" : slot.state}
            describedBy={`${keyId}-${slot.state}`}
            onClick={() => setPicked(slot.start)}
          />
        ))}
      </fieldset>
      <SlotKey idBase={keyId} />
    </>
  );
  const summary = (extra?: ReactNode) => (
    <div className="flex flex-1 flex-wrap items-center gap-3 text-sm">
      <span className="font-semibold">{pickedSlot?.label ?? m.bookings.pickSlot}</span>
      {extra}
      <span className="text-muted-foreground">{priceLabel}</span>
    </div>
  );

  if (blocked) {
    return (
      <div className="flex flex-col gap-4">
        {grid}
        <div className={cn("flex items-center gap-3", BAR)}>
          {summary()}
          <Link href={blocked.href} className={cn(buttonVariants({ variant: "section" }), "press")}>
            {blocked.label}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ActionForm
      action={action}
      submitLabel={m.bookings.book}
      variant="section"
      footerClassName={BAR}
      footer={summary(
        <label className="flex items-center gap-2 text-muted-foreground">
          {m.bookings.howLong}
          <select name="slots" defaultValue="1" className="h-8 rounded-lg border border-input bg-card px-2 text-foreground">
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {m.bookings.slots(n, slotMinutes)}
              </option>
            ))}
          </select>
        </label>,
      )}
    >
      <input type="hidden" name="startsAt" value={pickedSlot?.start ?? ""} />
      {grid}
      <FieldError name="startsAt" />
    </ActionForm>
  );
}

/** What each slot look means: Free, Taken, Open play, Started. Each word's id is `${idBase}-${state}`. */
function SlotKey({ idBase }: { idBase: string }) {
  return (
    <ul aria-label={m.bookings.keyLabel} className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {KEY_STATES.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("px-1.5 py-0.5 text-[11px]", slotChipClass(state))}>
            {m.bookings.keySample}
          </span>
          <span id={`${idBase}-${state}`}>{m.bookings.states[state]}</span>
        </li>
      ))}
    </ul>
  );
}
