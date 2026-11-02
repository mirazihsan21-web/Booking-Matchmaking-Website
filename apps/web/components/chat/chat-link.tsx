"use client";

import { useEffect, useRef, useState } from "react";
import { hasUnreadRoom } from "@/lib/chat/reads";
import { createClient } from "@/lib/supabase/client";
import { subscribeSignedIn } from "@/lib/supabase/realtime";

export interface ChatLinkState {
  organizationId: string;
  userId: string;
  /** From the server: are there room messages this person hasn't seen? */
  unread: boolean;
}

/**
 * The Chat link's dot, kept live: a room message from someone else (Realtime; row rules decide who gets it) lights
 * it while you're elsewhere on the site; being on the chat clears it. Each time the channel (re)connects it asks
 * again, so a message sent before it was listening still lights the dot. Null for visitors (they can't read the room).
 */
export function useChatUnread(chat: ChatLinkState | null, onChat: boolean): boolean {
  const [unread, setUnread] = useState(chat?.unread ?? false);
  const onChatRef = useRef(onChat);
  useEffect(() => {
    onChatRef.current = onChat;
    if (onChat) setUnread(false);
  }, [onChat]);

  const organizationId = chat?.organizationId;
  const userId = chat?.userId;
  useEffect(() => {
    if (!organizationId || !userId) return;
    const supabase = createClient();
    return subscribeSignedIn(supabase, (suffix) =>
      supabase
        .channel(`chat-dot:${organizationId}:${userId}:${suffix}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `organization_id=eq.${organizationId}` }, (payload) => {
          if ((payload.new as { author_user_id?: string }).author_user_id !== userId && !onChatRef.current) setUnread(true);
        })
        .subscribe((status) => {
          if (status !== "SUBSCRIBED" || onChatRef.current) return;
          hasUnreadRoom(supabase, { organizationId, userId }).then(
            (unseen) => {
              if (unseen && !onChatRef.current) setUnread(true);
            },
            () => undefined,
          );
        }),
    );
  }, [organizationId, userId]);

  return unread && !onChat;
}
