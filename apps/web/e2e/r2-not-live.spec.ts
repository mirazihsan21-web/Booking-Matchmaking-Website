import { expect, test } from '@playwright/test';
import { localAdmin } from './helpers';

test('staff can still sign in while the brand is not live', async ({ page }) => {
  const { db, slug } = localAdmin();
  const { data: brand, error } = await db.from('organizations').select('status').eq('slug', slug).single();
  if (error) throw error;
  await db.from('organizations').update({ status: 'onboarding' }).eq('slug', slug);
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Not open yet' })).toBeVisible();
    await page.goto('/signin?next=/manage');
    await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible();
  } finally {
    await db.from('organizations').update({ status: brand.status }).eq('slug', slug);
  }
});
