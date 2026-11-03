import { expect, test, type Page } from '@playwright/test';
import { chatPlayer, localAdmin, removeTestPlayer, send, signIn } from './helpers';

// The chat's pop-ups (a player's panel, a message's ⋯ menu and its report form) close the way people expect —
// a Close button, Escape, a tap outside — and on a phone they sit fully on screen, even for the newest message.

const PHONE = { viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true };

/** Every way out of an open pop-up, one after the other: Close, Escape, a tap outside. */
async function closesEveryWay(page: Page, open: () => Promise<void>, sheet: ReturnType<Page['getByRole']>) {
  await open();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();

  await open();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await open();
  await expect(sheet).toBeVisible();
  await page.mouse.click(20, 20); // the top corner: outside the sheet
  await expect(sheet).toBeHidden();
}

test('a player panel and a message menu close with Close, Escape or a tap outside, and fit on a phone', async ({ browser }) => {
  test.setTimeout(120_000);
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  const a = await chatPlayer(db, org!.id, 'Sami');
  const b = await chatPlayer(db, org!.id, 'Tanvir');
  try {
    const pageA = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext(PHONE)).newPage();
    await signIn(pageA, a.email, '/chat');
    await signIn(pageB, b.email, '/chat');
    await send(pageA, 'popup check from Sami');

    const samis = pageB.getByRole('listitem').filter({ hasText: 'popup check from Sami' });
    await expect(samis).toBeVisible({ timeout: 5_000 });

    // The player panel, opened from the newest message on a phone: its buttons are on screen, and it closes.
    const name = samis.getByRole('button', { name: 'Sami' });
    const panel = pageB.getByRole('dialog', { name: 'Sami' });
    await name.click();
    await expect(panel.getByRole('link', { name: 'Message' })).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole('button', { name: 'Block' })).toBeInViewport({ ratio: 1 });
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toBeHidden();
    await expect(name).toBeFocused(); // back where you were
    await closesEveryWay(pageB, () => name.click(), panel);

    // The ⋯ menu: it says which message it is for, and Report can be backed out of without reporting.
    const menu = pageB.getByRole('dialog', { name: 'Message options' });
    const openMenu = () => samis.getByRole('button', { name: 'Message options' }).click();
    await openMenu();
    await expect(menu.getByText('popup check from Sami')).toBeVisible();
    await menu.getByRole('button', { name: 'Report' }).click();
    await expect(menu.getByRole('button', { name: 'Send report' })).toBeInViewport({ ratio: 1 });
    await menu.getByRole('button', { name: 'Cancel' }).click();
    await expect(menu).toBeHidden();
    await expect(pageB.getByText('Thanks — the venue team will take a look.')).toHaveCount(0);
    await closesEveryWay(pageB, openMenu, menu);

    // Nothing was reported along the way.
    const { count } = await db.from('chat_reports').select('id', { count: 'exact', head: true }).eq('reporter_profile_id', b.profileId);
    expect(count).toBe(0);

    // Message, from the panel, opens the private chat ready to type in — the panel doesn't stay behind and block it.
    await name.click();
    await panel.getByRole('link', { name: 'Message' }).click();
    await expect(pageB).toHaveURL(new RegExp(`/chat/private/${a.profileId}$`));
    await send(pageB, 'hello from the panel');

    // Back to the room, open a panel, then the phone's Forward (or Back) with it open: the page still answers.
    await pageB.goBack();
    await expect(pageB).toHaveURL(/\/chat$/);
    await name.click();
    await expect(panel).toBeVisible();
    await pageB.goForward();
    await expect(pageB).toHaveURL(new RegExp(`/chat/private/${a.profileId}$`));
    await pageB.waitForTimeout(3_100); // the chat's pace between messages
    await send(pageB, 'still answering');
  } finally {
    await removeTestPlayer(db, a.email);
    await removeTestPlayer(db, b.email);
  }
});
