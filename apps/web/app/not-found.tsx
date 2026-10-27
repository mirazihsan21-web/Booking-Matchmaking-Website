import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { m } from "@/messages";

/** Unknown addresses and unknown sections. */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="font-display text-5xl uppercase tracking-wide">{m.site.notFound}</h1>
      <p className="text-muted-foreground">{m.site.notFoundBody}</p>
      <Link href="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
        {m.site.backHome}
      </Link>
    </main>
  );
}
