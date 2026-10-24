import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProfileInput {
  displayName: string;
  phone: string | null;
  /** Section id → level 1–5. Sections left out are not rated (a player must rate one before asking to play there). */
  ratings: Record<string, number>;
  /** Activity ids, favourite first (at most 3). */
  favourites: string[];
  availability: Array<{ weekday: number; start: string; end: string }>;
  emailOptIn: boolean;
}

export type SaveProfileResult = { status: 'saved'; profileId: string } | { status: 'unavailable' } | { status: 'phone_taken' };

/**
 * Creates or updates the signed-in player's profile at one venue, through RLS as that player.
 * New profiles are only allowed at live venues (RLS) → 'unavailable'. Favourites are kept only if
 * they are this venue's active activities, ranked in the order given; ratings replace the old ones
 * and are kept only for this venue's sections.
 */
export async function saveProfile(
  db: SupabaseClient,
  { userId, organizationId, input }: { userId: string; organizationId: string; input: ProfileInput },
): Promise<SaveProfileResult> {
  const fields = { display_name: input.displayName, phone: input.phone, email_opt_in: input.emailOptIn };
  const { data: existing } = await db
    .from('player_profiles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();

  const write = existing
    ? await db.from('player_profiles').update(fields).eq('id', existing.id).select('id').single()
    : await db.from('player_profiles').insert({ ...fields, organization_id: organizationId, user_id: userId }).select('id').single();
  if (write.error?.code === '42501') return { status: 'unavailable' };
  if (write.error?.code === '23505') return { status: 'phone_taken' };
  if (write.error) throw write.error;
  const profileId = write.data.id as string;

  const { data: known } = await db
    .from('activities')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .in('id', input.favourites.length ? input.favourites : ['00000000-0000-0000-0000-000000000000']);
  const knownIds = new Set((known ?? []).map((a) => a.id));
  const favourites = input.favourites.filter((id) => knownIds.has(id));

  const must = (result: { error: unknown }) => {
    if (result.error) throw result.error;
  };
  must(await db.from('profile_activities').delete().eq('profile_id', profileId));
  if (favourites.length) {
    must(
      await db
        .from('profile_activities')
        .insert(favourites.map((activityId, i) => ({ organization_id: organizationId, profile_id: profileId, activity_id: activityId, rank: i + 1 }))),
    );
  }
  const ratedIds = Object.keys(input.ratings);
  const { data: sections } = await db
    .from('sections')
    .select('id')
    .eq('organization_id', organizationId)
    .in('id', ratedIds.length ? ratedIds : ['00000000-0000-0000-0000-000000000000']);
  must(await db.from('profile_section_skills').delete().eq('profile_id', profileId));
  if (sections?.length) {
    must(
      await db
        .from('profile_section_skills')
        .insert(sections.map((sec) => ({ organization_id: organizationId, profile_id: profileId, section_id: sec.id, skill: input.ratings[sec.id] }))),
    );
  }
  must(await db.from('availability').delete().eq('profile_id', profileId));
  if (input.availability.length) {
    must(
      await db
        .from('availability')
        .insert(input.availability.map((a) => ({ organization_id: organizationId, profile_id: profileId, weekday: a.weekday, start_time: a.start, end_time: a.end }))),
    );
  }
  return { status: 'saved', profileId };
}
