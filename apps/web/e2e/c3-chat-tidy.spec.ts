import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { chatPlayer, localAdmin, removeTestPlayer, signIn } from './helpers';

// Loose ends from the chat reviews: the Chat link counts and lights where it should (the phone's tab too, on the
// private pages, never for someone you blocked), setting up a profile from the chat comes back to it, a private
// chat loads its older messages, and a transparent photo doesn't turn black.

const PHONE = { viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true };
const CLEAR_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAADElEQVR4nGNgoBwAAABEAAHX40j9AAAAAElFTkSuQmCC', 'base64');

async function orgId() {
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  return { db, organizationId: org!.id as string };
}

test('setting up a profile from the chat comes back to the chat', async ({ browser }) => {
  const { db, organizationId } = await orgId();
  const email = `e2e-chat-new-${randomUUID().slice(0, 8)}@example.test`;
  await db.auth.admin.createUser({ email, email_confirm: true });
  try {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, email, '/chat');
    await page.getByRole('link', { name: 'Set up your player profile to chat' }).click();
    await expect(page).toHaveURL(/\/me\/edit\?next=%2Fchat|\/me\/edit\?next=\/chat/);
    await page.getByLabel('Name other players see').fill('Rumi');
    const { data: sections } = await db.from('sections').select('name').eq('organization_id', organizationId);
    for (const section of sections ?? []) {
      await page.getByRole('group', { name: `How good are you at ${section.name}?` }).getByText('3 · Solid').click();
    }
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/chat');
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  } finally {
    await removeTestPlayer(db, email);
  }
});

test("the Chat link counts private messages on a phone's tab bar, and counts down while you read", async ({ browser }) => {
  test.setTimeout(120_000);
  const { db, organizationId } = await orgId();
  const a = await chatPlayer(db, organizationId, 'Sami');
  const b = await chatPlayer(db, organizationId, 'Tanvir');
  const dm = (body: string) => db.rpc('post_private_message', { p_organization_id: organizationId, p_user_id: a.userId, p_to_profile_id: b.profileId, p_body: body });
  try {
    const page = await (await browser.newContext(PHONE)).newPage();
    await signIn(page, b.email, '/');
    const tabBar = page.locator('[data-bottom-nav]');
    expect((await dm('are you free tonight?')).error).toBeNull();
    const oneUnread = tabBar.getByRole('link', { name: 'Chat — 1 unread private message' });
    await expect(oneUnread).toBeVisible({ timeout: 10_000 });
    await expect(oneUnread).toContainText('1'); // the number itself, not just a dot

    // Reading the conversation brings the count down without leaving it.
    await page.goto(`/chat/private/${a.profileId}`);
    await expect(page.getByText('are you free tonight?')).toBeVisible();
    await page.waitForTimeout(3_100); // the chat's pace between messages
    expect((await dm('court 2 at 9?')).error).toBeNull();
    await expect(page.getByText('court 2 at 9?')).toBeVisible({ timeout: 10_000 });
    await expect(tabBar.getByRole('link', { name: /^Chat — 1 unread/ })).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await removeTestPlayer(db, a.email);
    await removeTestPlayer(db, b.email);
  }
});

