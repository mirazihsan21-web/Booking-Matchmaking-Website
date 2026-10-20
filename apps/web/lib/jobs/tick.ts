import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailSender } from '@/lib/email/sender';
import { deliverPendingEmails } from '@/lib/notifications/deliver';

export interface TickReport {
  emails: { sent: number; skipped: number; failed: number };
}

/**
 * One run of the timed work, called every 10 seconds by pg_cron through POST /api/jobs/tick.
 * Every step is capped and safe to repeat, so overlapping ticks are harmless. Stage B2 adds the
 * open-play steps (expire offers, match due sessions, close started sessions) before the emails.
 */
export async function runTick(deps: { db: SupabaseClient; sender: EmailSender }): Promise<TickReport> {
  const emails = await deliverPendingEmails(deps.db, deps.sender, { limit: 50 });
  return { emails };
}
