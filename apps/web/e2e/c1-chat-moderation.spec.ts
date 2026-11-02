import { expect, test, type Page } from '@playwright/test';
import { chatPlayer, localAdmin, removeTestPlayer, send, signIn } from './helpers';

const OWNER = 'owner@demo-arena.test';

/** Reports a message as spam from its ⋯ menu. */
async function report(page: Page, text: string) {
  const item = page.getByRole('listitem').filter({ hasText: text });
  await expect(item).toBeVisible({ timeout: 5_000 });
  await item.getByRole('button', { name: 'Message options' }).click();
  await item.getByRole('button', { name: 'Report' }).click();
  await item.getByLabel('Spam').check();
  await item.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Thanks — the venue team will take a look.')).toBeVisible();
}

test('players report, the venue hides, dismisses, removes, mutes and keeps its own word list', async ({ browser }) => {
  test.setTimeout(180_000);
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  const [a, b, c, d] = await Promise.all(['Sami', 'Tanvir', 'Nadia', 'Dina'].map((name) => chatPlayer(db, org!.id, name)));
  try {
    const pages: Page[] = [];
    for (const p of [a, b, c, d]) {
      const page = await (await browser.newContext()).newPage();
      await signIn(page, p.email, '/chat');
      pages.push(page);
    }
    const [pageA, pageB, pageC, pageD] = pages as [Page, Page, Page, Page];
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner, OWNER, '/manage'); // team logins land in Manage

    // Three reports hide a message at once, for everyone.
    await send(pageD, 'buy cheap boots here');
    for (const page of [pageA, pageB, pageC]) await report(page, 'buy cheap boots here');
    await expect(pageA.getByText('Hidden while the venue checks it')).toBeVisible({ timeout: 5_000 });
    await expect(pageA.getByText('buy cheap boots here')).toHaveCount(0);

    // The team sees the count in Manage and dismisses the reports: the message comes back, live.
    await owner.goto('/manage');
    await expect(owner.getByRole('link', { name: 'Chat (1)' }).first()).toBeVisible();
    await owner.goto('/manage/chat');
    const reported = owner.getByRole('listitem').filter({ hasText: 'buy cheap boots here' });
    await expect(reported.getByText('Dina')).toBeVisible();
    await reported.getByRole('button', { name: 'Dismiss' }).click();
    await expect(pageA.getByText('buy cheap boots here')).toBeVisible({ timeout: 5_000 });

    // The team removes a message from the chat itself.
    await pageD.waitForTimeout(3_100);
    await send(pageD, 'second spam');
    await owner.goto('/chat');
    const spam = owner.getByRole('listitem').filter({ hasText: 'second spam' });
    await spam.getByRole('button', { name: 'Message options' }).click();
    await spam.getByRole('button', { name: 'Remove message' }).click();
    await expect(pageA.getByText('Message removed by the venue')).toBeVisible({ timeout: 5_000 });

    // And mutes the player for a day: they lose the box; Manage lists them; Unmute gives it back.
    const dinas = owner.getByRole('listitem').filter({ hasText: 'buy cheap boots here' });
    await dinas.getByRole('button', { name: 'Message options' }).click();
    await dinas.getByRole('button', { name: 'Mute for 1 day' }).click();
    await expect(owner.getByText('Dina is muted.')).toBeVisible();
    await pageD.reload();
    await expect(pageD.getByText(/You're muted in the chat until/)).toBeVisible();
    await expect(pageD.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
    await owner.goto('/manage/chat');
    const muted = owner.getByRole('listitem').filter({ hasText: 'Dina' }).filter({ has: owner.getByRole('button', { name: 'Unmute' }) });
    await muted.getByRole('button', { name: 'Unmute' }).click();
    await pageD.reload();
    await expect(pageD.getByRole('textbox', { name: 'Message' })).toBeVisible();

    // The venue's own word.
    await owner.getByLabel('Word or phrase').fill('gadha');
    await owner.getByRole('button', { name: 'Add word' }).click();
    await expect(owner.getByRole('listitem').filter({ hasText: 'gadha' })).toBeVisible();
    await send(pageA, 'tui gadha');
    await expect(pageB.getByText('tui ●●●')).toBeVisible({ timeout: 5_000 });
    await owner.getByRole('listitem').filter({ hasText: 'gadha' }).getByRole('button', { name: 'Remove' }).click();
  } finally {
    for (const p of [a, b, c, d]) await removeTestPlayer(db, p.email);
    await db.from('chat_blocked_words').delete().eq('organization_id', org!.id);
  }
});
