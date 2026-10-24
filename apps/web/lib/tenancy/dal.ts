import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { requireUser, type SessionUser } from '@/lib/auth/dal';
import { createServiceClient } from '@/lib/service-client';
import { createClient } from '@/lib/supabase/server';
import { canManageSection } from './sections-access';
import type { BusinessType } from '@/presets';

export type OrgRole = 'owner' | 'staff';

export interface ManagedOrganization {
  id: string;
  slug: string;
  name: string;
  status: 'onboarding' | 'live' | 'suspended';
  businessType: BusinessType;
  timezone: string;
  branding: { logo_path?: string; primary?: string; accent?: string };
}

/**
 * The signed-in member's organization for /manage/[slug] pages and actions. Not a member, or below
 * `minRole`, is a 404 — so a staff member can't even learn that an owner-only page exists.
 * Cached per request so the layout, page and actions share one lookup.
 */
export const requireOrgRole = cache(
  async (slug: string, minRole: OrgRole): Promise<{ user: SessionUser; org: ManagedOrganization; role: OrgRole }> => {
    const user = await requireUser(`/manage/${slug}`);
    const supabase = await createClient();
    const { data: org } = await supabase
      .from('organizations')
      .select('id, slug, name, status, business_type, timezone, branding')
      .eq('slug', slug)
      .maybeSingle();
    if (!org) notFound();
    const { data: member } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', org.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member || (minRole === 'owner' && member.role !== 'owner')) notFound();
    return {
      user,
      role: member.role as OrgRole,
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
  },
);

/**
 * requireOrgRole for staff work in one section (bookings, schedule, sessions): the owner, or staff
 * given this section. Anyone else gets the same 404, so staff can't probe other sections.
 */
export const requireSectionStaff = cache(
  async (slug: string, sectionId: string): Promise<{ user: SessionUser; org: ManagedOrganization; role: OrgRole }> => {
    const context = await requireOrgRole(slug, 'staff');
    if (!(await canManageSection(createServiceClient(), { organizationId: context.org.id, userId: context.user.id, sectionId }))) notFound();
    return context;
  },
);
