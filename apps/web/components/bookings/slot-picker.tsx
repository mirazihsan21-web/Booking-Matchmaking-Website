import { ActionForm, FieldError, SelectField, type FormAction } from "@/components/forms/action-form";
import type { SlotState } from "@/lib/bookings/slots";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

/**
 * A day's slots as buttons: free ones can be picked as the start; taken, open-play and started ones
 * are shown but disabled. Submits `startsAt` (ISO) and `slots` (1–4) to the booking action.
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
  if (slots.length === 0) return <p className="text-foreground/60">{m.bookings.closed}</p>;
  return (
    <ActionForm action={action} submitLabel={m.bookings.book}>
      <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <legend className="sr-only">{m.bookings.pickSlot}</legend>
        {slots.map((slot) => {
          const free = slot.state === "free";
          return (
            <label key={slot.start} className={cn("relative", !free && "cursor-not-allowed")}>
              <input type="radio" name="startsAt" value={slot.start} disabled={!free} required className="peer sr-only" />
              <span
                className={cn(
                  "flex flex-col rounded-lg border border-border px-3 py-2 text-sm",
                  free ? "cursor-pointer hover:border-primary peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground" : "bg-foreground/5 text-foreground/40",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-primary",
                )}
              >
                <span className="font-medium">{slot.label}</span>
                <span className="text-xs">{m.bookings.states[slot.state]}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <FieldError name="startsAt" />
      <div className="flex flex-wrap items-end gap-4">
        <SelectField
          name="slots"
          label={m.bookings.howLong}
          options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: m.bookings.slots(n, slotMinutes) }))}
          defaultValue="1"
        />
        <p className="pb-2 text-sm text-foreground/70">{priceLabel}</p>
      </div>
    </ActionForm>
  );
}
