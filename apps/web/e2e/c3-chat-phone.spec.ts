import { expect, test, type Page } from '@playwright/test';
import { chatPlayer, localAdmin, removeTestPlayer, send, signIn } from './helpers';

// On a phone the chat box is on screen as soon as a chat opens — above the bottom tab bar, with no scrolling —
// and the newest message sits just above it.

const PHONE = { viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true };

async function boxIsOnScreen(page: Page) {
  const box = page.getByRole('textbox', { name: 'Message' });
  const sendButton = page.getByRole('button', { name: 'Send' });
  await expect(box).toBeInViewport({ ratio: 1 });
  await expect(sendButton).toBeInViewport({ ratio: 1 });
  const tabBar = await page.locator('[data-bottom-nav]').boundingBox();
  const sent = await sendButton.boundingBox();
  const photo = await page.getByText('Add photo').boundingBox();
  expect(tabBar).not.toBeNull();
  // Nothing of the chat box hides behind the tab bar.
  expect(sent!.y + sent!.height).toBeLessThanOrEqual(tabBar!.y);
  expect(photo!.y + photo!.height).toBeLessThanOrEqual(tabBar!.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

test('on a phone the chat box is on screen without scrolling, in the room and in a private chat', async ({ browser }) => {
  test.setTimeout(120_000);
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  const a = await chatPlayer(db, org!.id, 'Sami');
  const b = await chatPlayer(db, org!.id, 'Tanvir');
  try {
    const page = await (await browser.newContext(PHONE)).newPage();
    await signIn(page, a.email, '/chat');
    await send(page, 'phone layout check');
    await page.reload();
    await boxIsOnScreen(page);

    // The newest message sits right above the box, not at the top of an empty list.
    const newest = await page.getByRole('listitem').filter({ hasText: 'phone layout check' }).boundingBox();
    const box = await page.getByRole('textbox', { name: 'Message' }).boundingBox();
    expect(box!.y - (newest!.y + newest!.height)).toBeLessThan(60);

    // A small phone too (an iPhone SE's screen with the browser's bars showing).
    await page.setViewportSize({ width: 375, height: 560 });
    await page.reload();
    await boxIsOnScreen(page);
    await page.setViewportSize(PHONE.viewport);

    await page.goto(`/chat/private/${b.profileId}`);
    await expect(page.getByRole('heading', { name: 'Messages with Tanvir' })).toBeVisible();
    await boxIsOnScreen(page);
  } finally {
    await removeTestPlayer(db, a.email);
    await removeTestPlayer(db, b.email);
  }
});
