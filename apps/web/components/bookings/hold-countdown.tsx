"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { m } from "@/messages";

const mmss = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * How long a booking request is still held: "Slot held for 14:32" on its pay page, or "Pay to confirm — 14:32 left"
 * (`compact`, My bookings). It counts down each second; at 0 the full one says the hold ended, with a link to book
 * again. Shown only once the page is running in the browser (the server's clock would be a second off).
 */
export function HoldCountdown({ until, bookHref, compact = false }: { until: string; bookHref?: string; compact?: boolean }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Date.parse(until) - Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [until]);

  if (left === null) return null;
  if (compact) return <span>{left > 0 ? m.payments.payToConfirm(mmss(left)) : m.payments.holdEnded}</span>;
  if (left > 0) return <p className="font-semibold">{m.payments.heldFor(mmss(left))}</p>;
  return (
    <p role="status" className="font-semibold">
      {m.payments.holdEnded}{" "}
      {bookHref && (
        <Link href={bookHref} className="underline">
          {m.payments.bookAgain}
        </Link>
      )}
    </p>
  );
}
