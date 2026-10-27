import { cn } from "cn";
import type { SlotState } from "@/lib/bookings/slots";

/** A time slot on the booking grid: free, taken (struck out), open play, past, or the one picked (filled + ✓). */
export function SlotChip({
  label,
  state,
  onClick,
}: {
  label: string;
  state: SlotState | "selected";
  onClick?: () => void;
}) {
  const free = state === "free" || state === "selected";
  return (
    <button
      type="button"
      onClick={free ? onClick : undefined}
      disabled={!free}
      aria-pressed={state === "selected"}
      className={cn(
        "press rounded-lg border px-2 py-2.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-section",
        state === "selected" && "border-section bg-section text-on-section",
        state === "free" && "border-border bg-card text-foreground hover:border-section",
        state === "taken" && "cursor-not-allowed border-transparent bg-background text-muted-foreground/70 line-through",
        state === "open_play" && "cursor-not-allowed border-dashed border-section/60 bg-background text-section",
        state === "past" && "cursor-not-allowed border-transparent bg-background text-muted-foreground/50",
      )}
    >
      {label}
      {state === "selected" && " ✓"}
    </button>
  );
}
