import Link from "next/link";
import { m } from "@/messages";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="flex max-w-2xl flex-col items-center gap-6 text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-primary">{m.platform.name}</h1>
        <p className="text-xl text-foreground/80">{m.platform.tagline}</p>
        <p className="text-base text-foreground/60">{m.platform.businessTypes}</p>
        <div className="flex gap-4">
          <Link href="/onboarding" className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:bg-primary/90">
            {m.platform.createVenue}
          </Link>
          <Link href="/manage" className="rounded-lg border border-border px-5 py-2.5 font-medium hover:bg-muted">
            {m.platform.signIn}
          </Link>
        </div>
      </div>
    </main>
  );
}
