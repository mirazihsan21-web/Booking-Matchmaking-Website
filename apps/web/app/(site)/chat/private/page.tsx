import Link from "next/link";
import { Suspense } from "react";
import { PrivateShell } from "@/components/chat/private-shell";
import { listConversations } from "@/lib/chat/private";
import { privateUnread } from "@/lib/chat/reads";
import { chatTime } from "@/lib/chat/time";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { getBrand } from "@/lib/tenancy/brand";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";

/** Your private conversations, the latest first, each with the other person's name, the last message and what's unread. */
async function Conversations() {
  const brand = await getBrand();
  if (!brand) return null;
  const player = await getSitePlayer();
  if (!player) {
    return (
      <PrivateShell privateUnread={0}>
        <section className="flex flex-col items-start gap-3 rounded-xl bg-card p-6">
          <p className="text-lg font-semibold">{m.chat.signInToSee}</p>
          <Link href="/signin?next=/chat/private" className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground">
            {m.chat.signIn}
          </Link>
        </section>
      </PrivateShell>
    );
  }
  if (player.isTeam || !player.profileId) {
    return (
      <PrivateShell privateUnread={0}>
        {player.isTeam ? (
          <p className="text-muted-foreground">{m.chat.private.teamNote}</p>
        ) : (
          <Link href="/me/edit?next=/chat/private" className="rounded-xl bg-card p-4 text-center font-semibold hover:bg-raised">
            {m.chat.setUpProfile}
          </Link>
        )}
      </PrivateShell>
    );
  }

  const [conversations, unread] = await Promise.all([
    listConversations(createServiceClient(), { organizationId: brand.id, profileId: player.profileId }),
    privateUnread(await createClient(), brand.id),
  ]);
  const now = new Date();
  return (
    <PrivateShell privateUnread={unread}>
      {conversations.length === 0 ? (
        <p className="text-muted-foreground">{m.chat.private.none}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {conversations.map((c) => (
            <li key={c.conversationId}>
              <Link href={`/chat/private/${c.otherProfileId}`} className="flex items-center gap-3 rounded-xl bg-card p-3 hover:bg-raised">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{c.otherName}</span>
                  <span className="truncate text-sm text-muted-foreground">{c.lastText ?? (c.lastHasPhoto ? m.chat.private.photoOnly : "")}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{chatTime(c.lastAt, brand.timezone, now)}</span>
                {c.unread > 0 && <span className="shrink-0 rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">{c.unread}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PrivateShell>
  );
}

export default function PrivatePage() {
  return (
    <Suspense fallback={null}>
      <Conversations />
    </Suspense>
  );
}
