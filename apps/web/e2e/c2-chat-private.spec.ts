import { expect, test, type Page } from '@playwright/test';
import { chatPlayer, localAdmin, removeTestPlayer, send, signIn } from './helpers';

// A 4×4 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGO4YGAARwzEcQD4QxMBrujpGwAAAABJRU5ErkJggg==', 'base64');
const wait = (page: Page) => page.waitForTimeout(3_100); // one message every 3 seconds

test('players message each other privately — the unread count, a photo, kept out of the room — and a block stops it', async ({ browser }) => {
  test.setTimeout(180_000);
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  const a = await chatPlayer(db, org!.id, 'Sami');
  const b = await chatPlayer(db, org!.id, 'Tanvir');
  try {
    const pageA = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext()).newPage();
    await signIn(pageA, a.email, '/chat');
    await signIn(pageB, b.email, '/chat');

    await send(pageA, 'room hello from Sami');
    await send(pageB, 'anyone free tonight?');

    // Sami taps Tanvir's name in the room → Message → a private message.
    const tanvirs = pageA.getByRole('listitem').filter({ hasText: 'anyone free tonight?' });
    await tanvirs.getByRole('button', { name: 'Tanvir' }).click();
    await expect(pageA.getByText('Plays:')).toHaveCount(0); // Tanvir has rated no sections
    await pageA.getByRole('link', { name: 'Message' }).click();
    await expect(pageA).toHaveURL(new RegExp(`/chat/private/${b.profileId}$`));
    await wait(pageA);
    await send(pageA, 'hi there');

    // Tanvir, elsewhere on the site, sees the number on the Chat link.
    await pageB.goto('/');
    await expect(pageB.getByRole('link', { name: 'Chat — 1 unread private message' }).first()).toBeVisible({ timeout: 8_000 });
    await pageB.goto('/chat');
    await expect(pageB.getByText('hi there')).toHaveCount(0); // never in the Everyone room
    await pageB.getByRole('link', { name: /^Private/ }).click();
    await pageB.getByRole('link', { name: /Sami/ }).click();
    await expect(pageB.getByText('hi there')).toBeVisible();
    // Reading marks the conversation read (a real person stays longer than the test does).
    await expect
      .poll(async () => (await db.from('chat_conversation_reads').select('read_at').eq('profile_id', b.profileId)).data?.[0]?.read_at ?? null)
      .not.toBeNull();
    await pageB.goto('/');
    await expect(pageB.getByRole('link', { name: 'Chat — 1 unread private message' })).toHaveCount(0, { timeout: 8_000 });

    // Tanvir replies with a photo; Sami sees it live.
    await pageB.goto(`/chat/private/${a.profileId}`);
    await pageB.getByLabel('Add photo').setInputFiles({ name: 'us.png', mimeType: 'image/png', buffer: PNG });
    await expect(pageB.getByRole('button', { name: 'Remove photo' })).toBeVisible();
    await send(pageB, 'here we are');
    const photo = pageA.getByRole('img', { name: 'Photo from Tanvir' });
    await expect(photo).toBeVisible({ timeout: 8_000 });
    await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    // Tanvir blocks Sami: Sami can't message, and Sami's room messages fold away for Tanvir.
    await pageB.getByRole('button', { name: 'Block' }).click();
    await expect(pageB.getByRole('button', { name: 'Unblock' })).toBeVisible();
    await pageA.reload();
    await expect(pageA.getByText("You can't message this player.")).toBeVisible();
    await expect(pageA.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
    await pageB.goto('/chat');
    await expect(pageB.getByText('1 message from someone you blocked')).toBeVisible();
    await expect(pageB.getByText('room hello from Sami')).toHaveCount(0);

    // Unblocked, they can talk again.
    await pageB.goto(`/chat/private/${a.profileId}`);
    await pageB.getByRole('button', { name: 'Unblock' }).click();
    await pageA.reload();
    await expect(pageA.getByRole('textbox', { name: 'Message' })).toBeVisible();
  } finally {
    for (const p of [a, b]) {
      const own = await db.storage.from('chat-photos').list(p.userId);
      if (own.data?.length) await db.storage.from('chat-photos').remove(own.data.map((f) => `${p.userId}/${f.name}`));
      await db.from('chat_photo_trash').delete().like('path', `${p.userId}/%`);
      await removeTestPlayer(db, p.email);
    }
  }
});
