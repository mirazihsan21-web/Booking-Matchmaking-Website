"use client";

import { MoreHorizontal } from "lucide-react";
import { startTransition, useState } from "react";
import { closeMyCardAction, muteAction, removeAsVenueAction, removeMyMessageAction } from "@/app/(site)/chat/actions";
import type { ChatMessage } from "@/lib/chat/rows";
import { m } from "@/messages";
import type { ChatMe } from "./chat-room";
import { ReportDialog } from "./report-dialog";

const MUTE_LENGTHS = ["1", "7", "forever"] as const;

/**
 * A message's ⋯ menu. Your own message: Remove; your own open card: Close card. Someone else's (players):
 * Report. The team: Remove message, and Mute for a player's message. Nothing for removed or hidden messages —
 * except the last word of what you just did (a report that hid the message still says thanks).
 */
export function MessageMenu({ message, me, cardOpen = false }: { message: ChatMessage; me: ChatMe; cardOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const said = status && (
    <span role="status" className={status.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
      {status.text}
    </span>
  );
  if (message.state !== "visible") return said || null;
  const mine = message.authorUserId === me.userId;
  const canRemoveOwn = mine && !message.cardId && !me.isTeam;
  const canCloseOwn = mine && message.cardId !== null && cardOpen;
  const canReport = !mine && !me.isTeam && me.profileId !== null;
  if (!canRemoveOwn && !canCloseOwn && !canReport && !me.isTeam) return null;

  const run = (action: () => Promise<{ ok: boolean; message?: string } | null>, done?: string) => {
    setStatus(null);
    startTransition(async () => {
      const result = await action();
      if (result?.ok) {
        setOpen(false);
        if (done) setStatus({ ok: true, text: done });
      } else {
        setStatus({ ok: false, text: result?.message ?? m.chat.refusal.invalid });
      }
    });
  };

  const item = "block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-raised";
  return (
    <span className="relative inline-flex flex-col items-end">
      <button
        type="button"
        aria-label={m.chat.options}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setReporting(false);
        }}
        className="rounded-md p-1 text-muted-foreground hover:bg-raised hover:text-foreground"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {open && (
        <span className="absolute right-0 top-full z-20 mt-1 flex w-64 flex-col rounded-xl border border-border bg-background p-1 shadow-lg">
          {canRemoveOwn && (
            <button type="button" className={item} onClick={() => run(() => removeMyMessageAction(message.id))}>
              {m.chat.remove}
            </button>
          )}
          {canCloseOwn && (
            <button type="button" className={item} onClick={() => run(() => closeMyCardAction(message.cardId!))}>
              {m.chat.game.close}
            </button>
          )}
          {me.isTeam && (
            <>
              <button type="button" className={item} onClick={() => run(() => removeAsVenueAction(message.id))}>
                {m.chat.removeAsVenue}
              </button>
              {message.authorProfileId &&
                MUTE_LENGTHS.map((length) => (
                  <button
                    key={length}
                    type="button"
                    className={item}
                    onClick={() => run(() => muteAction(message.authorProfileId!, length), m.chat.muted(message.authorName))}
                  >
                    {m.chat.muteFor[length]}
                  </button>
                ))}
            </>
          )}
          {canReport &&
            (reporting ? (
              <ReportDialog
                messageId={message.id}
                onReported={(thanks) => {
                  setOpen(false);
                  setReporting(false);
                  setStatus({ ok: true, text: thanks });
                }}
              />
            ) : (
              <button type="button" className={item} onClick={() => setReporting(true)}>
                {m.chat.report}
              </button>
            ))}
        </span>
      )}
      {said}
    </span>
  );
}
