"use client";

import { Bell as BellIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { unreadCount } from "@/lib/notifications/inbox";
import { createClient } from "@/lib/supabase/client";
import { m } from "@/messages";

/**
 * The unread count, kept live: Realtime announces each new notification for this player (RLS makes
 * sure nobody else's arrive), and the bell then re-reads the count. Re-reading rather than adding 1
 * matters: after a server refresh the count already includes the new row, and Realtime can deliver a
 * row more than once. Render it with `key={initialUnread}` so a server refresh resets it.
 */
export function Bell({ profileId, organizationId, initialUnread }: { profileId: string; organizationId: string; initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`bell:${profileId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `profile_id=eq.${profileId}` }, () => {
        unreadCount(supabase, profileId, organizationId).then(setUnread, () => undefined);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId, organizationId]);

  return (
    <Link href="/me/notifications" aria-label={m.notifications.bell(unread)} className="relative inline-flex rounded-lg p-2 hover:bg-foreground/5">
      <BellIcon className="size-5" aria-hidden />
      {unread > 0 && (
        <span data-testid="unread" className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs font-semibold leading-5 text-primary-foreground">
          {unread}
        </span>
      )}
    </Link>
  );
}
