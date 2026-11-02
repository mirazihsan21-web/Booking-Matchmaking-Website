import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { chatPlayer, localAdmin, removeTestPlayer, signIn } from './helpers';

const OWNER = 'owner@demo-arena.test';
// A 4×4 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGO4YGAARwzEcQD4QxMBrujpGwAAAABJRU5ErkJggg==', 'base64');

test('a reported private photo reaches the team, who can see it and remove it', async ({ browser }) => {
  test.setTimeout(120_000);
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  const a = await chatPlayer(db, org!.id, 'Sami');
  const b = await chatPlayer(db, org!.id, 'Tanvir');
  const path = `${a.userId}/${randomUUID()}.jpg`;
  try {
    // Sami sends Tanvir a photo.
    const upload = await db.storage.from('chat-photos').upload(path, PNG, { contentType: 'image/png' });
    if (upload.error) throw upload.error;
    const { error } = await db.rpc('post_private_message', {
      p_organization_id: org!.id,
      p_user_id: a.userId,
      p_to_profile_id: b.profileId,
      p_body: null,
      p_photo_path: path,
    });
    if (error) throw error;

    // Tanvir reports it as an inappropriate photo.
    const pageB = await (await browser.newContext()).newPage();
    await signIn(pageB, b.email, '/chat');
    await pageB.goto(`/chat/private/${a.profileId}`);
    const item = pageB.getByRole('listitem').filter({ has: pageB.getByRole('img', { name: 'Photo from Sami' }) });
    await expect(item).toBeVisible();
    await item.getByRole('button', { name: 'Message options' }).click();
    await item.getByRole('button', { name: 'Report' }).click();
    await item.getByLabel('Inappropriate photo').check();
    await item.getByRole('button', { name: 'Send report' }).click();
    await expect(pageB.getByText('Thanks — the venue team will take a look.')).toBeVisible();

    // The team sees it — marked private, the photo loaded — and removes it.
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner, OWNER, '/manage');
    await owner.goto('/manage/chat');
    const reported = owner.getByRole('listitem').filter({ hasText: 'Private message' }).filter({ hasText: 'Sami' });
    await expect(reported).toBeVisible();
    const photo = reported.getByRole('img', { name: 'The reported photo' });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await reported.getByRole('button', { name: 'Remove message' }).click();

    await expect(pageB.getByText('Message removed by the venue')).toBeVisible({ timeout: 8_000 });
    await expect.poll(async () => (await db.from('chat_photo_trash').select('path').eq('path', path)).data?.length).toBe(1);
  } finally {
    await db.storage.from('chat-photos').remove([path]);
    await db.from('chat_photo_trash').delete().eq('path', path);
    await removeTestPlayer(db, a.email);
    await removeTestPlayer(db, b.email);
  }
});
