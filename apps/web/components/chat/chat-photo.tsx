"use client";

import { useEffect, useState } from "react";
import { signedPhotoUrls } from "@/lib/chat/photos";
import { createClient } from "@/lib/supabase/client";
import { m } from "@/messages";

/**
 * A chat photo, shown through a short-lived link the bucket's row rules allow only to people who may see its
 * message. Tapping opens it full size. A photo that can't be linked (deleted since, or not yours to see) says so,
 * rather than leaving an empty space.
 */
export function ChatPhoto({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined); // undefined while asking
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    signedPhotoUrls(createClient(), [path]).then(
      (urls) => {
        if (live) setUrl(urls.get(path) ?? null);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [path]);

  if (url === undefined) return null;
  if (url === null) return <p className="text-sm italic text-muted-foreground">{m.chat.photo.gone}</p>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={m.chat.photo.open} className="self-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed link to a private photo; next/image can't cache it */}
        <img src={url} alt={alt} className="max-h-64 max-w-full rounded-lg object-contain" />
      </button>
      {open && (
        <button type="button" onClick={() => setOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- the same photo, full size */}
          <img src={url} alt="" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </>
  );
}
