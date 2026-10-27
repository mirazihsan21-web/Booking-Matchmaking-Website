import { cn } from "cn";
import { seatsLevel } from "@/lib/site/seats";
import { m } from "@/messages";

/** How full a game is: a bar in the section colour (amber when almost full) and "7 of 10 in · 3 seats left". */
export function SeatsBar({ left, total, className }: { left: number; total: number; className?: string }) {
  const level = seatsLevel(left);
  const taken = Math.max(0, total - left);
  const share = total > 0 ? Math.min(100, Math.round((taken / total) * 100)) : 0;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {total > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className={cn("fill h-full rounded-full", level === "plenty" ? "bg-section" : level === "low" ? "bg-warning" : "bg-muted-foreground")} style={{ width: `${share}%` }} />
        </div>
      )}
      <p className={cn("text-xs", level === "plenty" ? "text-muted-foreground" : "font-semibold text-warning")}>
        {level === "full" ? m.site.full : total > 0 ? `${m.site.seats(taken, total)} · ${m.site.left(left)}` : m.site.left(left)}
      </p>
    </div>
  );
}
