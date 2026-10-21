"use client";

import { useEffect, useState } from "react";
import { m } from "@/messages";

const minutesUntil = (until: string) => Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000));

/** "12 minutes left", counting down while the page is open. */
export function MinutesLeft({ until }: { until: string }) {
  const [minutes, setMinutes] = useState(() => minutesUntil(until));
  useEffect(() => {
    const timer = setInterval(() => setMinutes(minutesUntil(until)), 15_000);
    return () => clearInterval(timer);
  }, [until]);
  return <span suppressHydrationWarning>{m.openPlay.minutesLeft(minutes)}</span>;
}
