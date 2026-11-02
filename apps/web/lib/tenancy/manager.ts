import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { requireUser, type SessionUser } from '@/lib/auth/dal';
import { createServiceClient } from '@/lib/service-client';
import { createClient } from '@/lib/supabase/server';
import type { BusinessType } from '@/presets';
import { readTeamMembership } from './membership';
import { allowedSectionIds } from './sections-access';

export type OrgRole = 'owner' | 'staff';

/** The brand as the manage area sees it. */
export interface ManagedOrganization {
  id: string;
  slug: string;
  name: string;
  status: 'onboarding' | 'live' | 'suspended';
  businessType: BusinessType;
  timezone: string;
  branding: { logo_path?: string; primary?: string; accent?: string };
}

/** The signed-in member of the brand (BRAND_SLUG) on a manage page: who, their role, and the sections they run. */
export interface Manager {
  user: SessionUser;
  org: ManagedOrganization;
  role: OrgRole;
  sectionIds: string[];
  /** Their own name and mobile (My account) and when they joined the team (ISO). */
  displayName: string;
  phone: string | null;
  memberSince: string;
}

/**
 * The manager for this request, or null when the signed-in person isn't on the brand's team. Signed-out
 * visitors go to sign-in. Cached per request so the layout, page and actions share one lookup.
 */
export const getManager = cache(async (): Promise<Manager | null> => {
  const user = await requireUser('/manage');
  const slug = process.env.BRAND_SLUG ?? '';
  if (!slug) return null;
  const supabase = await createClient();
  const { data: org } = await supabase.from('organizations').select('id, slug, name, status, business_type, timezone, branding').eq('slug', slug).maybeSingle();
  if (!org) return null;
  // Throws on a failed read (e.g. code ahead of its migration) rather than showing "not on the team".
  const member = await readTeamMembership(supabase, org.id, user.id);
  if (!member) return null;
  const sectionIds = await allowedSectionIds(createServiceClient(), { organizationId: org.id, userId: user.id });
  return {
    user,
    role: member.role,
    sectionIds,
    displayName: member.displayName,
    phone: member.phone,
    memberSince: member.memberSince,
    org: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      status: org.status,
      businessType: (org.business_type ?? 'turf') as BusinessType,
      timezone: org.timezone,
      branding: (org.branding ?? {}) as ManagedOrganization['branding'],
    },
  };
});

/** The manager, or a 404 for anyone not on the team or below `minRole` (staff can't learn owner pages exist). */
export async function requireManager(minRole: OrgRole): Promise<Manager> {
  const manager = await getManager();
  if (!manager || (minRole === 'owner' && manager.role !== 'owner')) notFound();
  return manager;
}

/** The manager, or a 404 unless they run this section (owners run every section). */
export async function requireManagedSection(sectionId: string): Promise<Manager> {
  const manager = await requireManager('staff');
  if (!manager.sectionIds.includes(sectionId)) notFound();
  return manager;
}
