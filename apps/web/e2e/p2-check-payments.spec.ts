import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { chatPlayer, dhakaDate, localAdmin, removeTestPlayer, setPaymentNumbers, signIn } from './helpers';

// Paying for an online booking by bKash or Nagad, the team's side: the owner sets the numbers (every owner hears);
// "Payments to check" lists what players sent, for the sections you run; Confirm books it (and Takings counts it);
// Reject tells the player why; a request whose time began says Started; Today's panel handles a pending booking.

const MAILPIT = 'http://127.0.0.1:54324';
const OWNER = 'owner@demo-arena.test';
const PLAYER_PHONE = '01911111111';

async function brand() {
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id, name').eq('slug', slug).single();
  const { data: pitch } = await db.from('resources').select('id, section_id').eq('organization_id', org!.id).eq('name', 'Pitch 1').single();
  const { data: cafe } = await db.from('sections').select('id').eq('organization_id', org!.id).eq('slug', 'cafe').single();
  return { db, organizationId: org!.id as string, brandName: org!.name as string, pitch: pitch!.id as string, turf: pitch!.section_id as string, cafe: cafe!.id as string };
}

/** Dhaka wall time `hour`:00 on the date `daysAhead` from today. */
const dhakaAt = (daysAhead: number, hour: number) => new Date(`${dhakaDate(daysAhead)}T${String(hour).padStart(2, '0')}:00:00+06:00`);
const trx = () => `T${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`;

/** A player's request on Pitch 1 with their bKash details sent, made through the database's own functions. */
async function sentRequest(player: { userId: string; profileId: string }, startsAt: Date, trxId: string): Promise<string> {
  const { db, organizationId, pitch } = await brand();
  const booked = await db.rpc('book_resource', {
    p_organization_id: organizationId,
    p_resource_id: pitch,
    p_starts_at: startsAt.toISOString(),
    p_slots: 1,
    p_profile_id: player.profileId,
    p_guest_name: null,
    p_guest_phone: null,
    p_created_by: player.userId,
    p_by_player: true,
  });
  const row = (booked.data as Array<{ status: string; booking_id: string }>)[0]!;
  if (row.status !== 'pending') throw new Error(`booking: ${row.status}`);
  const sent = await db.rpc('submit_payment_claim', { p_booking_id: row.booking_id, p_user_id: player.userId, p_method: 'bkash', p_sender_phone: PLAYER_PHONE, p_trx_id: trxId });
  if (sent.data !== 'submitted') throw new Error(`details: ${sent.data}`);
  return row.booking_id;
}

let restore: { bkash: string | null; nagad: string | null } | null = null;
test.beforeEach(async () => {
  const { db, organizationId } = await brand();
  restore = await setPaymentNumbers(db, organizationId, { bkash: '01712345678', nagad: null });
});
test.afterEach(async () => {
  const { db, organizationId } = await brand();
  if (restore) await setPaymentNumbers(db, organizationId, restore);
});

test('the owner sets the numbers and every owner hears; staff have no say', async ({ browser }) => {
  const { db, organizationId, brandName } = await brand();
  await setPaymentNumbers(db, organizationId, { bkash: null, nagad: null });
  const since = Date.now();
  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, OWNER, '/manage');
  await owner.goto('/manage/brand');
  const box = owner.getByRole('region', { name: 'bKash and Nagad numbers' });
  await box.getByLabel('bKash number').fill('0171 234 5678');
  await box.getByLabel('Nagad number').fill('01812345678');
  await box.getByRole('button', { name: 'Save numbers' }).click();
  await expect(box.getByRole('status')).toHaveText('Saved. Players send money to these numbers.');
  const { data } = await db.from('organizations').select('bkash_number, nagad_number').eq('id', organizationId).single();
  expect(data).toEqual({ bkash_number: '01712345678', nagad_number: '01812345678' });
  await expect
    .poll(async () => {
      const found = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${OWNER}`)}`)).json()) as {
        messages?: Array<{ Subject: string; Created: string }>;
      };
      return found.messages?.find((msg) => Date.parse(msg.Created) >= since - 5_000 && msg.Subject.includes('bKash/Nagad numbers'))?.Subject ?? null;
    }, { timeout: 15_000 })
    .toBe(`${brandName}: the bKash/Nagad numbers for online bookings were changed`);

  const staff = await (await browser.newContext()).newPage();
  await signIn(staff, 'turf-staff@demo-arena.test', '/manage');
  await staff.goto('/manage/brand');
  await expect(staff.getByRole('region', { name: 'bKash and Nagad numbers' })).toHaveCount(0);
});

