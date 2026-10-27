import { cn } from "cn";
import { clockLabel, type OpenStatus } from "@/lib/site/hours";
import { m } from "@/messages";

/** "Open till 11 PM" (with a soft blinking dot), "Opens at 10 AM" or "Closed today". */
export function StatusPill({ status, className }: { status: OpenStatus; className?: string }) {
  const label =
    status.state === "open" ? m.site.openUntil(clockLabel(status.until)) : status.state === "later" ? m.site.opensAt(clockLabel(status.opens)) : m.site.closedToday;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-xs font-semibold text-foreground/85", className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", status.state === "open" ? "blink bg-section" : "bg-muted-foreground")} />
      {label}
    </span>
  );
}
