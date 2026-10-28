import { KeyRound, Scale, Wallet, Zap, type LucideIcon } from "lucide-react";
import { m } from "@/messages";

const ICONS: LucideIcon[] = [Scale, Zap, Wallet, KeyRound];

/** The four reasons to play here, each with its icon. */
export function WhyPlayHere() {
  return (
    <section className="flex flex-col gap-8">
      <h2 className="font-display text-4xl uppercase tracking-wide">{m.site.landing.whyTitle}</h2>
      <ul className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
        {m.site.landing.why.map((point, i) => {
          const Icon = ICONS[i] ?? Scale;
          return (
            <li key={point.title} className="flex gap-4">
              <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-lg bg-raised">
                <Icon className="size-5" />
              </span>
              <div>
                <h3 className="text-lg font-semibold">{point.title}</h3>
                <p className="mt-1 text-muted-foreground">{point.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
