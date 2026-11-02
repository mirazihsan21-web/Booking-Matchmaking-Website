"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { removeMyMessageAction } from "@/app/(site)/chat/actions";
import { markRoomRead } from "@/lib/chat/reads";
import { cardsFor, roomPage } from "@/lib/chat/room";
import { cardFromRow, mergeMessages, messageFromRow, type ChatCard, type ChatMessage } from "@/lib/chat/rows";
import { formatNight } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { subscribeSignedIn } from "@/lib/supabase/realtime";
import { m } from "@/messages";
import { CardItem } from "./card-item";
import { CardStrip } from "./card-strip";
import { Composer } from "./composer";
import { MessageItem } from "./message-item";

export interface ChatMe {
  userId: string;
  profileId: string | null;
  isTeam: boolean;
}

/** What the box at the bottom shows: the composer, a nudge to set up a profile, or the mute. */
export type ChatBox = { kind: "open" } | { kind: "no_profile" } | { kind: "muted"; until: string | null };

const PAGE = 50;
const READ_EVERY_MS = 10_000;

/**
 * The live room. Messages and cards arrive through Realtime (row rules decide who receives what); every time the
 * channel (re)connects the room reads anything newer than what it has, so nothing sent in between is lost, and
 * mergeMessages keeps one copy of each. Load earlier reads older pages in the browser. While the tab is visible the
 * room marks itself read (at most every 10 seconds), which clears the Chat link's dot.
 */
