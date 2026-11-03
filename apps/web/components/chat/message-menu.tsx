"use client";

import { MoreHorizontal } from "lucide-react";
import { startTransition, useState } from "react";
import { closeMyCardAction, muteAction, removeAsVenueAction, removeMyMessageAction } from "@/app/(site)/chat/actions";
import type { ChatMessage } from "@/lib/chat/rows";
import { m } from "@/messages";
import type { ChatMe } from "./chat-room";
import { ChatSheet } from "./chat-sheet";
import { ReportDialog } from "./report-dialog";

const MUTE_LENGTHS = ["1", "7", "forever"] as const;

/**
 * A message's ⋯ menu, in a ChatSheet that names the message it is for. Your own message: Remove; your own open
 * card: Close card. Someone else's (players): Report. The team: Remove message, and Mute for a player's message.
 * Nothing for removed or hidden messages — except the last word of what you just did (a report that hid the
 * message still says thanks). A refusal shows inside the sheet; the buttons wait while an action runs.
 */
export function MessageMenu({ message, me, cardOpen = false }: { message: ChatMessage; me: ChatMe; cardOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const said = done && (
    <span role="status" className="text-xs text-muted-foreground">
      {done}
    </span>
  );
  if (message.state !== "visible") return said || null;
  const mine = message.authorUserId === me.userId;
  const canRemoveOwn = mine && !message.cardId && !me.isTeam;
  const canCloseOwn = mine && message.cardId !== null && cardOpen;
  const canReport = !mine && !me.isTeam && me.profileId !== null;
  if (!canRemoveOwn && !canCloseOwn && !canReport && !me.isTeam) return null;

  const show = () => {
    setOpen(true);
    setReporting(false);
    setError(null);
    setDone(null);
  };

  const run = (action: () => Promise<{ ok: boolean; message?: string } | null>, doneText?: string) => {
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const result = await action().catch(() => null);
      setBusy(false);
      if (result?.ok) {
        setOpen(false);
        if (doneText) setDone(doneText);
      } else {
        setError(result?.message ?? m.chat.refusal.invalid);
      }
    });
  };

  const item = "block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-raised disabled:opacity-50";
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        aria-label={m.chat.options}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
        className="-m-1 rounded-md p-2 text-muted-foreground hover:bg-raised hover:text-foreground"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {open && (
        <ChatSheet title={m.chat.options} onClose={() => setOpen(false)}>
          <p className="line-clamp-2 break-words rounded-lg bg-raised px-3 py-2 text-muted-foreground">
            <span className="font-semibold text-foreground">{message.authorName}: </span>
            {message.cardId ? m.chat.menuCard : (message.body ?? m.chat.private.photoOnly)}
          </p>
          {canReport && reporting ? (
            <ReportDialog
              messageId={message.id}
              hasPhoto={message.photoPath !== null}
              onCancel={() => setOpen(false)}
              onReported={(thanks) => {
                setOpen(false);
                setDone(thanks);
              }}
            />
          ) : (
            <div className="-mx-1 flex flex-col">
              {canRemoveOwn && (
                <button type="button" disabled={busy} className={item} onClick={() => run(() => removeMyMessageAction(message.id))}>
                  {m.chat.remove}
                </button>
              )}
              {canCloseOwn && (
                <button type="button" disabled={busy} className={item} onClick={() => run(() => closeMyCardAction(message.cardId!))}>
                  {m.chat.game.close}
                </button>
              )}
              {me.isTeam && (
                <>
                  <button type="button" disabled={busy} className={item} onClick={() => run(() => removeAsVenueAction(message.id))}>
                    {m.chat.removeAsVenue}
                  </button>
                  {message.authorProfileId &&
                    MUTE_LENGTHS.map((length) => (
                      <button
                        key={length}
                        type="button"
                        disabled={busy}
                        className={item}
                        onClick={() => run(() => muteAction(message.authorProfileId!, length), m.chat.muted(message.authorName))}
                      >
                        {m.chat.muteFor[length]}
                      </button>
                    ))}
                </>
              )}
              {canReport && (
                <button type="button" className={item} onClick={() => setReporting(true)}>
                  {m.chat.report}
                </button>
              )}
            </div>
          )}
          {error && (
            <p role="status" className="text-destructive">
              {error}
            </p>
          )}
        </ChatSheet>
      )}
      {said}
    </span>
  );
}
