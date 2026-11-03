"use client";

import { useEffect, useRef, useState } from "react";
import { hasUnreadRoom, privateUnread } from "@/lib/chat/reads";
import { createClient } from "@/lib/supabase/client";
import { changesReady, subscribeSignedIn } from "@/lib/supabase/realtime";

export interface ChatLinkState {
  organizationId: string;
  userId: string;
  /** From the server: are there room messages this person hasn't seen? */
  unread: boolean;
  /** From the server: unread private messages. */
  privateUnread: number;
  /** Players this person blocked: their room messages don't light the dot. */
  blocked: string[];
}

/** Sent by a private conversation once it has marked itself read, so the Chat link's number follows straight away. */
export const CHAT_READ_EVENT = "chat:conversation-read";

/**
 * The Chat link's dot and number, kept live. A room message from someone else (Realtime; row rules decide who gets
 * it) — not from a player you blocked — lights the dot while you're anywhere but the room itself (`onRoom`: the
 * game and private pages count as elsewhere); being in the room clears it. The number is unread private messages,
 * asked again on every page, on each private message, and when a conversation you're reading marks itself read.
 * Each time the channel (re)connects both are asked again, so nothing sent before it was listening is missed.
 * Null for visitors (they can't read the room).
 */
export function useChatUnread(chat: ChatLinkState | null, onRoom: boolean, path: string): { dot: boolean; count: number } {
  const [unread, setUnread] = useState(chat?.unread ?? false);
  const [count, setCount] = useState(chat?.privateUnread ?? 0);
  const onRoomRef = useRef(onRoom);
  const blockedRef = useRef(new Set(chat?.blocked ?? []));
  useEffect(() => {
    onRoomRef.current = onRoom;
  }, [onRoom]);
  useEffect(() => {
    blockedRef.current = new Set(chat?.blocked ?? []);
  }, [chat?.blocked]);
  // Opening the room clears the dot (adjusted while rendering, the way React suggests for state that follows a prop).
  const [wasOnRoom, setWasOnRoom] = useState(onRoom);
  if (onRoom !== wasOnRoom) {
    setWasOnRoom(onRoom);
    if (onRoom) setUnread(false);
  }

  const organizationId = chat?.organizationId;
  const userId = chat?.userId;

  // The private count is asked again on every page, and when the conversation you're reading marks itself read.
  useEffect(() => {
    if (!organizationId) return;
    const recount = () => void privateUnread(createClient(), organizationId).then(setCount, () => undefined);
    recount();
    window.addEventListener(CHAT_READ_EVENT, recount);
    return () => window.removeEventListener(CHAT_READ_EVENT, recount);
  }, [organizationId, path]);
  useEffect(() => {
    if (!organizationId || !userId) return;
    const supabase = createClient();
    // Ask again whenever the channel (re)connects or its changes start flowing, so nothing sent in between is missed.
    const recheck = () => {
      privateUnread(supabase, organizationId).then(setCount, () => undefined);
      if (onRoomRef.current) return;
      hasUnreadRoom(supabase, { organizationId, userId, blocked: [...blockedRef.current] }).then(
        (unseen) => {
          if (unseen && !onRoomRef.current) setUnread(true);
        },
        () => undefined,
      );
    };
    return subscribeSignedIn(supabase, (suffix) =>
      supabase
        .channel(`chat-dot:${organizationId}:${userId}:${suffix}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `organization_id=eq.${organizationId}` }, (payload) => {
          const row = payload.new as { author_user_id?: string; author_profile_id?: string | null; conversation_id?: string | null };
          if (row.author_user_id === userId) return;
          if (row.conversation_id) privateUnread(supabase, organizationId).then(setCount, () => undefined);
          else if (!onRoomRef.current && !(row.author_profile_id && blockedRef.current.has(row.author_profile_id))) setUnread(true);
        })
        .on("system", {}, (payload) => {
          if (changesReady(payload)) recheck();
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") recheck();
        }),
    );
  }, [organizationId, userId]);

  return { dot: unread && !onRoom, count };
}
