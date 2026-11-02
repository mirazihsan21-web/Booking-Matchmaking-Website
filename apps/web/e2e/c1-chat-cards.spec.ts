import { expect, test } from '@playwright/test';
import { chatPlayer, ensureUpcomingGame, localAdmin, removeTestGame, removeTestPlayer, signIn } from './helpers';

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

    // Visitors who aren't signed in see nothing of the game.
    const visitor = await browser.newPage();
    await visitor.goto(gameUrl);
    await expect(visitor.getByText('Sign in to see the players chat')).toBeVisible();
    await expect(visitor.getByText('Pitch 1')).toHaveCount(0);
    await visitor.close();

    // Sami has enough people and closes the card: it leaves the strip.
    await pageA.reload();
    await pageA.getByRole('button', { name: 'Close card' }).click();
    await expect(pageA.getByText('Closed', { exact: true })).toBeVisible();

    // Tanvir can still drop out before the game.
    await pageB.reload();
    await pageB.getByRole('button', { name: "Can't make it" }).click();
    await expect(pageB.getByText("You're in")).toHaveCount(0);
    await pageA.reload();
    await expect(pageA.getByText('Nobody yet.')).toBeVisible();
    await pageB.goto('/chat');
    await expect(pageB.getByRole('region', { name: 'Games looking for players' })).toHaveCount(0);
  } finally {
    for (const p of [a, b, c]) await removeTestPlayer(db, p.email);
  }
});

test('a player who shares an open-play game can close their card from the chat', async ({ browser }) => {
  test.setTimeout(90_000);
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id').eq('slug', slug).single();
  const made = await ensureUpcomingGame(db, slug, 'turf');
  const { data: game } = await db
    .from('open_play_sessions')
    .select('id')
    .eq('organization_id', org!.id)
    .in('status', ['open', 'matched'])
    .gt('starts_at', new Date().toISOString())
    .order('starts_at')
    .limit(1)
    .single();
  const a = await chatPlayer(db, org!.id, 'Sami');
  const { error } = await db.from('seat_requests').insert({ organization_id: org!.id, session_id: game!.id, profile_id: a.profileId });
  if (error) throw error;
  try {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, a.email, '/chat');
    await page.getByRole('button', { name: 'Need players' }).click();
    await page.getByLabel('Your booking or game').selectOption({ index: 0 });
    await page.getByLabel('Note (optional)').fill('come along');
    await page.getByRole('button', { name: 'Post card' }).click();
    const card = page.getByRole('listitem').filter({ hasText: 'come along' });
    await expect(card.getByRole('link', { name: 'Get a seat' })).toBeVisible({ timeout: 5_000 });
    await card.getByRole('button', { name: 'Message options' }).click();
    await card.getByRole('button', { name: 'Close card' }).click();
    await expect(card.getByText('Closed', { exact: true })).toBeVisible({ timeout: 5_000 });
  } finally {
    await removeTestPlayer(db, a.email);
    if (made) await removeTestGame(db, made);
  }
});
