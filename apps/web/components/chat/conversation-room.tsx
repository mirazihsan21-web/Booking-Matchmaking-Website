"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sendPrivateAction } from "@/app/(site)/chat/private/actions";
import { markConversationRead } from "@/lib/chat/reads";
import { roomPage, roomSince } from "@/lib/chat/room";
import { mergeMessages, mergeUpdates, messageFromRow, type ChatMessage } from "@/lib/chat/rows";
import { createClient } from "@/lib/supabase/client";
import { changesReady, subscribeSignedIn } from "@/lib/supabase/realtime";
import { m } from "@/messages";
import { CHAT_READ_EVENT } from "./chat-link";
import type { ChatMe } from "./chat-room";
import { Composer, type SendResult } from "./composer";
import { MessageItem } from "./message-item";
import { MessageMenu } from "./message-menu";
import { useFitHeight } from "./use-fit-height";

const READ_EVERY_MS = 10_000;
const PAGE = 50;

/**
 * A private conversation, live: only its two people receive its rows (row rules), and the first message creates it,
 * so the room starts listening once it exists. While the tab is visible it marks itself read (at most every 10 s)
 * and tells the Chat link, whose number follows. Load earlier reads older pages; "Reconnecting…" shows while the
 * live connection is down.
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
  const [hasMore, setHasMore] = useState(initial.length >= PAGE);
  const [connected, setConnected] = useState(true);
  const [now, setNow] = useState(() => new Date(renderedAt));
  const keepOffset = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const below = useRef<HTMLDivElement>(null);
  const fitted = useFitHeight(scroller, below);
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
          if (status === "SUBSCRIBED") {
            setConnected(true);
            catchUp().catch(() => undefined);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setConnected(false);
          }
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

  // At the newest message — on a new one, and when the list is sized to the screen — except after Load earlier,
  // which keeps your place.
  useLayoutEffect(() => {
    newest.current = messages.at(-1);
    const el = scroller.current;
    if (!el) return;
    if (keepOffset.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages, fitted]);

  // Read up to the newest message while the tab is visible, at most every 10 seconds.
  const lastRead = useRef(0);
  const readTimer = useRef<number | null>(null);
  useEffect(() => {
    const mark = () => {
      const at = newest.current?.createdAt;
      if (!at || !conversationId || document.visibilityState !== "visible") return;
      lastRead.current = Date.now();
      markConversationRead(supabase, { conversationId, organizationId, profileId: me.profileId, at }).then(
        () => window.dispatchEvent(new Event(CHAT_READ_EVENT)),
        () => undefined,
      );
    };
    const wait = READ_EVERY_MS - (Date.now() - lastRead.current);
    if (wait <= 0) mark();
    else if (readTimer.current === null) {
      readTimer.current = window.setTimeout(() => {
        readTimer.current = null;
        mark();
      }, wait);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") mark();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [conversationId, me.profileId, messages, organizationId, supabase]);

  useEffect(
    () => () => {
      if (readTimer.current !== null) window.clearTimeout(readTimer.current);
    },
    [],
  );

  async function loadEarlier() {
    const oldest = messages[0];
    if (!oldest || !conversationId) return;
    const page = await roomPage(supabase, { organizationId, conversationId, before: oldest.createdAt });
    const shown = new Set(messages.map((message) => message.id));
    const older = page.messages.filter((message) => !shown.has(message.id));
    if (older.length === 0 || page.messages.length < PAGE) setHasMore(false);
    if (older.length === 0) return;
    const el = scroller.current;
    keepOffset.current = el ? el.scrollHeight - el.scrollTop : null;
    setMessages((previous) => mergeMessages(previous, older));
  }

  function sent(result: SendResult) {
    if (result?.conversationId && !conversationId) setConversationId(result.conversationId);
    else catchUp().catch(() => undefined);
  }

  return (
    <section className="flex flex-col gap-3">
      {!connected && (
        <p role="status" className="text-sm text-muted-foreground">
          {m.chat.reconnecting}
        </p>
      )}
      <div
        ref={scroller}
        style={fitted === null ? undefined : { height: fitted }}
        className="h-[55dvh] min-h-40 overflow-y-auto rounded-xl border border-border p-2"
      >
        {/* The newest messages sit at the bottom, next to the chat box. */}
        <div className="flex min-h-full flex-col justify-end">
          {hasMore && (
            <div className="flex justify-center pb-2">
              <button type="button" onClick={() => void loadEarlier()} className="rounded-lg px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-raised">
                {m.chat.loadEarlier}
              </button>
            </div>
          )}
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
      </div>
      <div ref={below} className="flex flex-col">
        <Composer action={sendPrivateAction} hidden={{ toProfileId: otherProfileId }} userId={me.userId} onSent={sent} />
      </div>
    </section>
  );
}
