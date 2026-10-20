import { m } from "@/messages";

/** Shown for unknown hosts, missing pages, and venues that aren't live. */
export function Unavailable() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-3xl font-semibold">{m.unavailable.title}</h1>
      <p className="text-foreground/70">{m.unavailable.body}</p>
    </main>
  );
}
