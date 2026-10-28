import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { localAdmin, signIn } from './helpers';

const OWNER = 'owner@demo-arena.test';
const taka = (text: string) => Number(text.replace(/[^\d.]/g, ''));

/** The cash taken today on Today's summary line ("… ৳2,500 taken in cash"). */
async function cashOnToday(page: Page): Promise<number> {
  const line = await page.getByText(/taken in cash/).first().innerText();
  return taka(line.match(/৳[\d,]+(?= taken in cash)/)![0]);
}

/** Turf's cash on today's Takings. */
async function turfTakings(page: Page): Promise<number> {
  await page.goto('/manage/takings');
  return taka(await page.getByRole('row', { name: /^Turf/ }).getByRole('cell').first().innerText());
}

async function brandSection(slug: string, section: string) {
  const { db } = localAdmin();
  const { data: org, error } = await db.from('organizations').select('id').eq('slug', slug).single();
  if (error) throw error;
  const { data, error: sectionError } = await db.from('sections').select('id, opening_hours').eq('organization_id', org.id).eq('slug', section).single();
  if (sectionError) throw sectionError;
  return { orgId: org.id as string, sectionId: data.id as string, openingHours: data.opening_hours as Record<string, unknown> };
}

test('the owner books a walk-in, checks them in, takes cash and sees it in Takings', async ({ page }) => {
  const { db, slug } = localAdmin();
  const turf = await brandSection(slug, 'turf');
  const { data: pitch } = await db.from('resources').select('id').eq('section_id', turf.sectionId).eq('name', 'Pitch 1').single();
  const guest = `E2E Walk-in ${randomUUID().slice(0, 4)}`;
  // Today shows only the current business day, and late at night every section is closed. For this run Turf
  // opens 06:00 and closes 05:00 the next morning, every day, so a start is always free today.
  const allDay = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, ['06:00', '05:00']]));
  await db.from('sections').update({ opening_hours: allDay }).eq('id', turf.sectionId);
  try {
    await signIn(page, OWNER, '/manage');
    const takingsBefore = await turfTakings(page);
    await page.goto('/manage');
    const cashBefore = await cashOnToday(page);

    // 1. Book Pitch 1 at the first free start today for a walk-in.
    await page.goto(`/manage?book=${pitch!.id}`);
    const startsAt = new Date(await page.locator('select[name="startsAt"]').inputValue());
    await page.getByLabel('Name').fill(guest);
    await page.getByLabel('Phone').fill('01712345678');
    await page.getByRole('button', { name: 'Book', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Booked.');

    // 2. It is on Today; open it and take the price in cash. The "now" line crosses the bookings under way and
    // must never take their clicks.
    await page.goto('/manage');
    await expect(page.getByLabel('Now').first()).toHaveCSS('pointer-events', 'none');
    await page.getByRole('button', { name: new RegExp(guest) }).first().click();
    const panel = page.locator('dialog[open]');
    const amount = taka(await panel.locator('input[name="amount"]').inputValue());
    expect(amount).toBeGreaterThan(0);
    await panel.getByRole('button', { name: 'Mark paid' }).click();
    await expect(panel.getByRole('button', { name: 'Undo payment' })).toBeVisible();
    await expect(panel.getByText(`Paid ৳${amount.toLocaleString('en-US')} in cash`)).toBeVisible();
    await expect.poll(() => cashOnToday(page)).toBe(cashBefore + amount);

    // 3. Cancelling it from Bookings first asks the desk to give the cash back (cancelling voids the payment); keep it.
    await page.goto('/manage/bookings');
    const row = page.locator('main li').filter({ hasText: guest });
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row.getByText(`Paid ৳${amount.toLocaleString('en-US')} in cash. Give it back before cancelling`)).toBeVisible();
    await row.getByRole('button', { name: 'Keep it' }).click();
    await expect(row.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();

    // 4. Arrived — only possible from 30 minutes before the start (the rule itself is pinned by pgTAP 20_desk_status).
    await page.goto('/manage');
    await page.getByRole('button', { name: new RegExp(guest) }).first().click();
    if (startsAt.getTime() - Date.now() <= 30 * 60_000) {
      await panel.getByRole('button', { name: 'Arrived' }).click();
      await expect(panel.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    } else {
      test.info().annotations.push({ type: 'skipped-step', description: 'Arrived: booking starts later than 30 min' });
    }

    // 5. Takings counts it.
    expect(await turfTakings(page)).toBe(takingsBefore + amount);
  } finally {
    await db.from('sections').update({ opening_hours: turf.openingHours }).eq('id', turf.sectionId);
    const { data: made } = await db.from('resource_bookings').select('id').eq('organization_id', turf.orgId).eq('guest_name', guest);
    const ids = (made ?? []).map((b) => b.id as string);
    if (ids.length) {
      // Its payment, the slot it holds (reservations point at bookings by id, without a cascade), then the booking.
      await db.from('payments').delete().in('resource_booking_id', ids);
      await db.from('resource_reservations').delete().eq('source', 'booking').in('source_id', ids);
      await db.from('resource_bookings').delete().in('id', ids);
    }
  }
});

test('a turf-only staff member sees only turf', async ({ page }) => {
  const { db, slug } = localAdmin();
  const turf = await brandSection(slug, 'turf');
  const cafe = await brandSection(slug, 'cafe');
  const { data: game } = await db.from('open_play_sessions').select('id').eq('section_id', cafe.sectionId).neq('status', 'cancelled').limit(1).single();
  const email = `e2e-staff-${randomUUID().slice(0, 8)}@example.test`;
  const { data: created, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const userId = created.user!.id;
  try {
    await db.from('organization_members').insert({ organization_id: turf.orgId, user_id: userId, role: 'staff' });
    await db.from('section_staff').insert({ organization_id: turf.orgId, section_id: turf.sectionId, user_id: userId });
    await signIn(page, email, '/manage');

    await expect(page.getByText('Pitch 1').first()).toBeVisible();
    await expect(page.getByText('Table 1')).toHaveCount(0);
    await expect(page.getByText('PC Zone A')).toHaveCount(0);
    for (const path of ['/manage/takings', '/manage/sections/cafe', `/manage/games/${game!.id}`]) {
      await page.goto(path);
      // Refused like a page that doesn't exist (the 404 is marked noindex).
      await expect(page.locator('meta[name="robots"][content*="noindex"]').first(), path).toBeAttached();
    }
  } finally {
    await db.from('section_staff').delete().eq('user_id', userId);
    await db.from('organization_members').delete().eq('user_id', userId);
    await db.auth.admin.deleteUser(userId);
  }
});
