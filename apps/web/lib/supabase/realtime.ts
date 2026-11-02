import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/**
 * Opens a Realtime channel as the signed-in user and returns the cleanup for a React effect. Realtime checks a
 * postgres_changes subscription against the token it joins with, and right after a page loads the browser client
 * hasn't read the session yet — joining then would join as a visitor, who can't see the table ("invalid column for
 * filter"), and the subscription is refused. So the user's token goes to Realtime first. `open` gets a topic suffix
 * of its own per call: React (dev) mounts effects twice, and a second channel on the same topic would reuse the one
 * still leaving.
 */
export function subscribeSignedIn(supabase: SupabaseClient, open: (suffix: string) => RealtimeChannel): () => void {
  let channel: RealtimeChannel | null = null;
  let closed = false;
  const start = () => {
    if (!closed) channel = open(crypto.randomUUID());
  };
  supabase.realtime.setAuth().then(start, start);
  return () => {
    closed = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
