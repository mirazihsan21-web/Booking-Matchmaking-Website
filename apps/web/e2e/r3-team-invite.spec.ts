import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { localAdmin, removeTestPlayer, signIn } from './helpers';

const OWNER = 'owner@demo-arena.test';
const MAILPIT = 'http://127.0.0.1:54324';

/** The plain text of the newest email to `address` with this subject that arrived after `since` (Mailpit). */
async function emailText(address: string, subject: string, since: Date): Promise<string> {
  const after = since.getTime() - 5_000;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address} subject:"${subject}"`)}`);
    const { messages } = (await search.json()) as { messages?: Array<{ ID: string; Created: string }> };
    const newest = messages?.find((m) => new Date(m.Created).getTime() >= after);
    if (newest) return ((await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json()) as { Text: string }).Text;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No "${subject}" email reached ${address}`);
}

test('someone who already has an account gets our email and a bar, and only joins the team when they choose to', async ({ page, browser }) => {
  const { db, slug } = localAdmin();
  const { data: org } = await db.from('organizations').select('id, name').eq('slug', slug).single();
  const invitee = `e2e-invitee-${randomUUID().slice(0, 8)}@example.test`;
  const { data: created, error } = await db.auth.admin.createUser({ email: invitee, email_confirm: true });
  if (error) throw error;
  const memberRole = async () =>
    (await db.from('organization_members').select('role').eq('organization_id', org!.id).eq('user_id', created.user.id).maybeSingle()).data?.role ?? null;

  try {
    // 1. The owner invites them as staff for Turf only, and is told how they'll hear about it.
    await signIn(page, OWNER, '/manage/staff');
    const since = new Date();
    const inviteForm = page.locator('section', { has: page.getByRole('heading', { name: 'Invite someone' }) });
    await inviteForm.getByLabel('Email').fill(invitee);
    for (const box of await inviteForm.getByRole('checkbox').all()) {
      if ((await box.evaluate((el) => el.closest('label')?.textContent?.trim())) !== 'Turf') await box.uncheck();
    }
    await inviteForm.getByRole('button', { name: 'Send invite' }).click();
    await expect(inviteForm.getByRole('status')).toHaveText(
      `Invited ${invitee}. They already have an account, so we've emailed them, and they'll see the invite when they open the site.`,
    );

    // 2. Our email reached them (Supabase sends nothing to an existing account), pointing at the invite.
    const text = await emailText(invitee, "You've been invited to the team", since);
    expect(text).toContain(`${org!.name} invited you to join its team as staff, running Turf.`);
    expect(text).toContain('See the invite: http://localhost:3000/join');

    // 3. Signing in doesn't put them on the team; a bar on the site shows the invite.
    const player = await (await browser.newContext()).newPage();
    await signIn(player, invitee, '/');
    expect(await memberRole()).toBeNull();
    await expect(player.getByText(`${org!.name} invited you to join its team.`)).toBeVisible();
    await player.getByRole('link', { name: 'See the invite' }).click();
    await expect(player).toHaveURL((url) => url.pathname === '/join');
    await expect(player.getByRole('heading', { name: `Join ${org!.name}'s team` })).toBeVisible();
    await expect(player.getByText('Once you join, this account opens Manage')).toBeVisible();

    // 4. They say yes: they're Turf staff, in Manage.
    await player.getByRole('button', { name: 'Join the team' }).click();
    await expect(player).toHaveURL((url) => url.pathname === '/manage');
    expect(await memberRole()).toBe('staff');
    const { data: sections } = await db.from('section_staff').select('sections(slug)').eq('user_id', created.user.id);
    expect(sections).toEqual([{ sections: { slug: 'turf' } }]);
  } finally {
    await db.from('organization_invites').delete().eq('email', invitee);
    await removeTestPlayer(db, invitee);
  }
});
