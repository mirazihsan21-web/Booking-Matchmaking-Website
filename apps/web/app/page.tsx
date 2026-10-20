import { m } from "@/messages";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="flex max-w-2xl flex-col items-center gap-6 text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-primary">{m.platform.name}</h1>
        <p className="text-xl text-foreground/80">{m.platform.tagline}</p>
        <p className="text-base text-foreground/60">{m.platform.businessTypes}</p>
      </div>
    </main>
  );
}
