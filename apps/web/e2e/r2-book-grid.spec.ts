import { expect, test, type Page } from '@playwright/test';
import { localAdmin, signIn } from './helpers';

/** Tomorrow on the booking page's day strip (today may be closed or over). */
async function tomorrow(page: Page) {
  const days = page.getByRole('navigation', { name: 'Day' }).locator('a:not([aria-label])');
  await days.nth(1).click();
  await expect(days.nth(1)).toHaveAttribute('aria-current', 'date');
}

test('a visitor sees which slots are free, with a key, and is asked to sign in to book', async ({ page }) => {
  await page.goto('/turf/book');
  // No sign-in needed to look.
  await expect(page).toHaveURL((url) => url.pathname === '/turf/book');
  const key = page.getByRole('list', { name: 'What the slots mean' });
  for (const word of ['Free', 'Taken', 'Open play', 'Started']) await expect(key.getByText(word, { exact: true })).toBeVisible();

  await tomorrow(page);
  await expect(page).toHaveURL((url) => url.pathname === '/turf/book');
  const slot = page.locator('fieldset button:not([disabled])').first();
  // Screen readers hear each slot's state with its time.
  await expect(slot).toHaveAccessibleDescription('Free');
  await slot.click();
  await expect(page.getByRole('button', { name: 'Book', exact: true })).toHaveCount(0);
  const signInLink = page.getByRole('link', { name: 'Sign in to book' });
  await expect(signInLink).toHaveAttribute('href', /^\/signin\?next=%2Fturf%2Fbook%3F/);
  await signInLink.click();
  await expect(page).toHaveURL((url) => url.pathname === '/signin');
});

test('a slot someone else books turns Taken on an open page without reloading', async ({ page }) => {
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  const { data: turf } = await db.from('sections').select('id').eq('organization_id', org!.id).eq('slug', 'turf').single();
  const { data: pitch } = await db.from('resources').select('id').eq('section_id', turf!.id).eq('name', 'Pitch 1').single();
  // A player of the demo brand (not on its team) watches the grid.
  const { data: team } = await db.from('organization_members').select('user_id').eq('organization_id', org!.id);
  const teamIds = new Set((team ?? []).map((t) => t.user_id as string));
  const { data: profiles } = await db.from('player_profiles').select('user_id').eq('organization_id', org!.id);
  const playerId = (profiles ?? []).map((p) => p.user_id as string).find((id) => !teamIds.has(id))!;
  const { data: player } = await db.auth.admin.getUserById(playerId);
  let bookingId: string | undefined;
  try {
    await page.clock.install();
    await signIn(page, player.user!.email!, '/turf/book');
    await page.goto(`/turf/book?resource=${pitch!.id}`);
    await tomorrow(page);
    const slot = page.locator('fieldset button:not([disabled])').first();
    const label = (await slot.innerText()).trim();
    const startsAt = (await slot.getAttribute('value'))!;

    // Someone at the desk books that slot.
    const { data, error } = await db.rpc('book_resource', {
      p_organization_id: org!.id,
      p_resource_id: pitch!.id,
      p_starts_at: startsAt,
      p_slots: 1,
      p_profile_id: null,
      p_guest_name: 'E2E Refresh',
      p_guest_phone: '01712345678',
      p_created_by: teamIds.values().next().value,
    });
    if (error) throw error;
    bookingId = (data as Array<{ status: string; booking_id: string }>)[0]!.booking_id;

    // Half a minute later the open page shows it taken.
    await page.clock.runFor(31_000);
    const chip = page.getByRole('button', { name: label, exact: true });
    await expect(chip).toBeDisabled();
    await expect(chip).toHaveAccessibleDescription('Taken');
  } finally {
    if (bookingId) {
      await db.from('resource_reservations').delete().eq('source', 'booking').eq('source_id', bookingId);
      await db.from('resource_bookings').delete().eq('id', bookingId);
    }
  }
});
