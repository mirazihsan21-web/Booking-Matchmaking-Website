"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sendPrivateAction } from "@/app/(site)/chat/private/actions";
import { markConversationRead } from "@/lib/chat/reads";
import { roomSince } from "@/lib/chat/room";
import { mergeMessages, mergeUpdates, messageFromRow, type ChatMessage } from "@/lib/chat/rows";
import { createClient } from "@/lib/supabase/client";
import { changesReady, subscribeSignedIn } from "@/lib/supabase/realtime";
import { m } from "@/messages";
import type { ChatMe } from "./chat-room";
import { Composer, type SendResult } from "./composer";
import { MessageItem } from "./message-item";
import { MessageMenu } from "./message-menu";

const READ_EVERY_MS = 10_000;

/**
 * A private conversation, live: only its two people receive its rows (row rules), and the first message creates it,
 * so the room starts listening once it exists. While the tab is visible it marks itself read (at most every 10 s).
 */
export function ConversationRoom({
  organizationId,
  timeZone,
  me,
  otherProfileId,
  initialConversationId,
  initial,
  renderedAt,
}: {
  organizationId: string;
  timeZone: string;
  me: ChatMe & { profileId: string };
  otherProfileId: string;
  initialConversationId: string | null;
  initial: ChatMessage[];
  renderedAt: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState(initial);
  const [now, setNow] = useState(() => new Date(renderedAt));
  const scroller = useRef<HTMLDivElement>(null);
  const newest = useRef(initial.at(-1));

  const catchUp = useCallback(async () => {
    if (!conversationId) return;
    const since = await roomSince(supabase, { organizationId, conversationId, after: newest.current?.createdAt ?? new Date(0).toISOString() });
    setMessages((previous) => mergeMessages(previous, since.messages));
  }, [conversationId, organizationId, supabase]);

  useEffect(() => {
    if (!conversationId) return;
    const filter = `conversation_id=eq.${conversationId}`;
    return subscribeSignedIn(supabase, (suffix) =>
      supabase
        .channel(`chat-dm:${conversationId}:${suffix}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter }, (payload) =>
          setMessages((previous) => mergeMessages(previous, [messageFromRow(payload.new)])),
        )
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter }, (payload) =>
          setMessages((previous) => mergeUpdates(previous, [messageFromRow(payload.new)])),
        )
        .on("system", {}, (payload) => {
          if (changesReady(payload)) catchUp().catch(() => undefined);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") catchUp().catch(() => undefined);
        }),
    );
  }, [catchUp, conversationId, supabase]);

  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  useLayoutEffect(() => {
    newest.current = messages.at(-1);
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Read up to the newest message while the tab is visible, at most every 10 seconds.
  const lastRead = useRef(0);
  const readTimer = useRef<number | null>(null);
  useEffect(() => {
    const mark = () => {
      const at = newest.current?.createdAt;
      if (!at || !conversationId || document.visibilityState !== "visible") return;
      lastRead.current = Date.now();
      markConversationRead(supabase, { conversationId, organizationId, profileId: me.profileId, at }).catch(() => undefined);
    };
    const wait = READ_EVERY_MS - (Date.now() - lastRead.current);
    if (wait <= 0) mark();
    else if (readTimer.current === null) {
      readTimer.current = window.setTimeout(() => {
        readTimer.current = null;
        mark();
      }, wait);
    }
  }, [conversationId, me.profileId, messages, organizationId, supabase]);

  function sent(result: SendResult) {
    if (result?.conversationId && !conversationId) setConversationId(result.conversationId);
    else catchUp().catch(() => undefined);
  }

  return (
    <section className="flex flex-col gap-3">
      <div ref={scroller} className="h-[55dvh] min-h-72 overflow-y-auto rounded-xl border border-border p-2">
        {messages.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">{m.chat.empty}</p>}
        <ol className="flex flex-col gap-2">
          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              mine={message.authorUserId === me.userId}
              timeZone={timeZone}
              now={now}
              actions={<MessageMenu message={message} me={me} />}
            />
          ))}
        </ol>
      </div>
      <Composer action={sendPrivateAction} hidden={{ toProfileId: otherProfileId }} userId={me.userId} onSent={sent} />
    </section>
  );
}
