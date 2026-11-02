import type { SupabaseClient } from '@supabase/supabase-js';

type Role = 'owner' | 'staff';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The given ids that are sections of this organization, in display order. */
export async function ownSections(db: SupabaseClient, organizationId: string, sectionIds: string[]): Promise<string[]> {
  const ids = sectionIds.filter((id) => UUID.test(id));
  if (ids.length === 0) return [];
  const { data, error } = await db.from('sections').select('id').eq('organization_id', organizationId).in('id', ids).order('position').order('name');
  if (error) throw error;
  return data.map((s) => s.id as string);
}

/** Gives a staff member these sections (ignoring ones they already have). */
export async function addSectionStaff(db: SupabaseClient, organizationId: string, userId: string, sectionIds: string[]): Promise<void> {
  if (sectionIds.length === 0) return;
  const { error } = await db
    .from('section_staff')
    .upsert(sectionIds.map((sectionId) => ({ organization_id: organizationId, section_id: sectionId, user_id: userId })), { onConflict: 'section_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
}

/** Emails of an organization's members. Staff lists are small, so one admin lookup per member is fine. */
export async function memberEmails(db: SupabaseClient, organizationId: string): Promise<Map<string, string>> {
  const { data, error } = await db.from('organization_members').select('user_id').eq('organization_id', organizationId);
  if (error) throw error;
  const emails = new Map<string, string>();
  for (const { user_id } of data) {
    const { data: found } = await db.auth.admin.getUserById(user_id);
    if (found.user?.email) emails.set(user_id, found.user.email.toLowerCase());
  }
  return emails;
}

/** What an invite email to someone who already has an account needs: who, as what, and (staff) which sections. */
export interface InviteToEmail {
  email: string;
  role: Role;
  sectionIds: string[];
}

export type InviteResult =
  | { status: 'invited'; existingAccount: boolean; emailSent: boolean }
  | { status: 'already_member' }
  | { status: 'no_sections' };

/**
 * Records an open invite (the source of truth) and emails the person:
 * - a new address gets Supabase Auth's invite email, whose link signs them in and accepts the invite;
 * - an address that already has an account gets nothing from Auth, so `emailExisting` sends ours. The invite
 *   then waits on the site (`openInviteFor`) until they join or say no.
 * `emailSent` is false when the email didn't go (Auth refused, or `emailExisting` threw or wasn't given); the
 * invite still stands. Staff get the sections named in `sectionIds` (at least one of this organization's, or
 * 'no_sections'); owners run every section, so `sectionIds` is ignored for them.
 */
export async function inviteMember(
  db: SupabaseClient,
  input: { organizationId: string; email: string; role: Role; sectionIds: string[]; invitedBy: string; redirectTo: string },
  emailExisting?: (invite: InviteToEmail) => Promise<void>,
): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  const members = await memberEmails(db, input.organizationId);
  if ([...members.values()].includes(email)) return { status: 'already_member' };
  const sectionIds = input.role === 'staff' ? await ownSections(db, input.organizationId, input.sectionIds) : [];
  if (input.role === 'staff' && sectionIds.length === 0) return { status: 'no_sections' };

  await db.from('organization_invites').delete().eq('organization_id', input.organizationId).eq('email', email).is('accepted_at', null);
  const { error } = await db.from('organization_invites').insert({
    organization_id: input.organizationId,
    email,
    role: input.role,
    section_ids: sectionIds,
    invited_by: input.invitedBy,
  });
  if (error) throw error;

  const { error: mailError } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: input.redirectTo });
  if (!mailError) return { status: 'invited', existingAccount: false, emailSent: true };
  // Auth only invites addresses without an account; for one that has signed up it answers email_exists.
  if (mailError.code !== 'email_exists') {
    console.error('Staff invite email was not sent:', mailError.message);
    return { status: 'invited', existingAccount: false, emailSent: false };
  }
  if (!emailExisting) return { status: 'invited', existingAccount: true, emailSent: false };
  try {
    await emailExisting({ email, role: input.role, sectionIds });
    return { status: 'invited', existingAccount: true, emailSent: true };
  } catch (error) {
    console.error('Staff invite email was not sent:', error instanceof Error ? error.message : error);
    return { status: 'invited', existingAccount: true, emailSent: false };
  }
}

/** An open invite waiting for someone on the site. */
export interface OpenInvite {
  id: string;
  role: Role;
  sectionIds: string[];
}

/** This email's open, unexpired invite to the organization (at most one is open at a time), or null. */
export async function openInviteFor(db: SupabaseClient, organizationId: string, email: string): Promise<OpenInvite | null> {
  const { data, error } = await db
    .from('organization_invites')
    .select('id, role, section_ids')
    .eq('organization_id', organizationId)
    .eq('email', email.trim().toLowerCase())
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, role: data.role as Role, sectionIds: data.section_ids as string[] } : null;
}

/** The person says no: their open invites to the organization are deleted, so they can never be accepted. Returns how many. */
export async function declineInvites(db: SupabaseClient, organizationId: string, email: string): Promise<number> {
  const { data, error } = await db
    .from('organization_invites')
    .delete()
    .eq('organization_id', organizationId)
    .eq('email', email.trim().toLowerCase())
    .is('accepted_at', null)
    .select('id');
  if (error) throw error;
  return data.length;
}

/** Withdraws an open invite of this organization (e.g. sent to a mistyped address) so it can never be accepted. */
export async function cancelInvite(db: SupabaseClient, organizationId: string, inviteId: string): Promise<'cancelled' | 'not_found'> {
  const { data, error } = await db
    .from('organization_invites')
    .delete()
    .eq('id', inviteId)
    .eq('organization_id', organizationId)
    .is('accepted_at', null)
    .select('id');
  if (error) throw error;
  return data.length > 0 ? 'cancelled' : 'not_found';
}

/**
 * Turns the user's open, unexpired invites (only this organization's, when given) into memberships, with the
 * invite's sections for staff (skipping sections deleted since). Returns how many were accepted. Idempotent.
 */
export async function acceptPendingInvites(db: SupabaseClient, userId: string, email: string, organizationId?: string): Promise<number> {
  let query = db
    .from('organization_invites')
    .select('id, organization_id, role, section_ids')
    .eq('email', email.toLowerCase())
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString());
  if (organizationId) query = query.eq('organization_id', organizationId);
  const { data: invites, error } = await query;
  if (error) throw error;

  for (const invite of invites) {
    const { error: memberError } = await db
      .from('organization_members')
      .upsert({ organization_id: invite.organization_id, user_id: userId, role: invite.role }, { onConflict: 'organization_id,user_id', ignoreDuplicates: true });
    if (memberError) throw memberError;
    // Someone already on the team keeps their role; only a staff member gets section rows.
    const { data: member, error: roleError } = await db
      .from('organization_members')
      .select('role')
      .eq('organization_id', invite.organization_id)
      .eq('user_id', userId)
      .single();
    if (roleError) throw roleError;
    if (member.role === 'staff') await addSectionStaff(db, invite.organization_id, userId, await ownSections(db, invite.organization_id, invite.section_ids as string[]));
    await db.from('organization_invites').update({ accepted_at: new Date().toISOString() }).eq('id', invite.id);
  }
  return invites.length;
}