test('the team confirms one payment and rejects another; the players see where they stand', async ({ browser }) => {
  test.setTimeout(150_000);
  const { db, organizationId } = await brand();
  const a = await chatPlayer(db, organizationId, 'Sami');
  const b = await chatPlayer(db, organizationId, 'Tanvir');
  const good = trx();
  try {
    await sentRequest(a, dhakaAt(9, 6), good);
    const rejected = await sentRequest(b, dhakaAt(9, 7), trx());

    const owner = await (await browser.newContext()).newPage();
    await signIn(owner, OWNER, '/manage');
    await expect(owner.getByRole('link', { name: 'Payments (2)' }).first()).toBeVisible();
    await owner.goto('/manage/payments');
    const samis = owner.getByRole('listitem').filter({ hasText: good });
    for (const text of ['Sami', 'Pitch 1', '৳2,500', 'bKash', PLAYER_PHONE]) await expect(samis.getByText(text, { exact: false }).first()).toBeVisible();
    await samis.getByRole('button', { name: 'Confirm' }).click();
    await expect(owner.getByRole('listitem').filter({ hasText: good })).toHaveCount(0);

    // Reject asks first, with an optional reason.
    const tanvirs = owner.getByRole('listitem').filter({ hasText: 'Tanvir' });
    await tanvirs.getByRole('button', { name: 'Reject' }).click();
    await tanvirs.getByLabel('Reason (optional)').fill('Payment not found');
    await tanvirs.getByRole('button', { name: 'Yes, reject' }).click();
    await expect(owner.getByRole('listitem').filter({ hasText: 'Tanvir' })).toHaveCount(0);
    await expect(owner.getByRole('link', { name: 'Payments', exact: true }).first()).toBeVisible();

    const pageA = await (await browser.newContext()).newPage();
    await signIn(pageA, a.email, '/me/bookings');
    const aRow = pageA.getByRole('listitem').filter({ hasText: 'Pitch 1' });
    await expect(aRow.getByText('Paid', { exact: true })).toBeVisible();
    await expect(aRow.getByText('Payment sent — waiting for the venue to confirm')).toHaveCount(0);

    const pageB = await (await browser.newContext()).newPage();
    await signIn(pageB, b.email, '/me/bookings');
    await expect(pageB.getByText("Not confirmed — we couldn't find your payment")).toBeVisible();
    await expect(pageB.getByText('Payment not found')).toBeVisible();
    const { count } = await db.from('resource_reservations').select('id', { count: 'exact', head: true }).eq('source_id', rejected);
    expect(count).toBe(0); // the slot is free again
  } finally {
    await removeTestPlayer(db, a.email);
    await removeTestPlayer(db, b.email);
  }
});

test('café staff don’t see turf payments; a request whose time began says Started (Review Focus 3, 4)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { db, organizationId, cafe } = await brand();
  const a = await chatPlayer(db, organizationId, 'Sami');
  const cafeEmail = `e2e-cafe-staff-${randomUUID().slice(0, 8)}@example.test`;
  const { data: created } = await db.auth.admin.createUser({ email: cafeEmail, email_confirm: true });
  const cafeUser = created.user!.id;
  await db.from('organization_members').insert({ organization_id: organizationId, user_id: cafeUser, role: 'staff' });
  await db.from('section_staff').insert({ organization_id: organizationId, section_id: cafe, user_id: cafeUser });
  try {
    const id = await sentRequest(a, dhakaAt(9, 6), trx());
    const staff = await (await browser.newContext()).newPage();
    await signIn(staff, cafeEmail, '/manage');
    await staff.goto('/manage/payments');
    await expect(staff.getByText('Nothing to check.')).toBeVisible();
    await expect(staff.getByText('Sami')).toHaveCount(0);

    // Its time begins with nobody having decided: still there, marked Started.
    const start = new Date(Date.now() - 30 * 60_000).toISOString();
    const end = new Date(Date.now() + 30 * 60_000).toISOString();
    await db.from('resource_bookings').update({ period: `[${start},${end})` }).eq('id', id);
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner, OWNER, '/manage/payments');
    await expect(owner.getByRole('listitem').filter({ hasText: 'Sami' }).getByText('Started')).toBeVisible();
  } finally {
    await removeTestPlayer(db, a.email);
    await db.from('section_staff').delete().eq('user_id', cafeUser);
    await db.from('organization_members').delete().eq('user_id', cafeUser);
    await db.auth.admin.deleteUser(cafeUser);
  }
});

test('Today’s panel shows a payment to check, with Confirm and Reject and no Arrived', async ({ browser }) => {
  // Today shows the current business day (the demo opens 10:00–23:00): the request takes today's first free hour
  // that hasn't started, so it needs one left before closing.
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Dhaka' }).format(new Date()));
  test.skip(hour >= 21, "Today's turf hours are over; run before 21:00 Dhaka time");
  const { db, organizationId } = await brand();
  const a = await chatPlayer(db, organizationId, 'Sami');
  try {
    const good = trx();
    let made = false;
    for (let h = Math.max(10, hour + 1); h <= 21 && !made; h += 1) {
      made = await sentRequest(a, new Date(`${dhakaDate(0)}T${String(h).padStart(2, '0')}:00:00+06:00`), good).then(
        () => true,
        (error: Error) => (error.message === 'booking: taken' ? false : Promise.reject(error)),
      );
    }
    expect(made).toBe(true);
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner, OWNER, '/manage');
    await owner.getByRole('button', { name: /Sami/ }).first().click();
    const panel = owner.getByRole('dialog');
    await expect(panel.getByText('Payment to check')).toBeVisible();
    await expect(panel.getByText(good)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Confirm' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Reject' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Arrived' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Confirm' }).click();
    await expect(panel.getByRole('button', { name: 'Arrived' })).toBeVisible();
  } finally {
    await removeTestPlayer(db, a.email);
  }
});
