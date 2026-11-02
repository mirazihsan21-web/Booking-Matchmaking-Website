import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureUpcomingGame, localAdmin, removeTestGame, removeTestPlayer, signInLink } from './helpers';

const SECTIONS = [
  { slug: 'turf', name: 'Turf' },
  { slug: 'cafe', name: 'Board-game café' },
  { slug: 'lounge', name: 'Gaming lounge' },
];

test('a player signs in once, books a space and joins a game in each section', async ({ page }) => {
  const address = `e2e-${randomUUID().slice(0, 8)}@example.test`;
  const { db, slug } = localAdmin();
  const games: string[] = [];
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });

  try {
    // 1. One sign-in, by email link.
    await page.goto('/signin?next=/me');
    await page.getByLabel('Email address').fill(address);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByText('Check your email')).toBeVisible();
    await page.goto(await signInLink(address));
    // No profile yet: the profile page sends a new player to the form.
    await expect(page).toHaveURL(/\/me\/edit$/);
    await expect(page.getByRole('heading', { name: 'Set up your player profile' })).toBeVisible();
    // Players have no way into the manage area.
    await expect(page.getByRole('link', { name: 'Manage', exact: true })).toHaveCount(0);
    const signedInAt = visited.length;

    // 2. A profile with level 3 in every section.
    await page.getByLabel('Name other players see').fill('E2E Player');
    for (const section of SECTIONS) {
      await page.getByRole('group', { name: `How good are you at ${section.name}?` }).getByText('3 · Solid').click();
    }
    await page.getByRole('button', { name: 'Save profile' }).click();
    // Saving shows the profile itself.
    await expect(page).toHaveURL(/\/me\?saved=1$/);
    await expect(page.getByRole('status')).toHaveText('Profile saved.');

    for (const section of SECTIONS) {
      // 3a. Book tomorrow's first free slot.
      await page.goto(`/${section.slug}/book`);
      const days = page.getByRole('navigation', { name: 'Day' }).locator('a:not([aria-label])');
      await days.nth(1).click();
      await expect(days.nth(1)).toHaveAttribute('aria-current', 'date');
      const slot = page.locator('fieldset button:not([disabled])').first();
      const label = (await slot.innerText()).trim();
      await slot.click();
      await expect(page.getByRole('button', { name: `${label} ✓` })).toBeVisible();
      await page.getByRole('button', { name: 'Book', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('Booked! See My bookings.');
      // The booked slot is taken now — no longer picked or pickable (Task 8's fix).
      await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
      // …and says so to screen readers.
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAccessibleDescription('Taken');

      // 3b. Ask for a seat in the section's first game (or join its waitlist when it is full).
      const made = await ensureUpcomingGame(db, slug, section.slug);
      if (made) games.push(made);
      await page.goto(`/${section.slug}`);
      await page.locator('a[href^="/sessions/"]').first().click();
      await expect(page).toHaveURL(/\/sessions\//);
      await page.getByRole('button', { name: /^(Request a seat|Join the waitlist)$/ }).click();
      await expect(page.getByText(/You've asked for a seat|on the waitlist|You're in!/)).toBeVisible();
    }

    // 4. Signed in once: nothing sent the player back to sign in.
    expect(visited.slice(signedInAt)).not.toContain('/signin');

    // 5. The profile shows who they are here: their levels and their play.
    await page.goto('/me');
    await expect(page.getByText('Turf · 3 Solid')).toBeVisible();
    await expect(page.getByText('Games played')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit profile' })).toBeVisible();
  } finally {
    // Each run is a new player; they and their bookings go, so later runs find tomorrow's slots free.
    await removeTestPlayer(db, address);
    for (const game of games) await removeTestGame(db, game);
  }
});
