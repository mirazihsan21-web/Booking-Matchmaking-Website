"use server";

import { refresh } from "next/cache";
import { markAllRead } from "@/lib/notifications/inbox";
import { createClient } from "@/lib/supabase/server";
import { getSitePlayer } from "@/lib/tenancy/player";

/** Marks the player's notifications read (through RLS, as the player). */
export async function markAllReadAction(): Promise<void> {
  const player = await getSitePlayer();
  if (!player?.profileId) return;
  await markAllRead(await createClient(), player.profileId, player.brand.id);
  refresh();
}
