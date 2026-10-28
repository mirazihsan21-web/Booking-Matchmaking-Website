import 'server-only';
import { notFound } from 'next/navigation';
import { loadSections, type Section } from '@/lib/sections/sections';
import { findSection } from '@/lib/site/home';
import { createServiceClient } from '@/lib/service-client';
import { requireManager, type Manager } from '@/lib/tenancy/manager';

/** The owner and the section a setup page is about (by its address), or a 404. */
export async function ownerSection(params: Promise<{ section: string }>): Promise<{ manager: Manager; section: Section }> {
  const { section: slug } = await params;
  const manager = await requireManager('owner');
  const section = findSection(await loadSections(createServiceClient(), manager.org.id), slug);
  if (!section) notFound();
  return { manager, section };
}
