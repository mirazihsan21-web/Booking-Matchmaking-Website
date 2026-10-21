import type { SupabaseClient } from '@supabase/supabase-js';
import { notificationEmail } from '@/lib/email/notification-email';
import type { EmailSender } from '@/lib/email/sender';
import { issueOfferToken } from '@/lib/open-play/open-play';
import { tenantUrl } from '@/lib/tenancy/urls';
import { getPreset } from '@/presets';
import type { NotificationKind } from './render';

interface Venue {
  name: string;
  slug: string;
  timezone: string;
  primary: string;
}

/**
 * Sends a batch of pending notification emails (the outbox). Run by the job tick with the service
 * client. Each row is claimed first, so overlapping runs never send the same email twice; players who
 * opted out, or have no email, are `skipped`. A failed send is retried by a later run (see finish_email).
 * An offer email carries a one-time link: its token is minted here and only its hash is stored, so a
 * retried email gets a fresh link, and an offer that is no longer open sends nothing (`skipped`).
 */
export async function deliverPendingEmails(
  db: SupabaseClient,
  sender: EmailSender,
  opts: { limit: number },
): Promise<{ sent: number; skipped: number; failed: number }> {
  const { data: batch, error } = await db.rpc('claim_pending_emails', { p_limit: opts.limit });
  if (error) throw error;
  const report = { sent: 0, skipped: 0, failed: 0 };
  const venues = new Map<string, Venue | null>();

  const finish = async (id: string, outcome: 'sent' | 'skipped' | 'failed') => {
    const { error: finishError } = await db.rpc('finish_email', { p_notification_id: id, p_outcome: outcome });
    if (finishError) throw finishError;
    report[outcome] += 1;
  };

  for (const row of batch as Array<{ id: string; organization_id: string; profile_id: string; kind: NotificationKind; payload: Record<string, unknown>; link: string }>) {
    try {
      const { data: profile } = await db.from('player_profiles').select('user_id, email_opt_in').eq('id', row.profile_id).maybeSingle();
      const { data: auth } = profile?.email_opt_in ? await db.auth.admin.getUserById(profile.user_id) : { data: null };
      const to = auth?.user?.email;
      const venue = await venueFor(db, venues, row.organization_id);
      if (!to || !venue) {
        await finish(row.id, 'skipped');
        continue;
      }
      let link = row.link;
      if (row.kind === 'offer') {
        const token = await issueOfferToken(db, String(row.payload?.offer_id ?? ''));
        if (!token) {
          await finish(row.id, 'skipped');
          continue;
        }
        link = `/offers/${token}`;
      }
      const email = notificationEmail({
        kind: row.kind,
        payload: row.payload ?? {},
        venueName: venue.name,
        primaryColour: venue.primary,
        siteUrl: tenantUrl(venue.slug),
        link,
        timeZone: venue.timezone,
      });
      await sender.send({ to, ...email });
      await finish(row.id, 'sent');
    } catch (error) {
      // Retried by a later tick until the third attempt (finish_email); log why it failed.
      console.error(`email for notification ${row.id} failed:`, error);
      await finish(row.id, 'failed');
    }
  }
  return report;
}

async function venueFor(db: SupabaseClient, cache: Map<string, Venue | null>, organizationId: string): Promise<Venue | null> {
  if (!cache.has(organizationId)) {
    const { data } = await db.from('organizations').select('name, slug, timezone, business_type, branding').eq('id', organizationId).maybeSingle();
    cache.set(
      organizationId,
      data
        ? {
            name: data.name,
            slug: data.slug,
            timezone: data.timezone,
            primary: (data.branding as { primary?: string } | null)?.primary ?? getPreset(data.business_type).palette.primary,
          }
        : null,
    );
  }
  return cache.get(organizationId)!;
}
