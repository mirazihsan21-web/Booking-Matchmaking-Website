import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailSender } from '@/lib/email/sender';
import { deliverPendingEmails } from '@/lib/notifications/deliver';
import { matchSession, offerNext } from '@/lib/open-play/open-play';

export interface TickReport {
  offers: { expired: number; offered: number };
  /** Sessions matched this tick. */
  matched: string[];
  closed: number;
  emails: { sent: number; skipped: number; failed: number } | { error: string };
}

/** Sessions matched per tick; the rest wait for the next one (spec §5). */
const MATCHES_PER_TICK = 10;
/** The longest match cut-off a venue can set (7 days), bounding the search for due sessions. */
const MAX_MATCH_CUTOFF_MS = 10_080 * 60_000;

/**
 * One run of the timed work, called every 10 seconds by pg_cron through POST /api/jobs/tick. Every
 * step is capped and safe to repeat, so overlapping ticks are harmless, and each runs on its own: a
 * failing step is logged and the next one still runs. Order: pass on expired offers, match sessions
 * that reached their cut-off, close sessions that started, then send the emails all of that wrote.
 * The email sender is only built in its step, so missing email settings stop nothing else.
 */
export async function runTick(deps: { db: SupabaseClient; createSender: () => EmailSender; now?: Date }): Promise<TickReport> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const report: TickReport = { offers: { expired: 0, offered: 0 }, matched: [], closed: 0, emails: { sent: 0, skipped: 0, failed: 0 } };

  await step('offers', async () => {
    const { data, error } = await db.rpc('expire_offers');
    if (error) throw error;
    // Every freed seat is handed on now: expire_offers returns a seat only once.
    for (const seat of data as Array<{ group_id: string; seat_no: number }>) {
      report.offers.expired += 1;
      if ((await offerNext(db, { groupId: seat.group_id, seatNo: seat.seat_no })) === 'offered') report.offers.offered += 1;
    }
  });

  await step('match', async () => {
    const { data, error } = await db
      .from('open_play_sessions')
      .select('id, organization_id, starts_at, organizations(match_cutoff_minutes), seat_requests(count)')
      .eq('status', 'open')
      .gt('starts_at', now.toISOString())
      .lte('starts_at', new Date(now.getTime() + MAX_MATCH_CUTOFF_MS).toISOString())
      .order('starts_at');
    if (error) throw error;
    const due = (data as unknown as Array<{
      id: string;
      organization_id: string;
      starts_at: string;
      organizations: { match_cutoff_minutes: number };
      seat_requests: Array<{ count: number }>;
    }>)
      .filter((s) => (s.seat_requests[0]?.count ?? 0) > 0)
      .filter((s) => new Date(s.starts_at).getTime() - s.organizations.match_cutoff_minutes * 60_000 <= now.getTime())
      .slice(0, MATCHES_PER_TICK);
    for (const s of due) {
      if ((await matchSession(db, { organizationId: s.organization_id, sessionId: s.id })) === 'matched') report.matched.push(s.id);
    }
  });

  await step('close', async () => {
    const { data, error } = await db.rpc('close_started_sessions');
    if (error) throw error;
    report.closed = (data as unknown[]).length;
  });

  await step('emails', async () => {
    report.emails = await deliverPendingEmails(db, deps.createSender(), { limit: 50 });
  }, (message) => {
    report.emails = { error: message };
  });

  return report;
}

async function step(name: string, work: () => Promise<void>, onError?: (message: string) => void): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`tick step "${name}" failed:`, error);
    onError?.(error instanceof Error ? error.message : String(error));
  }
}
