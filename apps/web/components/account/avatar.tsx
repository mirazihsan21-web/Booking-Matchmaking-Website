"use client";

import { useState } from "react";
import { cn } from "cn";
import { initials } from "@/lib/account/identity";

/**
 * A person's photo (Google's, sent without a referrer as Google asks), or their initials in a circle when
 * there is none or it fails to load.
 */
export function Avatar({ name, src, size = "sm", className }: { name: string; src: string | null; size?: "sm" | "lg"; className?: string }) {
  const [broken, setBroken] = useState(false);
  const box = cn("shrink-0 rounded-full", size === "lg" ? "size-16 text-xl" : "size-8 text-xs", className);
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- a remote profile photo; next/image would need the host configured
    return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={cn(box, "object-cover")} />;
  }
  return (
    <span aria-hidden className={cn(box, "flex items-center justify-center bg-raised font-semibold text-foreground")}>
      {initials(name)}
    </span>
  );
}
