import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { chatPlayer, dhakaDate, localAdmin, removeTestPlayer, setPaymentNumbers, signIn } from './helpers';

// Paying for an online booking by bKash or Nagad, the player's side: Request booking → the pay page (price, the
// venue's number, a 15-minute hold) → the details → waiting for the venue; a hold can be cancelled; with no number
// a priced space pauses while a café table still books instantly.

const MAILPIT = 'http://127.0.0.1:54324';
const TOMORROW = dhakaDate(1);

async function brand() {
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id, address').eq('slug', slug).single();
  const space = async (sectionSlug: string, name: string) => {
    const { data } = await db.from('resources').select('id, sections!inner(slug)').eq('organization_id', org!.id).eq('name', name).eq('sections.slug', sectionSlug).single();
    return data!.id as string;
  };
  return { db, organizationId: org!.id as string, address: (org!.address as string | null) ?? '', pitch: await space('turf', 'Pitch 1'), table: await space('cafe', 'Table 1') };
}

/** Picks the first free slot on the open booking page; returns its label ("8pm–9pm"). */
async function pickFirstFree(page: Page): Promise<string> {
  const slot = page.locator('fieldset button:not([disabled])').first();
  const label = (await slot.innerText()).trim();
  await slot.click();
  await expect(page.getByRole('button', { name: `${label} ✓` })).toBeVisible();
  return label;
}

let restore: { bkash: string | null; nagad: string | null } | null = null;
test.afterEach(async () => {
  if (!restore) return;
  const { db, organizationId } = await brand();
  await setPaymentNumbers(db, organizationId, restore);
  restore = null;
});

