import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const MAILPIT = 'http://127.0.0.1:54324';

/** A service client for the LOCAL stack (keys from apps/web/.env.local), plus the brand the site runs. */
export function localAdmin(): { db: SupabaseClient; slug: string } {
  const env = Object.fromEntries(
    readFileSync('.env.local', 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('e2e only runs against the local Supabase stack');
  return { db: createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } }), slug: env.BRAND_SLUG! };
}

/**
 * The sign-in link from the newest email to `address` in Mailpit (the local stack's inbox). With `since`,
 * only an email that arrived after it counts, so an older link to the same address is never used.
 */
export async function signInLink(address: string, since?: Date): Promise<string> {
  const after = since ? since.getTime() - 5_000 : 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
    const { messages } = (await search.json()) as { messages?: Array<{ ID: string; Created: string }> };
    const newest = messages?.find((m) => new Date(m.Created).getTime() >= after);
    if (newest) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json()) as { Text?: string };
      const link = message.Text?.match(/https?:\/\/[^\s)"'<>]+\/auth\/v1\/verify\?[^\s)"'<>]+/)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No sign-in email reached ${address}`);
}

/** Signs in the way a person does — by the emailed link — and lands on `next`. */
export async function signIn(page: Page, address: string, next: string): Promise<void> {
  const since = new Date();
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email address').fill(address);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  await page.goto(await signInLink(address, since));
  await expect(page).toHaveURL((url) => url.pathname === next);
}

/**
 * Removes a test player and everything they made: space bookings (with the slots they hold — reservations
 * point at bookings by id, without a cascade), game seats, waitlist places, then the user, whose profile,
 * skills, seat requests and notifications go with it.
 */
export async function removeTestPlayer(db: SupabaseClient, email: string): Promise<void> {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) return;
  const { data: profiles } = await db.from('player_profiles').select('id').eq('user_id', user.id);
  const profileIds = (profiles ?? []).map((p) => p.id as string);
  if (profileIds.length) {
    const { data: spaces } = await db.from('resource_bookings').select('id').in('profile_id', profileIds);
    const spaceIds = (spaces ?? []).map((b) => b.id as string);
    if (spaceIds.length) {
      await db.from('resource_reservations').delete().eq('source', 'booking').in('source_id', spaceIds);
      await db.from('resource_bookings').delete().in('id', spaceIds);
    }
    await db.from('bookings').delete().in('profile_id', profileIds);
    await db.from('waitlist_entries').delete().in('profile_id', profileIds);
  }
  await db.auth.admin.deleteUser(user.id);
}

/**
 * Makes sure the section has an open game coming up for a player to join: when it has none (the demo's games
 * age out), schedules one two days from now at 20:00 Dhaka time through the same RPC the Schedule page uses.
 * Returns the id of the game it made, for removeTestGame, or null.
 */
export async function ensureUpcomingGame(db: SupabaseClient, brandSlug: string, sectionSlug: string): Promise<string | null> {
  const { data: org } = await db.from('organizations').select('id').eq('slug', brandSlug).single();
  const { data: section } = await db.from('sections').select('id').eq('organization_id', org!.id).eq('slug', sectionSlug).single();
  const { data: upcoming } = await db
    .from('open_play_sessions')
    .select('id')
    .eq('section_id', section!.id)
    .in('status', ['open', 'matched'])
    .gt('starts_at', new Date().toISOString())
    .limit(1);
  if (upcoming?.length) return null;
  const { data: spaces } = await db.from('resources').select('id').eq('section_id', section!.id).eq('active', true).order('name', { ascending: false }).limit(1);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(Date.now() + 2 * 86_400_000));
  const { data, error } = await db.rpc('schedule_open_play', {
    p_organization_id: org!.id,
    p_section_id: section!.id,
    p_activity_id: null,
    p_resource_ids: [spaces![0]!.id],
    p_starts_at: [`${day}T20:00:00+06:00`],
    p_duration_min: 60,
    p_seat_price_poisha: 30000,
  });
  if (error) throw error;
  return (data as string[])[0]!;
}

/** Cancels a game made by ensureUpcomingGame (freeing its space) and removes it where nothing else refers to it. */
export async function removeTestGame(db: SupabaseClient, sessionId: string): Promise<void> {
  await db.rpc('cancel_open_play_session', { p_session_id: sessionId });
  await db.from('resource_reservations').delete().eq('source', 'session').eq('source_id', sessionId);
  await db.from('open_play_sessions').delete().eq('id', sessionId);
}
