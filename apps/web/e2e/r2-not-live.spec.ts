import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/** A service client for the LOCAL stack (keys from apps/web/.env.local), plus the brand the site runs. */
function localAdmin() {
  const env = Object.fromEntries(
    readFileSync('.env.local', 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('e2e only runs against the local Supabase stack');
  return { db: createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } }), slug: env.BRAND_SLUG! };
}

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