test("a room message lights the Chat link on the private pages, but never one from a player you've blocked", async ({ browser }) => {
  test.setTimeout(120_000);
  const { db, organizationId } = await orgId();
  const a = await chatPlayer(db, organizationId, 'Sami');
  const b = await chatPlayer(db, organizationId, 'Tanvir');
  const c = await chatPlayer(db, organizationId, 'Nadia');
  const say = (userId: string, body: string) => db.rpc('post_chat_message', { p_organization_id: organizationId, p_user_id: userId, p_body: body });
  try {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, b.email, '/chat/private');
    const lit = page.getByRole('link', { name: 'Chat — new messages' });
    await page.waitForTimeout(1_500); // the link is listening
    expect((await say(a.userId, 'anyone for 5-a-side?')).error).toBeNull();
    await expect(lit).toBeVisible({ timeout: 10_000 });

    // Tanvir reads the room, blocks Sami, and goes elsewhere: Sami's next message lights nothing — now or on a reload.
    await page.goto('/chat');
    await expect(page.getByText('anyone for 5-a-side?')).toBeVisible();
    await expect.poll(async () => (await db.from('chat_reads').select('room_read_at').eq('user_id', b.userId)).data?.[0]?.room_read_at ?? null).not.toBeNull();
    await db.from('chat_blocks').insert({ organization_id: organizationId, blocker_profile_id: b.profileId, blocked_profile_id: a.profileId });
    await page.goto('/');
    await page.waitForTimeout(1_500);
    await page.waitForTimeout(3_100); // Sami's pace between messages
    expect((await say(a.userId, 'still looking for players')).error).toBeNull();
    await page.waitForTimeout(3_000);
    await expect(lit).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('link', { name: 'Chat', exact: true }).first()).toBeVisible();
    await expect(lit).toHaveCount(0);
    // Someone else's message still does.
    expect((await say(c.userId, 'I can play')).error).toBeNull();
    await expect(lit.first()).toBeVisible({ timeout: 10_000 });
  } finally {
    for (const p of [a, b, c]) await removeTestPlayer(db, p.email);
  }
});

test('a private chat loads its older messages', async ({ browser }) => {
  test.setTimeout(120_000);
  const { db, organizationId } = await orgId();
  const a = await chatPlayer(db, organizationId, 'Sami');
  const b = await chatPlayer(db, organizationId, 'Tanvir');
  try {
    const first = await db.rpc('post_private_message', { p_organization_id: organizationId, p_user_id: a.userId, p_to_profile_id: b.profileId, p_body: 'newest' });
    const conversationId = (first.data as Array<{ conversation_id: string }>)[0]!.conversation_id;
    const start = Date.now() - 3 * 3_600_000;
    const older = Array.from({ length: 55 }, (_, i) => ({
      organization_id: organizationId,
      author_user_id: a.userId,
      author_profile_id: a.profileId,
      author_kind: 'player',
      author_name: 'Sami',
      body: `older ${i + 1}`,
      conversation_id: conversationId,
      created_at: new Date(start + i * 60_000).toISOString(),
    }));
    expect((await db.from('chat_messages').insert(older)).error).toBeNull();

    const page = await (await browser.newContext()).newPage();
    await signIn(page, b.email, `/chat/private/${a.profileId}`);
    await expect(page.getByText('newest')).toBeVisible();
    await expect(page.getByText('older 1', { exact: true })).toHaveCount(0);
    await expect(async () => {
      await page.getByRole('button', { name: 'Load earlier' }).click();
      await expect(page.getByText('older 1', { exact: true })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
  } finally {
    await removeTestPlayer(db, a.email);
    await removeTestPlayer(db, b.email);
  }
});

test("a transparent picture is sent on white, not black", async ({ browser }) => {
  const { db, organizationId } = await orgId();
  const a = await chatPlayer(db, organizationId, 'Sami');
  try {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, a.email, '/chat');
    await page.getByLabel('Add photo').setInputFiles({ name: 'clear.png', mimeType: 'image/png', buffer: CLEAR_PNG });
    await expect(page.getByRole('button', { name: 'Remove photo' })).toBeVisible();
    const pixel = await page.locator('img[src^="blob:"]').evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(img, 0, 0);
      return [...context.getImageData(1, 1, 1, 1).data.slice(0, 3)];
    });
    expect(Math.min(...pixel)).toBeGreaterThan(240);
  } finally {
    const own = await db.storage.from('chat-photos').list(a.userId);
    if (own.data?.length) await db.storage.from('chat-photos').remove(own.data.map((f) => `${a.userId}/${f.name}`));
    await removeTestPlayer(db, a.email);
  }
});