export function ChatRoom({
  organizationId,
  timeZone,
  me,
  box,
  initial,
  openCards,
  renderedAt,
}: {
  organizationId: string;
  timeZone: string;
  me: ChatMe;
  box: ChatBox;
  initial: { messages: ChatMessage[]; cards: ChatCard[] };
  /** The open cards for the strip, with seats left for games (re-read by the page every minute). */
  openCards: Array<ChatCard & { seatsLeft: number | null }>;
  renderedAt: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState(initial.messages);
  const [cards, setCards] = useState(() => new Map(initial.cards.map((c) => [c.id, c])));
  const [hasMore, setHasMore] = useState(initial.messages.length >= PAGE);
  const [connected, setConnected] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [error, setError] = useState<string | null>(null);

  // The strip: the server's open cards, kept current by live card changes until the page re-reads them.
  const fromServer = (list: typeof openCards) => new Map(list.map(({ seatsLeft, ...card }) => [card.id, { card: card as ChatCard, seatsLeft }]));
  const [stripSource, setStripSource] = useState(openCards);
  const [strip, setStrip] = useState(() => fromServer(openCards));
  if (stripSource !== openCards) {
    setStripSource(openCards);
    setStrip(fromServer(openCards));
  }

  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const newest = useRef(initial.messages.at(-1));
  const keepOffset = useRef<number | null>(null);
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  const addCards = useCallback((incoming: ChatCard[]) => {
    if (incoming.length === 0) return;
    setCards((previous) => {
      const next = new Map(previous);
      for (const card of incoming) next.set(card.id, card);
      return next;
    });
    setStrip((previous) => {
      const next = new Map(previous);
      for (const card of incoming) {
        if (card.status === "open" && new Date(card.startsAt) > new Date()) next.set(card.id, { card, seatsLeft: previous.get(card.id)?.seatsLeft ?? null });
        else next.delete(card.id);
      }
      return next;
    });
  }, []);

  const addMessages = useCallback(
    (incoming: ChatMessage[], incomingCards: ChatCard[] = []) => {
      addCards(incomingCards);
      setMessages((previous) => mergeMessages(previous, incoming));
      // A card's message can arrive before its card does: fetch any card the room doesn't have yet.
      const known = new Set([...cardsRef.current.keys(), ...incomingCards.map((c) => c.id)]);
      const missing = incoming.filter((msg) => msg.cardId && !known.has(msg.cardId));
      if (missing.length > 0) void cardsFor(supabase, missing).then(addCards, () => undefined);
    },
    [addCards, supabase],
  );

  const catchUp = useCallback(async () => {
    const page = await roomPage(supabase, { organizationId, after: newest.current?.createdAt });
    addMessages(page.messages, page.cards);
  }, [addMessages, organizationId, supabase]);

  // Live rows.
  useEffect(() => {
    const filter = `organization_id=eq.${organizationId}`;
    const onMessage = (payload: { new: Record<string, unknown> }) => addMessages([messageFromRow(payload.new)]);
    const onCard = (payload: { new: Record<string, unknown> }) => addCards([cardFromRow(payload.new)]);
    return subscribeSignedIn(supabase, (suffix) =>
      supabase
        .channel(`chat:${organizationId}:${suffix}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter }, onMessage)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter }, onMessage)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_cards", filter }, onCard)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_cards", filter }, onCard)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setConnected(true);
            catchUp().catch(() => undefined);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setConnected(false);
          }
        }),
    );
  }, [addCards, addMessages, catchUp, organizationId, supabase]);

  // "Today" moves on.
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Scrolling: stay at the bottom for new messages (or offer a button if you've scrolled up), and keep your place
  // when older messages are added above.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepOffset.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
      return;
    }
    const last = messages.at(-1);
    const isNew = last && last.id !== newest.current?.id;
    newest.current = last;
    if (nearBottom.current || last?.authorUserId === me.userId) el.scrollTop = el.scrollHeight;
    else if (isNew) setUnseen(true);
  }, [messages, me.userId]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Read up to the newest message while the tab is visible, at most every 10 seconds.
  const lastRead = useRef(0);
  const readTimer = useRef<number | null>(null);
  useEffect(() => {
    const mark = () => {
      const at = newest.current?.createdAt;
      if (!at || document.visibilityState !== "visible") return;
      lastRead.current = Date.now();
      markRoomRead(supabase, { organizationId, userId: me.userId, at }).catch(() => undefined);
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
  }, [messages, me.userId, organizationId, supabase]);

  useEffect(
    () => () => {
      if (readTimer.current !== null) window.clearTimeout(readTimer.current);
    },
    [],
  );

  async function loadEarlier() {
    const oldest = messages[0];
    if (!oldest) return;
    const page = await roomPage(supabase, { organizationId, before: oldest.createdAt });
    const before = new Set(messages.map((msg) => msg.id));
    const older = page.messages.filter((msg) => !before.has(msg.id));
    if (older.length === 0 || page.messages.length < PAGE) setHasMore(false);
    if (older.length === 0) return;
    const el = scroller.current;
    keepOffset.current = el ? el.scrollHeight - el.scrollTop : null;
    addMessages(older, page.cards);
  }

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom.current) setUnseen(false);
  }

  function jumpToNewest() {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setUnseen(false);
  }

  function remove(messageId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeMyMessageAction(messageId);
      if (!result?.ok) setError(result?.message ?? null);
    });
  }

  const stripCards = [...strip.values()].sort((a, b) => a.card.startsAt.localeCompare(b.card.startsAt));

  return (
    <section className="relative flex flex-col gap-3">
      <CardStrip cards={stripCards} timeZone={timeZone} />
      {!connected && (
        <p role="status" className="text-sm text-muted-foreground">
          {m.chat.reconnecting}
        </p>
      )}
      <div ref={scroller} onScroll={onScroll} className="h-[60dvh] min-h-72 overflow-y-auto rounded-xl border border-border p-2">
        {hasMore && (
          <div className="flex justify-center pb-2">
            <button type="button" onClick={() => void loadEarlier()} className="rounded-lg px-3 py-1 text-sm font-semibold text-muted-foreground hover:bg-raised">
              {m.chat.loadEarlier}
            </button>
          </div>
        )}
        {messages.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">{m.chat.empty}</p>}
        <ol className="flex flex-col gap-2">
          {messages.map((message) => {
            const mine = message.authorUserId === me.userId;
            const card = message.cardId ? cards.get(message.cardId) : undefined;
            if (message.cardId && !card) return null;
            if (card) {
              return (
                <MessageItem key={message.id} message={message} mine={mine} timeZone={timeZone} now={now}>
                  <CardItem card={card} timeZone={timeZone} mine={card.posterUserId === me.userId} seatsLeft={strip.get(card.id)?.seatsLeft ?? null} />
                </MessageItem>
              );
            }
            return (
              <MessageItem
                key={message.id}
                message={message}
                mine={mine}
                timeZone={timeZone}
                now={now}
                actions={
                  mine && !message.cardId && message.state === "visible" ? (
                    <button type="button" onClick={() => remove(message.id)} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                      {m.chat.remove}
                    </button>
                  ) : null
                }
              />
            );
          })}
        </ol>
      </div>
      {unseen && (
        <button
          type="button"
          onClick={jumpToNewest}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow"
        >
          {m.chat.newMessages}
        </button>
      )}
      {error && (
        <p role="status" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {box.kind === "open" && <Composer onSent={() => void catchUp().catch(() => undefined)} />}
      {box.kind === "no_profile" && (
        <Link href="/me/edit?next=/chat" className="rounded-xl bg-card p-4 text-center font-semibold hover:bg-raised">
          {m.chat.setUpProfile}
        </Link>
      )}
      {box.kind === "muted" && (
        <p className="rounded-xl bg-card p-4 text-center text-sm text-muted-foreground">
          {box.until ? m.chat.mutedUntil(formatNight(box.until, timeZone)) : m.chat.mutedForever}
        </p>
      )}
    </section>
  );
}
