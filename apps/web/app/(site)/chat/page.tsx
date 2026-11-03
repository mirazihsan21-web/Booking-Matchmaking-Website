import Link from "next/link";
import { Suspense } from "react";
import { ChatRoom, type ChatBox } from "@/components/chat/chat-room";
import { ChatTabs } from "@/components/chat/chat-tabs";
import { NeedPlayersForm } from "@/components/chat/need-players-form";
import { AutoRefresh } from "@/components/site/auto-refresh";
import { cardableBookings, openCards, shareableSessions } from "@/lib/chat/cards";
import { myMute } from "@/lib/chat/moderation";
import { blockedByMe } from "@/lib/chat/private";
import { privateUnread } from "@/lib/chat/reads";
import { roomPage } from "@/lib/chat/room";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { getBrand } from "@/lib/tenancy/brand";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

function Shell({ children, privateUnread: unread }: { children: React.ReactNode; privateUnread?: number }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl uppercase tracking-wide">{m.chat.title}</h1>
        {/* On a phone the room needs the height (the chat box stays on screen); the title and the buttons say enough. */}
        <p className="hidden text-muted-foreground sm:block">{m.chat.intro}</p>
        {unread !== undefined && <ChatTabs active="everyone" privateUnread={unread} />}
      </header>
      {children}
    </main>
  );
}

/** The players chat: signed-in people only. The team posts as the brand; players need a profile to post. */
async function Chat() {
  const brand = await getBrand();
  if (!brand) return null; // the layout shows "Not open yet"
  const player = await getSitePlayer();
  if (!player) {
    return (
      <Shell>
        <section className="flex flex-col items-start gap-3 rounded-xl bg-card p-6">
          <p className="text-lg font-semibold">{m.chat.signInToSee}</p>
          <Link href="/signin?next=/chat" className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground">
            {m.chat.signIn}
          </Link>
        </section>
      </Shell>
    );
  }

  const db = createServiceClient();
  const supabase = await createClient();
  const isPlayer = player.profileId !== null && !player.isTeam;
  const [initial, mute, open, bookings, sessions, blocked, unread] = await Promise.all([
    roomPage(supabase, { organizationId: brand.id }),
    player.profileId && !player.isTeam ? myMute(db, { organizationId: brand.id, profileId: player.profileId }) : null,
    openCards(db, { organizationId: brand.id }),
    player.profileId && !player.isTeam ? cardableBookings(db, { organizationId: brand.id, profileId: player.profileId }) : [],
    player.isTeam || player.profileId
      ? shareableSessions(db, { organizationId: brand.id, userId: player.user.id, profileId: player.profileId, isTeam: player.isTeam })
      : [],
    isPlayer ? blockedByMe(db, { organizationId: brand.id, profileId: player.profileId! }) : [],
    isPlayer ? privateUnread(supabase, brand.id) : 0,
  ]);
  const box: ChatBox = player.isTeam ? { kind: "open" } : !player.profileId ? { kind: "no_profile" } : mute ? { kind: "muted", until: mute.until } : { kind: "open" };

  return (
    <Shell privateUnread={unread}>
      {box.kind === "open" && <NeedPlayersForm bookings={bookings} sessions={sessions} isTeam={player.isTeam} timeZone={brand.timezone} />}
      <ChatRoom
        organizationId={brand.id}
        timeZone={brand.timezone}
        me={{ userId: player.user.id, profileId: player.profileId, isTeam: player.isTeam }}
        box={box}
        initial={initial}
        openCards={open}
        blockedIds={blocked}
        renderedAt={new Date().toISOString()}
      />
      <AutoRefresh seconds={60} />
    </Shell>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <Chat />
    </Suspense>
  );
}
