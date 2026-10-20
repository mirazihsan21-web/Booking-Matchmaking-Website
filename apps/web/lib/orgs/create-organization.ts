import type { SupabaseClient } from '@supabase/supabase-js';
import { getPreset, type BusinessType } from '@/presets';
import { normalizeSlug, validateSlug } from '@/lib/tenancy/slug';

export type SlugCheck =
  | { status: 'available'; slug: string }
  | { status: 'invalid_slug'; reason: 'format' | 'reserved' }
  | { status: 'slug_taken' };

export type CreateOrganizationResult =
  | { status: 'created'; organizationId: string; slug: string }
  | { status: 'invalid_slug'; reason: 'format' | 'reserved' }
  | { status: 'slug_taken' }
  | { status: 'invalid_name' };

/** Normalises what the owner typed and says whether it can be their subdomain. */
export async function checkSlug(db: SupabaseClient, input: string): Promise<SlugCheck> {
  const slug = normalizeSlug(input);
  const valid = validateSlug(slug);
  if (!valid.ok) return { status: 'invalid_slug', reason: valid.reason };
  const { data, error } = await db.from('organizations').select('id').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data ? { status: 'slug_taken' } : { status: 'available', slug };
}

/**
 * Creates a venue from its business-type preset: the organization (status onboarding, preset colours),
 * the owner membership, a first branch named after the venue, the preset resources on that branch and
 * the preset activities. Runs with the service client after the caller is signed in. If anything after
 * the organization row fails, the organization is deleted (cascade) and the error rethrown.
 */
export async function createOrganization(
  db: SupabaseClient,
  input: { userId: string; businessType: BusinessType; name: string; slug: string },
): Promise<CreateOrganizationResult> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) return { status: 'invalid_name' };

  const check = await checkSlug(db, input.slug);
  if (check.status !== 'available') return check;
  const preset = getPreset(input.businessType);

  const { data: org, error } = await db
    .from('organizations')
    .insert({
      slug: check.slug,
      name,
      business_type: input.businessType,
      branding: { primary: preset.palette.primary, accent: preset.palette.accent },
      created_by: input.userId,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { status: 'slug_taken' }; // lost a race for the same slug
    throw error;
  }

  try {
    const must = <T extends { error: unknown }>(result: T) => {
      if (result.error) throw result.error;
      return result;
    };
    must(await db.from('organization_members').insert({ organization_id: org.id, user_id: input.userId, role: 'owner' }));
    const { data: branch } = must(
      await db.from('branches').insert({ organization_id: org.id, name }).select('id').single(),
    );
    must(
      await db.from('resources').insert(
        preset.resources.map((r) => ({
          organization_id: org.id,
          branch_id: branch!.id,
          name: r.name,
          kind: r.kind,
          capacity: r.capacity,
          price_per_hour_poisha: r.pricePerHourPoisha,
        })),
      ),
    );
    must(
      await db.from('activities').insert(
        preset.activities.map((a) => ({
          organization_id: org.id,
          name: a.name,
          min_players: a.minPlayers,
          max_players: a.maxPlayers,
          duration_min: a.durationMin,
          popularity: a.popularity,
          team_mode: a.teamMode,
          team_size: a.teamSize,
        })),
      ),
    );
  } catch (err) {
    await db.from('organizations').delete().eq('id', org.id);
    throw err;
  }

  return { status: 'created', organizationId: org.id, slug: check.slug };
}
