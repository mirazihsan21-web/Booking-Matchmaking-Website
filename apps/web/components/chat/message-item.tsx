"use client";

import type { ReactNode } from "react";
import { cn } from "cn";
import type { ChatMessage } from "@/lib/chat/rows";
import { chatTime } from "@/lib/chat/time";
import { m } from "@/messages";
import { ChatPhoto } from "./chat-photo";

const GONE: Record<Exclude<ChatMessage["state"], "visible">, string> = {
  removed_by_author: m.chat.removed,
  removed_by_venue: m.chat.removedByVenue,
  hidden_by_reports: m.chat.hiddenForReview,
};

/**
 * One message in the room: who (the brand with a Team badge for the venue), when (in the venue's time zone), and the
 * text as typed — links are not made clickable. A removed or hidden message keeps its place with a short note.
 * `actions` sits after the text (Remove, or the menu); `children` replaces the text (a card).
 */
export function MessageItem({
  message,
  mine,
  timeZone,
  now,
  actions,
  nameSlot,
  children,
}: {
  message: ChatMessage;
  mine: boolean;
  timeZone: string;
  now: Date;
  actions?: ReactNode;
  /** Replaces the plain name (e.g. the player panel). */
  nameSlot?: ReactNode;
  children?: ReactNode;
}) {
  const gone = message.state === "visible" ? null : GONE[message.state];
  return (
    <li className={cn("flex flex-col gap-1 rounded-xl px-3 py-2", mine ? "bg-raised" : "bg-card")}>
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
        {nameSlot ?? <span className="font-semibold text-foreground">{message.authorName}</span>}
        {message.authorKind === "team" && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">{m.chat.team}</span>
        )}
        <time dateTime={message.createdAt} className="text-muted-foreground">
          {chatTime(message.createdAt, timeZone, now)}
        </time>
        {actions && <span className="ml-auto">{actions}</span>}
      </div>
      {gone ? (
        <p className="text-sm italic text-muted-foreground">{gone}</p>
      ) : (
        (children ?? (
          <>
            {message.photoPath && <ChatPhoto path={message.photoPath} alt={m.chat.photo.alt(message.authorName)} />}
            {message.body && <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>}
          </>
        ))
      )}
    </li>
  );
}
