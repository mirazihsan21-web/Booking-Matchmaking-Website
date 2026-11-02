import { cn } from "cn";
import type { SlotState } from "@/lib/bookings/slots";

/** How a slot looks in each state (the grid's chips and the key beneath it share it). */
export function slotChipClass(state: SlotState | "selected"): string {
  return cn(
    "rounded-lg border text-xs font-semibold",
    state === "selected" && "border-section bg-section text-on-section",
    state === "free" && "border-border bg-card text-foreground hover:border-section",
    state === "taken" && "cursor-not-allowed border-transparent bg-background text-muted-foreground/70 line-through",
    state === "open_play" && "cursor-not-allowed border-dashed border-section/60 bg-background text-section",
    state === "past" && "cursor-not-allowed border-transparent bg-background text-muted-foreground/50",
  );
}

/**
 * A time slot on the booking grid: free, taken (struck out), open play, past, or the one picked (filled + ✓).
 * `describedBy` points at the key's word for its state, so screen readers hear "8pm–9pm, Taken"; `value` is
 * the slot's start (ISO).
 */
export function SlotChip({
  label,
  state,
  value,
  describedBy,
  onClick,
}: {
  label: string;
  state: SlotState | "selected";
  value?: string;
  describedBy?: string;
  onClick?: () => void;
}) {
  const free = state === "free" || state === "selected";
  return (
    <button
      type="button"
      value={value}
      onClick={free ? onClick : undefined}
      disabled={!free}
      aria-pressed={state === "selected"}
      aria-describedby={describedBy}
      className={cn("press px-2 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-section", slotChipClass(state))}
    >
      {label}
      {state === "selected" && " ✓"}
    </button>
  );
}
