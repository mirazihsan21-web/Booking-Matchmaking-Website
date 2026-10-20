"use server";

import { refresh } from "next/cache";
import { markAllRead } from "@/lib/notifications/inbox";
import { createClient } from "@/lib/supabase/server";
import { getPlayer } from "@/lib/tenancy/player";

/** Marks the player's notifications at this venue read (through RLS, as the player). */
export async function markAllReadAction(slug: string): Promise<void> {
  const player = await getPlayer(slug);
  if (!player?.profileId) return;
  await markAllRead(await createClient(), player.profileId, player.org.id);
  refresh();
}
