import { expect, test } from '@playwright/test';
import { chatPlayer, localAdmin, removeTestPlayer, send, signIn } from './helpers';

test('the players chat is live between two players, with the unread dot, the filter, removing and older messages', async ({ browser }) => {
  test.setTimeout(120_000);
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  const a = await chatPlayer(db, org!.id, 'Sami');
  const b = await chatPlayer(db, org!.id, 'Tanvir');
  try {
    const visitor = await browser.newPage();
    await visitor.goto('/chat');
    await expect(visitor.getByText('Sign in to see the players chat')).toBeVisible();
    await visitor.close();

    const pageA = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext()).newPage();
    await signIn(pageA, a.email, '/chat');
    await signIn(pageB, b.email, '/chat');

    await send(pageA, 'anyone for futsal at 8?');
    await expect(pageB.getByText('anyone for futsal at 8?')).toBeVisible({ timeout: 5_000 });
    await send(pageB, 'me! bringing a friend');
    await expect(pageA.getByText('me! bringing a friend')).toBeVisible({ timeout: 5_000 });

    // Away from the chat, a new message lights the dot; opening the chat clears it.
    await pageB.goto('/');
    await pageA.waitForTimeout(3_100);
    await send(pageA, 'still on?');
    const unread = pageB.getByRole('link', { name: 'Chat — new messages' }).first();
    await expect(unread).toBeVisible({ timeout: 5_000 });
    await unread.click();
    await expect(pageB).toHaveURL((url) => url.pathname === '/chat');
    await expect(pageB.getByRole('link', { name: 'Chat — new messages' })).toHaveCount(0);

    await pageA.waitForTimeout(3_100);
    await send(pageA, 'what the fuck');
    await expect(pageB.getByText('what the ●●●')).toBeVisible({ timeout: 5_000 });
    await expect(pageA.getByText('what the ●●●')).toBeVisible();

    const mine = pageA.getByRole('listitem').filter({ hasText: 'what the ●●●' });
    await mine.getByRole('button', { name: 'Message options' }).click();
    await mine.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(pageB.getByText('Message removed')).toBeVisible({ timeout: 5_000 });
    await expect(pageB.getByText('what the ●●●')).toHaveCount(0);

    // 60 older messages: the room shows the newest 50, Load earlier brings the rest.
    const start = Date.now() - 86_400_000;
    const { error } = await db.from('chat_messages').insert(
      Array.from({ length: 60 }, (_, i) => ({
        organization_id: org!.id,
        author_user_id: b.userId,
        author_profile_id: b.profileId,
        author_kind: 'player',
        author_name: 'Tanvir',
        body: `older ${i + 1}`,
        created_at: new Date(start + i * 1_000).toISOString(),
      })),
    );
    if (error) throw error;
    await db.from('chat_messages').update({ created_at: new Date(start - 86_400_000).toISOString() }).eq('author_user_id', a.userId);
    await db.from('chat_messages').update({ created_at: new Date(start - 86_400_000).toISOString() }).eq('author_user_id', b.userId).not('body', 'like', 'older %');
    await pageB.reload();
    await expect(pageB.getByText('older 60', { exact: true })).toBeVisible();
    await expect(pageB.getByText('older 10', { exact: true })).toHaveCount(0);
    await pageB.getByRole('button', { name: 'Load earlier' }).click();
    await expect(pageB.getByText('older 10', { exact: true })).toBeVisible();
  } finally {
    await removeTestPlayer(db, a.email);
    await removeTestPlayer(db, b.email);
  }
});
