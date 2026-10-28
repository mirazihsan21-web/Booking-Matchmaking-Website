import Link from "next/link";
import { m } from "@/messages";

/** Shown on Today while the brand isn't live: the owner gets the way to publish it. */
export function NotLiveBanner({ isOwner }: { isOwner: boolean }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/40 bg-raised px-4 py-3 text-sm">
      <span className="font-semibold text-warning">{m.manage.today.notLive}</span>
      {isOwner && (
        <Link href="/manage/brand" className="underline underline-offset-4 hover:text-foreground">
          {m.manage.today.publishLink}
        </Link>
      )}
    </p>
  );
}
