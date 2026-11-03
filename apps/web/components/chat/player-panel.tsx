"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import { blockAction, playerCardAction, unblockAction } from "@/app/(site)/chat/private/actions";
import { m } from "@/messages";
import { ChatSheet } from "./chat-sheet";

/** Block or Unblock a player; `onChange` hears the new state once it's saved. */
export function BlockButton({ profileId, blocked, onChange }: { profileId: string; blocked: boolean; onChange?: (blocked: boolean) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  function toggle() {
    setError(null);
    setPending(true);
    startTransition(async () => {
      const result = await (blocked ? unblockAction(profileId) : blockAction(profileId));
      setPending(false);
      if (result?.ok) onChange?.(!blocked);
      else setError(result?.message ?? m.chat.refusal.invalid);
    });
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={toggle} disabled={pending} className="self-start rounded-lg border border-border px-4 py-2 text-sm hover:bg-raised disabled:opacity-50">
        {blocked ? m.chat.private.unblock : m.chat.private.block}
      </button>
      {error && (
        <span role="status" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}

type Card = { name: string; sections: string[]; blockedByMe: boolean } | null;

/** A player's name in the room: tap it for their sections, Message, and Block (in a ChatSheet). */
export function PlayerPanel({ profileId, name }: { profileId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<Card | undefined>(undefined);

  function show() {
    setOpen(true);
    if (card === undefined) playerCardAction(profileId).then(setCard, () => setCard(null));
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="-my-1 py-1 font-semibold text-foreground underline-offset-2 hover:underline"
      >
        {name}
      </button>
      {open && (
        <ChatSheet title={card?.name ?? name} onClose={() => setOpen(false)}>
          {card && card.sections.length > 0 && <p className="text-muted-foreground">{m.chat.private.plays(card.sections.join(", "))}</p>}
          {card === null ? (
            <p className="text-muted-foreground">{m.chat.private.unavailable}</p>
          ) : (
            // Message works straight away; Block comes with the player's details.
            <div className="flex flex-wrap items-start gap-2">
              <Link href={`/chat/private/${profileId}`} className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground">
                {m.chat.private.message}
              </Link>
              {card && <BlockButton profileId={profileId} blocked={card.blockedByMe} onChange={(blocked) => setCard({ ...card, blockedByMe: blocked })} />}
            </div>
          )}
        </ChatSheet>
      )}
    </>
  );
}
