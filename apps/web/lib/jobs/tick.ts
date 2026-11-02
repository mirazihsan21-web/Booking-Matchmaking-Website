import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailSender } from '@/lib/email/sender';
import { deliverPendingEmails } from '@/lib/notifications/deliver';
import { matchSession, offerNext, seatsLeft } from '@/lib/open-play/open-play';

export interface TickReport {
  offers: { expired: number; offered: number };
  /** Sessions matched this tick. */
  matched: string[];
  closed: number;
  /**
   * Chat cards closed this tick, whether old chat was purged (once an hour, on the hour), unread private-message
   * reminders written, and photos deleted from Storage.
   */
  chat: { closed: number; purged: boolean; reminders: number; photosDeleted: number };
  emails: { sent: number; skipped: number; failed: number } | { error: string };
}

/** Sessions matched per tick; the rest wait for the next one (spec §5). */
const MATCHES_PER_TICK = 10;
/** Free seats swept per tick (see the refill step). */
const REFILLS_PER_TICK = 50;

/**
 * One run of the timed work, called every minute by pg_cron through POST /api/jobs/tick. Every
 * step is capped and safe to repeat, so overlapping ticks are harmless, and each runs on its own: a
 * failing step is logged and the next one still runs. Order: pass on expired offers, offer any free
 * seat whose hand-off was lost, match sessions that reached their cut-off, close sessions that started,
 * close chat cards whose game is cancelled, started or out of seats, purge old chat on the hour, then send
 * the emails all of that wrote. `now` (for tests) decides only when the purge runs.
 * The email sender is only built in its step, so missing email settings stop nothing else.
 */
export async function runTick(deps: { db: SupabaseClient; createSender: () => EmailSender; now?: Date }): Promise<TickReport> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const report: TickReport = {
    offers: { expired: 0, offered: 0 },
    matched: [],
    closed: 0,
    chat: { closed: 0, purged: false, reminders: 0, photosDeleted: 0 },
    emails: { sent: 0, skipped: 0, failed: 0 },
  };

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

  await step('chat cards', async () => {
    const { data, error } = await db.rpc('close_due_chat_cards');
    if (error) throw error;
    report.chat.closed += (data as unknown[]).length;
    // Session cards close as full once their game has no seats left (seats are counted here, as on the site).
    const { data: open, error: openError } = await db.from('chat_cards').select('organization_id, session_id').eq('kind', 'session').eq('status', 'open');
    if (openError) throw openError;
    const byOrg = new Map<string, string[]>();
    for (const row of open as Array<{ organization_id: string; session_id: string }>) {
      byOrg.set(row.organization_id, [...(byOrg.get(row.organization_id) ?? []), row.session_id]);
    }
    for (const [organizationId, sessionIds] of byOrg) {
      const left = await seatsLeft(db, { organizationId, sessionIds });
      const full = sessionIds.filter((id) => left.get(id) === 0);
      if (full.length === 0) continue;
      const closed = await db.rpc('close_session_cards', { p_session_ids: full });
      if (closed.error) throw closed.error;
      report.chat.closed += closed.data as number;
    }
  });

  await step('chat purge', async () => {
    if (now.getUTCMinutes() !== 0) return;
    const { error } = await db.rpc('purge_chat', { p_now: now.toISOString() });
    if (error) throw error;
    report.chat.purged = true;
  });

  await step('chat reminders', async () => {
    const { data, error } = await db.rpc('due_private_message_reminders');
    if (error) throw error;
    report.chat.reminders = data as number;
  });

  await step('chat photos', async () => {
    // Photos the database queued (removed, purged, never posted) are deleted through Storage, then forgotten. If
    // Storage fails, nothing is forgotten and the next tick tries again; a path Storage no longer has is gone already.
    const { data, error } = await db.rpc('take_chat_photo_trash', { p_limit: 100 });
    if (error) throw error;
    const paths = data as string[];
    if (paths.length === 0) return;
    const removed = await db.storage.from('chat-photos').remove(paths);
    if (removed.error) throw removed.error;
    const forgot = await db.rpc('forget_chat_photo_trash', { p_paths: paths });
    if (forgot.error) throw forgot.error;
    report.chat.photosDeleted = (removed.data ?? []).length;
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
