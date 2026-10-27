import { m } from "@/messages";

/** Every public page while the brand (BRAND_SLUG) is missing or not live yet. */
export function NotOpen() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="font-display text-5xl uppercase tracking-wide">{m.site.notOpen}</h1>
      <p className="text-muted-foreground">{m.site.notOpenBody}</p>
    </main>
  );
}
