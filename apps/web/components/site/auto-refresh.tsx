"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page from the server every `seconds` while the tab is visible, so seats and games stay current. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return null;
}
