import { expect, test } from '@playwright/test';
import { localAdmin } from './helpers';

// Google needs a home page, a privacy policy and terms on the site's own domain before the sign-in app can be published.
test('the privacy policy and terms are on the site, linked from every page and from sign-in', async ({ page }) => {
  const { db, slug } = localAdmin();
  const { data: brand } = await db.from('organizations').select('name, address').eq('slug', slug).single();

  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await footer.getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
  await expect(page.getByText(`This is how ${brand!.name} handles your information`)).toBeVisible();
  // Locally the site sends email as bookings@localhost (EMAIL_FROM), so that's who to write to.
  await expect(page.getByRole('link', { name: 'bookings@localhost' })).toHaveAttribute('href', 'mailto:bookings@localhost');
  await expect(page.getByText('Google also shares your name and profile photo with us')).toBeVisible();

  await page.getByRole('contentinfo').getByRole('link', { name: 'Terms' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/terms');
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();
  await expect(page.getByText(`This website is run by ${brand!.name}, ${brand!.address}.`)).toBeVisible();

  // Sign-in says what signing in agrees to (its footer has the links too).
  await page.goto('/signin');
  const signIn = page.getByRole('main');
  await expect(signIn.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  await expect(signIn.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy');
});
