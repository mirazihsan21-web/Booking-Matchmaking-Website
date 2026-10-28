import type { SupabaseClient } from '@supabase/supabase-js';
import { accentReadability } from '@/lib/manage/colour';

export interface SectionWebsiteInput {
  organizationId: string;
  sectionId: string;
  name: string;
  description: string;
  accent: string;
  photoPath: string | null;
}

export type SectionWebsiteResult =
  | { status: 'saved' }
  | { status: 'unreadable'; ratio: number }
  | { status: 'invalid_photo' }
  | { status: 'invalid'; field: 'name' | 'description' | 'accent' }
  | { status: 'not_found' };

const HEX = /^#[0-9a-f]{6}$/i;
/** One file straight inside the section's folder: no sub-folders, no "..". */
const FILE = /^[\w-]+\.(jpg|png|webp)$/;

/**
 * Saves what the website shows for a section: its name, description (empty → the kind's text), colour
 * (refused unless it passes both readability checks) and photo (null → the stock photo). A photo must be
 * a file in `<organization>/sections/<section>/`; the one it replaces is removed from storage.
 */
export async function saveSectionWebsite(db: SupabaseClient, input: SectionWebsiteInput): Promise<SectionWebsiteResult> {
  const name = input.name.trim();
  const description = input.description.trim();
  if (name.length < 1 || name.length > 80) return { status: 'invalid', field: 'name' };
  if (description.length > 300) return { status: 'invalid', field: 'description' };
  if (!HEX.test(input.accent)) return { status: 'invalid', field: 'accent' };
  if (input.photoPath !== null) {
    const folder = `${input.organizationId}/sections/${input.sectionId}/`;
    if (!input.photoPath.startsWith(folder) || !FILE.test(input.photoPath.slice(folder.length))) return { status: 'invalid_photo' };
  }
  const readability = accentReadability(input.accent);
  if (!readability.ok) return { status: 'unreadable', ratio: Math.min(readability.onCard, readability.onColour) };

  const { data: before, error: readError } = await db
    .from('sections')
    .select('photo_path')
    .eq('id', input.sectionId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (readError) throw readError;
  if (!before) return { status: 'not_found' };
  const { error } = await db
    .from('sections')
    .update({ name, description: description || null, accent: input.accent.toLowerCase(), photo_path: input.photoPath })
    .eq('id', input.sectionId)
    .eq('organization_id', input.organizationId);
  if (error) throw error;
  if (before.photo_path && before.photo_path !== input.photoPath) {
    // Tidying only: a file left behind costs a little storage, not a wrong page.
    await db.storage.from('org-assets').remove([before.photo_path]);
  }
  return { status: 'saved' };
}
