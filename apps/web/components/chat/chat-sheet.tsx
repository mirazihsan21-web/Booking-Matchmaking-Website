"use client";

import { X } from "lucide-react";
import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { m } from "@/messages";

/**
 * A chat pop-up (a player's panel, a message's menu). Mount it to open it, and drop it when `onClose` runs.
 * It opens as a modal <dialog>, so nothing behind it — the scrolling list, the page edge — can cut it off:
 * a sheet along the bottom on a phone, a card in the middle on a wider screen. It closes with its Close
 * button, Escape, or a tap outside, and the browser puts the focus back on what opened it.
 */
export function ChatSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    // Gone, or hidden — a client navigation (Message, the phone's Back) keeps the old page hidden — it closes:
    // a modal left open on a hidden page would block every tap on the new one.
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      // Only a real close counts: in development React mounts twice, and the first close lands after the reopen.
      onClose={() => {
        if (!dialog.current?.open) onClose();
      }}
      // A tap on the dimmed backdrop lands on the dialog itself; the content fills the dialog, so taps inside never do.
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className="mx-0 mb-0 mt-auto w-full max-w-full rounded-t-2xl border border-b-0 border-border bg-card p-0 text-foreground backdrop:bg-black/50 sm:m-auto sm:w-[min(22rem,calc(100vw-2rem))] sm:rounded-2xl sm:border-b"
    >
      <div className="flex flex-col gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="truncate text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label={m.chat.close}
            onClick={() => dialog.current?.close()}
            className="-mr-1 rounded-full p-2 text-muted-foreground hover:bg-raised hover:text-foreground"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
