import { expect, test } from '@playwright/test';
import { chatPlayer, localAdmin, removeTestPlayer, signIn } from './helpers';

test('a player short of people posts a card, another asks to join, and after Accept they see each other\'s number', async ({ browser }) => {
  test.setTimeout(150_000);
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  const { data: pitch } = await db.from('resources').select('id, name').eq('organization_id', org!.id).eq('name', 'Pitch 1').single();
  const a = await chatPlayer(db, org!.id, 'Sami', '+8801711111111');
  const b = await chatPlayer(db, org!.id, 'Tanvir', '+8801722222222');
  const c = await chatPlayer(db, org!.id, 'Nadia');
  // Sami's booking: Pitch 1 (14 people) in three days, 8–9pm Dhaka.
  const day = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  const { error } = await db.from('resource_bookings').insert({
    organization_id: org!.id,
    resource_id: pitch!.id,
    profile_id: a.profileId,
    period: `[${day} 20:00+06,${day} 21:00+06)`,
    price_poisha: 0,
  });
  if (error) throw error;

  try {
    const pageA = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext()).newPage();
    await signIn(pageA, a.email, '/chat');
    await signIn(pageB, b.email, '/chat');

    // Sami posts "Need players" for the booking.
    await pageA.getByRole('button', { name: 'Need players' }).click();
    await expect(pageA.getByLabel('Your booking or game')).toContainText('Pitch 1');
    await pageA.getByLabel('Your booking or game').selectOption({ index: 0 });
    await pageA.getByLabel('Players needed').fill('3');
    await pageA.getByLabel('Note (optional)').fill('split the cost');
    await pageA.getByRole('button', { name: 'Post card' }).click();

    // Tanvir sees it live: in the strip and in the room.
    const strip = pageB.getByRole('region', { name: 'Games looking for players' });
    await expect(strip.getByText('Pitch 1')).toBeVisible({ timeout: 5_000 });
    const roomCard = pageB.getByRole('listitem').filter({ hasText: 'split the cost' });
    await expect(roomCard.getByText('3 spots left')).toBeVisible();

    // I'm in → the game page → ask.
    await roomCard.getByRole('link', { name: "I'm in" }).click();
    await expect(pageB).toHaveURL(/\/chat\/games\//);
    const gameUrl = pageB.url();
    await pageB.getByRole('button', { name: "I'm in" }).click();
    await expect(pageB.getByText('Waiting for Sami')).toBeVisible();

    // Sami's bell lights up, live.
    await expect(pageA.getByRole('link', { name: '1 unread notification' })).toBeVisible({ timeout: 5_000 });

    // Sami accepts and sees Tanvir's number.
    await pageA.goto(gameUrl);
    const request = pageA.getByRole('listitem').filter({ hasText: 'Tanvir' });
    await request.getByRole('button', { name: 'Accept' }).click();
    await expect(pageA.getByRole('link', { name: '+8801722222222' })).toBeVisible();
    await expect(pageA.getByText('2 spots left')).toBeVisible();

    // Tanvir is in and sees Sami's number.
    await pageB.reload();
    await expect(pageB.getByText("You're in")).toBeVisible();
    await expect(pageB.getByRole('link', { name: '+8801711111111' })).toBeVisible();

    // Anyone else sees no numbers.
    const pageC = await (await browser.newContext()).newPage();
    await signIn(pageC, c.email, '/chat');
    await pageC.goto(gameUrl);
    await expect(pageC.getByText('2 spots left')).toBeVisible();
    await expect(pageC.getByText(/\+880/)).toHaveCount(0);

    // Tanvir can't make it after all: the spot opens again.
    await pageB.getByRole('button', { name: "Can't make it" }).click();
    await pageA.reload();
    await expect(pageA.getByText('3 spots left')).toBeVisible();

    // Sami closes the card: it leaves the strip.
    await pageA.getByRole('button', { name: 'Close card' }).click();
    await expect(pageA.getByText('Closed', { exact: true })).toBeVisible();
    await pageB.goto('/chat');
    await expect(pageB.getByRole('region', { name: 'Games looking for players' })).toHaveCount(0);
  } finally {
    for (const p of [a, b, c]) await removeTestPlayer(db, p.email);
  }
});
