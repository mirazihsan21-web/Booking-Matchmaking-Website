import Link from "next/link";
import { Suspense } from "react";
import { NotLiveBanner } from "@/components/manage/not-live-banner";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

/** Today, the desk screen (built in the next task; for now the live-status banner and a way to the bookings). */
async function Today() {
  const manager = await requireManager("staff");
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl uppercase tracking-wide">{m.manage.today.title}</h1>
      {manager.org.status !== "live" && <NotLiveBanner isOwner={manager.role === "owner"} />}
      <Link href="/manage/bookings" className="underline underline-offset-4">
        {m.manage.nav.bookings}
      </Link>
    </div>
  );
}

export default function TodayPage() {
  return (
    <Suspense fallback={null}>
      <Today />
    </Suspense>
  );
}
