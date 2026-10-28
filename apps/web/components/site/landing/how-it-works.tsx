import { m } from "@/messages";

/** Three steps, in order, from signing in to playing. */
export function HowItWorks() {
  return (
    <section className="flex flex-col gap-8">
      <h2 className="font-display text-4xl uppercase tracking-wide">{m.site.landing.howTitle}</h2>
      <ol className="grid gap-8 md:grid-cols-3 md:gap-10">
        {m.site.landing.steps.map((step, i) => (
          <li key={step.title} className="flex gap-4 md:flex-col md:gap-3">
            <span aria-hidden className="font-display text-6xl leading-none text-muted-foreground">
              {i + 1}
            </span>
            <div>
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="mt-1 text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
