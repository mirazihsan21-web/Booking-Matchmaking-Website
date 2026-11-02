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
}

/**
 * The Chat link's dot, kept live: a room message from someone else (Realtime; row rules decide who gets it) lights
 * it while you're elsewhere on the site; being on the chat clears it. Each time the channel (re)connects it asks
 * again, so a message sent before it was listening still lights the dot. Null for visitors (they can't read the room).
 */
export function useChatUnread(chat: ChatLinkState | null, onChat: boolean, path: string): { dot: boolean; count: number } {
  const [unread, setUnread] = useState(chat?.unread ?? false);
  const [count, setCount] = useState(chat?.privateUnread ?? 0);
  const onChatRef = useRef(onChat);
  useEffect(() => {
    onChatRef.current = onChat;
  }, [onChat]);
  // Opening the chat clears the dot (adjusted while rendering, the way React suggests for state that follows a prop).
  const [wasOnChat, setWasOnChat] = useState(onChat);
  if (onChat !== wasOnChat) {
    setWasOnChat(onChat);
    if (onChat) setUnread(false);
  }

  const organizationId = chat?.organizationId;
  const userId = chat?.userId;

  // The private count is asked again on every page (reading a conversation lowers it).
  useEffect(() => {
    if (!organizationId) return;
    privateUnread(createClient(), organizationId).then(setCount, () => undefined);
  }, [organizationId, path]);
  useEffect(() => {
    if (!organizationId || !userId) return;
    const supabase = createClient();
    // Ask again whenever the channel (re)connects or its changes start flowing, so nothing sent in between is missed.
    const recheck = () => {
      privateUnread(supabase, organizationId).then(setCount, () => undefined);
      if (onChatRef.current) return;
      hasUnreadRoom(supabase, { organizationId, userId }).then(
        (unseen) => {
          if (unseen && !onChatRef.current) setUnread(true);
        },
        () => undefined,
      );
    };
    return subscribeSignedIn(supabase, (suffix) =>
      supabase
        .channel(`chat-dot:${organizationId}:${userId}:${suffix}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `organization_id=eq.${organizationId}` }, (payload) => {
          const row = payload.new as { author_user_id?: string; conversation_id?: string | null };
          if (row.author_user_id === userId) return;
          if (row.conversation_id) privateUnread(supabase, organizationId).then(setCount, () => undefined);
          else if (!onChatRef.current) setUnread(true);
        })
        .on("system", {}, (payload) => {
          if (changesReady(payload)) recheck();
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") recheck();
        }),
    );
  }, [organizationId, userId]);

  return { dot: unread && !onChat, count };
}
