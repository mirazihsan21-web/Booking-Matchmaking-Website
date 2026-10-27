import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const MAILPIT = 'http://127.0.0.1:54324';
const SECTIONS = [
  { slug: 'turf', name: 'Turf' },
  { slug: 'cafe', name: 'Board-game café' },
  { slug: 'lounge', name: 'Gaming lounge' },
];

/** The sign-in link from the newest email to `address` in Mailpit (the local stack's inbox). */
async function signInLink(address: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
    const { messages } = (await search.json()) as { messages?: Array<{ ID: string }> };
    if (messages?.length) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json()) as { Text?: string };
      const link = message.Text?.match(/https?:\/\/[^\s)"'<>]+\/auth\/v1\/verify\?[^\s)"'<>]+/)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No sign-in email reached ${address}`);
}

test('a player signs in once, books a space and joins a game in each section', async ({ page }) => {
  const address = `e2e-${randomUUID().slice(0, 8)}@example.test`;
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });

  // 1. One sign-in, by email link.
  await page.goto('/signin?next=/me');
  await page.getByLabel('Email address').fill(address);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  await page.goto(await signInLink(address));
  await expect(page).toHaveURL(/\/me$/);
  const signedInAt = visited.length;

  // 2. A profile with level 3 in every section.
  await page.getByLabel('Name other players see').fill('E2E Player');
  for (const section of SECTIONS) {
    await page.getByRole('group', { name: `How good are you at ${section.name}?` }).getByText('3 · Solid').click();
  }
  await page.getByRole('button', { name: 'Save profile' }).click();
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

    // 3b. Ask for a seat in the section's first game (or join its waitlist when it is full).
    await page.goto(`/${section.slug}`);
    await page.locator('a[href^="/sessions/"]').first().click();
    await expect(page).toHaveURL(/\/sessions\//);
    await page.getByRole('button', { name: /^(Request a seat|Join the waitlist)$/ }).click();
    await expect(page.getByText(/You've asked for a seat|on the waitlist|You're in!/)).toBeVisible();
  }

  // 4. Signed in once: nothing sent the player back to sign in.
  expect(visited.slice(signedInAt)).not.toContain('/signin');
});
