"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import { blockAction, playerCardAction, unblockAction } from "@/app/(site)/chat/private/actions";
import { m } from "@/messages";

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
      <button type="button" onClick={toggle} disabled={pending} className="self-start rounded-lg border border-border px-3 py-1 text-sm hover:bg-raised">
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

/** A player's name in the room: tap it for their sections, Message, and Block. */
export function PlayerPanel({ profileId, name }: { profileId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<Card | undefined>(undefined);

  function toggle() {
    setOpen((v) => !v);
    if (card === undefined) playerCardAction(profileId).then(setCard, () => setCard(null));
  }

  return (
    <span className="relative inline-flex">
      <button type="button" onClick={toggle} aria-expanded={open} className="font-semibold text-foreground hover:underline">
        {name}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-20 mt-1 flex w-60 flex-col gap-2 rounded-xl border border-border bg-background p-3 text-sm shadow-lg">
          <span className="font-semibold">{card?.name ?? name}</span>
          {card && card.sections.length > 0 && <span className="text-xs text-muted-foreground">{m.chat.private.plays(card.sections.join(", "))}</span>}
          {card !== null && (
            <Link href={`/chat/private/${profileId}`} className="self-start rounded-lg bg-primary px-3 py-1 font-semibold text-primary-foreground">
              {m.chat.private.message}
            </Link>
          )}
          {card && <BlockButton profileId={profileId} blocked={card.blockedByMe} onChange={(blocked) => setCard({ ...card, blockedByMe: blocked })} />}
        </span>
      )}
    </span>
  );
}
