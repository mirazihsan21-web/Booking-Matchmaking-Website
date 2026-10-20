"use client";

import { useEffect, useRef } from "react";

/** Marks the inbox read once, when the notifications page is opened. */
export function MarkAllRead({ action }: { action: () => Promise<void> }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void action();
  }, [action]);
  return null;
}
