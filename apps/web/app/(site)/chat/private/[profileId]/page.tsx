import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConversationRoom } from "@/components/chat/conversation-room";
import { BlockButton } from "@/components/chat/player-panel";
import { PrivateShell } from "@/components/chat/private-shell";
import { conversationWith } from "@/lib/chat/private";
import { privateUnread } from "@/lib/chat/reads";
import { roomPage } from "@/lib/chat/room";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { getBrand } from "@/lib/tenancy/brand";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

/** A private conversation with one player — or why there can't be one (blocked either way). */
async function Conversation({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  const brand = await getBrand();
  if (!brand) return null;
  const player = await getSitePlayer();
  if (!player) {
    return (
      <PrivateShell privateUnread={0}>
        <section className="flex flex-col items-start gap-3 rounded-xl bg-card p-6">
          <p className="text-lg font-semibold">{m.chat.signInToSee}</p>
          <Link href={`/signin?next=${encodeURIComponent(`/chat/private/${profileId}`)}`} className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground">
            {m.chat.signIn}
          </Link>
        </section>
      </PrivateShell>
    );
  }
  if (player.isTeam || !player.profileId) {
    return (
      <PrivateShell privateUnread={0}>
        <p className="text-muted-foreground">{player.isTeam ? m.chat.private.teamNote : m.chat.setUpProfile}</p>
      </PrivateShell>
    );
  }
  const view = /^[0-9a-f-]{36}$/i.test(profileId)
    ? await conversationWith(createServiceClient(), { organizationId: brand.id, profileId: player.profileId, otherProfileId: profileId })
    : null;
  if (!view) notFound();

  const supabase = await createClient();
  const [initial, unread] = await Promise.all([
    view.conversationId ? roomPage(supabase, { organizationId: brand.id, conversationId: view.conversationId }) : { messages: [], cards: [] },
    privateUnread(supabase, brand.id),
  ]);
  const blocked = view.blockedByMe || view.blockedMe;

  return (
    <PrivateShell privateUnread={unread}>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/chat/private" className="text-sm text-muted-foreground hover:underline">
          ← {m.chat.private.back}
        </Link>
        <h2 className="flex-1 font-semibold">{m.chat.private.with(view.otherName)}</h2>
        {(view.blockedByMe || !view.blockedMe) && <BlockButton profileId={profileId} blocked={view.blockedByMe} />}
      </div>
      {blocked ? (
        <p className="rounded-xl bg-card p-4 text-center text-sm text-muted-foreground">{m.chat.refusal.blocked}</p>
      ) : (
        <ConversationRoom
          organizationId={brand.id}
          timeZone={brand.timezone}
          me={{ userId: player.user.id, profileId: player.profileId, isTeam: false }}
          otherProfileId={profileId}
          initialConversationId={view.conversationId}
          initial={initial.messages}
          renderedAt={new Date().toISOString()}
        />
      )}
    </PrivateShell>
  );
}

export default function ConversationPage({ params }: PageProps<"/chat/private/[profileId]">) {
  return (
    <Suspense fallback={null}>
      <Conversation params={params} />
    </Suspense>
  );
}