test('a player requests a pitch, pays by bKash and waits for the venue', async ({ browser }) => {
  test.setTimeout(120_000);
  const { db, organizationId, pitch } = await brand();
  restore = await setPaymentNumbers(db, organizationId, { bkash: '01712345678', nagad: null });
  const a = await chatPlayer(db, organizationId, 'Sami');
  const b = await chatPlayer(db, organizationId, 'Tanvir');
  const trxId = `T${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`;
  try {
    const page = await (await browser.newContext()).newPage();
    const bookPage = `/turf/book?resource=${pitch}&date=${TOMORROW}`;
    await signIn(page, a.email, '/me');
    await page.goto(bookPage);
    await expect(page.getByText("You'll pay ৳2,500 by bKash or Nagad to confirm.")).toBeVisible();
    const label = await pickFirstFree(page);
    await page.getByRole('button', { name: 'Request booking' }).click();

    // The pay page.
    await expect(page).toHaveURL(/\/me\/bookings\/[0-9a-f-]{36}\/pay$/);
    await expect(page.getByText('৳2,500').first()).toBeVisible();
    await expect(page.getByText('01712345678')).toBeVisible();
    await expect(page.getByText('Use Send Money. Then fill this in:')).toBeVisible();
    await expect(page.getByText(/Slot held for 1[45]:\d\d/)).toBeVisible();
    await expect(page.getByLabel('Nagad')).toHaveCount(0); // the venue has no Nagad number
    await page.getByLabel('Number you sent from').fill('01911111111');
    await page.getByLabel('Transaction ID').fill('AB1');
    await page.getByRole('button', { name: "I've sent it" }).click();
    await expect(page.getByText('Type the transaction ID from your bKash or Nagad message (6–20 letters and numbers).')).toBeVisible();
    await page.getByLabel('Transaction ID').fill(trxId.toLowerCase());
    await page.getByRole('button', { name: "I've sent it" }).click();
    await expect(page.getByText('Payment sent — waiting for the venue to confirm')).toBeVisible();

    // My bookings says the same, with no Cancel.
    await page.goto('/me/bookings');
    const row = page.getByRole('listitem').filter({ hasText: 'Pitch 1' });
    await expect(row.getByText('Payment sent — waiting for the venue to confirm')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(row.getByText('To cancel, contact us on 01712345678.')).toBeVisible(); // finishing touches

    // Another player sees the slot taken.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, b.email, '/me');
    await other.goto(bookPage);
    await expect(other.getByRole('button', { name: label, exact: true })).toBeDisabled();

    // The owner got the "Payment to check" email.
    await expect
      .poll(async () => {
        const found = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(trxId)}`)).json()) as {
          messages?: Array<{ Subject: string; To: Array<{ Address: string }> }>;
        };
        return found.messages?.find((msg) => msg.To.some((to) => to.Address === 'owner@demo-arena.test'))?.Subject ?? null;
      }, { timeout: 15_000 })
      .toMatch(new RegExp(`^Payment to check: Sami, Pitch 1, .+, ৳2,500 by bKash \\(TrxID ${trxId}\\)$`));
  } finally {
    await removeTestPlayer(db, a.email);
    await removeTestPlayer(db, b.email);
  }
});

test('a hold can be cancelled before paying, and the slot is free again', async ({ browser }) => {
  const { db, organizationId, pitch } = await brand();
  restore = await setPaymentNumbers(db, organizationId, { bkash: '01712345678', nagad: '01812345678' });
  const a = await chatPlayer(db, organizationId, 'Sami');
  try {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, a.email, '/me');
    await page.goto(`/turf/book?resource=${pitch}&date=${dhakaDate(2)}`);
    const label = await pickFirstFree(page);
    await page.getByRole('button', { name: 'Request booking' }).click();
    await expect(page).toHaveURL(/\/pay$/);
    await expect(page.getByLabel('Nagad')).toBeVisible(); // both numbers set: both choices
    await page.getByRole('button', { name: 'Cancel this request' }).click();
    await expect(page).toHaveURL(/\/turf\/book/);
    await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled();
    // They just did it themselves: no "Booking cancelled" notice (finishing touches).
    await page.goto('/me/notifications');
    await expect(page.getByText('Booking cancelled')).toHaveCount(0);
  } finally {
    await removeTestPlayer(db, a.email);
  }
});

test('a hold that runs out ends: the pay page says so and the bell tells the player', async ({ browser }) => {
  const { db, organizationId, pitch } = await brand();
  restore = await setPaymentNumbers(db, organizationId, { bkash: '01712345678', nagad: null });
  const a = await chatPlayer(db, organizationId, 'Sami');
  try {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, a.email, '/me');
    await page.goto(`/turf/book?resource=${pitch}&date=${dhakaDate(3)}`);
    await pickFirstFree(page);
    await page.getByRole('button', { name: 'Request booking' }).click();
    await expect(page).toHaveURL(/\/pay$/);
    const bookingId = page.url().split('/').at(-2)!;
    // The 15 minutes pass (moved into the past), and the every-minute job runs.
    await db.from('resource_bookings').update({ hold_until: new Date(Date.now() - 60_000).toISOString() }).eq('id', bookingId);
    expect((await db.rpc('expire_payment_holds')).error).toBeNull();
    // Sending the details now is too late — and a player who already paid is told how to reach the venue (final review).
    await page.getByLabel('Number you sent from').fill('01911111111');
    await page.getByLabel('Transaction ID').fill('LATE12345');
    await page.getByRole('button', { name: "I've sent it" }).click();
    await expect(page.getByText('Your hold ended. Book again. If you did send money, contact us on 01712345678.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Your hold ended. Book again.')).toBeVisible();
    await expect(page.getByText('If you did send money, contact us on 01712345678.')).toBeVisible();
    await page.goto('/me/notifications');
    await expect(page.getByText('Your hold ended').first()).toBeVisible();
  } finally {
    await removeTestPlayer(db, a.email);
  }
});

test('with no number set, a priced space pauses and a café table still books instantly (Review Focus 5)', async ({ browser }) => {
  const { db, organizationId, address, pitch, table } = await brand();
  restore = await setPaymentNumbers(db, organizationId, { bkash: null, nagad: null });
  const a = await chatPlayer(db, organizationId, 'Sami');
  try {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, a.email, '/me');
    await page.goto(`/turf/book?resource=${pitch}&date=${TOMORROW}`);
    // Where to come, when the venue has an address (finishing touches).
    await expect(page.getByText(`Online booking opens soon — call or visit us${address ? ` at ${address}` : ''}.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request booking' })).toHaveCount(0);
    await page.goto(`/cafe/book?resource=${table}&date=${TOMORROW}`);
    await pickFirstFree(page);
    await page.getByRole('button', { name: 'Book', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Booked! See My bookings.');
  } finally {
    await removeTestPlayer(db, a.email);
  }
});

test('the venue cancels a held request: sending the details then says so, with the number to call', async ({ browser }) => {
  const { db, organizationId, pitch } = await brand();
  restore = await setPaymentNumbers(db, organizationId, { bkash: '01712345678', nagad: null });
  const a = await chatPlayer(db, organizationId, 'Sami');
  const { data: owner } = await db.from('organization_members').select('user_id').eq('organization_id', organizationId).eq('role', 'owner').limit(1).single();
  try {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, a.email, '/me');
    await page.goto(`/turf/book?resource=${pitch}&date=${dhakaDate(5)}`);
    await pickFirstFree(page);
    await page.getByRole('button', { name: 'Request booking' }).click();
    await expect(page).toHaveURL(/\/pay$/);
    const bookingId = page.url().split('/').at(-2)!;
    expect((await db.rpc('cancel_resource_booking', { p_booking_id: bookingId, p_cancelled_by: owner!.user_id })).data).toBe('cancelled');
    await page.getByLabel('Number you sent from').fill('01911111111');
    await page.getByLabel('Transaction ID').fill('VENUEGONE1');
    await page.getByRole('button', { name: "I've sent it" }).click();
    await expect(page.getByText('The venue cancelled this request.')).toBeVisible();
    await expect(page.getByText('If you did send money, contact us on 01712345678.')).toBeVisible();
    await expect(page.getByRole('button', { name: "I've sent it" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('The venue cancelled this request.')).toBeVisible();
  } finally {
    await removeTestPlayer(db, a.email);
  }
});
