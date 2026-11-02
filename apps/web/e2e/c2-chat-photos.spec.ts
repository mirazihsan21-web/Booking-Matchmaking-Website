import { expect, test } from '@playwright/test';
import { chatPlayer, localAdmin, removeTestPlayer, signIn } from './helpers';

// A 4×4 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGO4YGAARwzEcQD4QxMBrujpGwAAAABJRU5ErkJggg==', 'base64');

test('players share a photo in the room; a file that is too big or not a photo is refused before upload; removing queues it for deletion', async ({ browser }) => {
  test.setTimeout(120_000);
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  const a = await chatPlayer(db, org!.id, 'Sami');
  const b = await chatPlayer(db, org!.id, 'Tanvir');
  const uploads = async () => ((await db.storage.from('chat-photos').list(a.userId)).data ?? []).length;
  try {
    const pageA = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext()).newPage();
    await signIn(pageA, a.email, '/chat');
    await signIn(pageB, b.email, '/chat');

    // Too big, and not really a photo: refused with a plain sentence, nothing uploaded.
    await pageA.getByLabel('Add photo').setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(6 * 1024 * 1024) });
    await expect(pageA.getByText('Photos can be up to 5 MB.')).toBeVisible();
    await pageA.getByLabel('Add photo').setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('just some text, not a photo') });
    await expect(pageA.getByText("That photo type isn't supported — try a JPEG or PNG.")).toBeVisible();
    expect(await uploads()).toBe(0);

    // A real photo with a caption: Tanvir sees it, live.
    await pageA.getByLabel('Add photo').setInputFiles({ name: 'team.png', mimeType: 'image/png', buffer: PNG });
    await expect(pageA.getByRole('button', { name: 'Remove photo' })).toBeVisible();
    await pageA.getByRole('textbox', { name: 'Message' }).fill('our team');
    await pageA.getByRole('button', { name: 'Send' }).click();
    const photo = pageB.getByRole('img', { name: 'Photo from Sami' });
    await expect(photo).toBeVisible({ timeout: 8_000 });
    await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(pageB.getByText('our team')).toBeVisible();
    expect(await uploads()).toBe(1);

    // Removed: the photo goes for everyone, and is queued for deletion from Storage.
    const mine = pageA.getByRole('listitem').filter({ hasText: 'our team' });
    await mine.getByRole('button', { name: 'Message options' }).click();
    await mine.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(pageB.getByText('Message removed')).toBeVisible({ timeout: 5_000 });
    await expect(pageB.getByRole('img', { name: 'Photo from Sami' })).toHaveCount(0);
    const { data: queued } = await db.from('chat_photo_trash').select('path').like('path', `${a.userId}/%`);
    expect(queued?.length).toBe(1);
  } finally {
    const own = await db.storage.from('chat-photos').list(a.userId);
    if (own.data?.length) await db.storage.from('chat-photos').remove(own.data.map((f) => `${a.userId}/${f.name}`));
    await db.from('chat_photo_trash').delete().like('path', `${a.userId}/%`);
    await removeTestPlayer(db, a.email);
    await removeTestPlayer(db, b.email);
  }
});
