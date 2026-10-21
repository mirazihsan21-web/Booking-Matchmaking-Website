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
/** Free seats swept per tick (see the refill step). */
const REFILLS_PER_TICK = 50;

/**
 * One run of the timed work, called every 10 seconds by pg_cron through POST /api/jobs/tick. Every
 * step is capped and safe to repeat, so overlapping ticks are harmless, and each runs on its own: a
 * failing step is logged and the next one still runs. Order: pass on expired offers, offer any free
 * seat whose hand-off was lost, match sessions that reached their cut-off, close sessions that started,
 * then send the emails all of that wrote.
 * The email sender is only built in its step, so missing email settings stop nothing else.
 */
export async function runTick(deps: { db: SupabaseClient; createSender: () => EmailSender }): Promise<TickReport> {
  const { db } = deps;
  const report: TickReport = { offers: { expired: 0, offered: 0 }, matched: [], closed: 0, emails: { sent: 0, skipped: 0, failed: 0 } };

  await step('offers', async () => {
    const { data, error } = await db.rpc('expire_offers');
    if (error) throw error;
    // Every freed seat is handed on now (expire_offers returns a seat only once); one seat failing
    // doesn't stop the rest, and the refill step picks it up next tick.
    for (const seat of data as Array<{ group_id: string; seat_no: number }>) {
      report.offers.expired += 1;
      await step('offer', async () => {
        if ((await offerNext(db, { groupId: seat.group_id, seatNo: seat.seat_no })) === 'offered') report.offers.offered += 1;
      });
    }
  });

  await step('refill', async () => {
    // Free seats with someone waiting who wants them but no offer out: a hand-off lost to a failure.
    const { data, error } = await db.rpc('unoffered_free_seats', { p_limit: REFILLS_PER_TICK });
    if (error) throw error;
    for (const seat of data as Array<{ group_id: string; seat_no: number }>) {
      await step('refill seat', async () => {
        if ((await offerNext(db, { groupId: seat.group_id, seatNo: seat.seat_no })) === 'offered') report.offers.offered += 1;
      });
    }
  });

  await step('match', async () => {
    // Only sessions with enough requests to form a group, so ones that can't fill don't use up the cap.
    const { data, error } = await db.rpc('sessions_due_for_matching', { p_limit: MATCHES_PER_TICK });
    if (error) throw error;
    for (const s of data as Array<{ session_id: string; organization_id: string }>) {
      if ((await matchSession(db, { organizationId: s.organization_id, sessionId: s.session_id })) === 'matched') report.matched.push(s.session_id);
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
