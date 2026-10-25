// What `pnpm brand:setup` does (scripts/brand-setup.mjs), kept apart so the integration tests can run
// it. Safe to repeat: it only adds what is missing and never changes what is already there.

/** @typedef {import('../presets/types').Preset} Preset */
/** @typedef {'turf' | 'boardgame_cafe' | 'gaming_lounge'} Kind */

/** @type {Kind[]} The order sections are added in (and shown). */
const KINDS = ['turf', 'boardgame_cafe', 'gaming_lounge'];
const SECTION_NAMES = { turf: 'Turf', boardgame_cafe: 'Board-game café', gaming_lounge: 'Gaming lounge' };

const DEMO_NAMES = ['Ayesha', 'Rafi', 'Tanvir', 'Nusrat', 'Imran', 'Sadia', 'Fahim', 'Maliha', 'Arif', 'Tasnim', 'Rakib', 'Nabila'];
// One open game per section: the game (null: players choose), its spaces, when, and how many ask.
const DEMO_GAMES = {
  turf: { activity: '5-a-side futsal', resources: ['Pitch 1'], daysAhead: 2, time: '20:00', requests: 11 },
  boardgame_cafe: { activity: null, resources: ['Table 1', 'Table 2'], daysAhead: 2, time: '19:00', requests: 6 },
  gaming_lounge: { activity: 'Valorant 5v5', resources: ['PC Zone A'], daysAhead: 3, time: '21:00', requests: 6 },
};
const CHOOSE_DURATION_MIN = 120; // a players-choose game night at the café

/** @template T @param {{ data: T; error: unknown }} result @returns {T} */
function must(result) {
  if (result.error) throw result.error;
  return result.data;
}

/** `days` from today in Dhaka at `hhmm` (Dhaka is UTC+6 all year). */
function dhakaAt(days, hhmm) {
  const today = new Date(Date.now() + 6 * 3_600_000);
  today.setUTCDate(today.getUTCDate() + days);
  return new Date(`${today.toISOString().slice(0, 10)}T${hhmm}:00+06:00`);
}

/** Every auth user by lower-case email. */
async function usersByEmail(db) {
  const users = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) users.set(u.email.toLowerCase(), u);
    if (data.users.length < 1000) return users;
  }
}

/**
 * Sets up the brand `slug`: creates it (live) if missing or makes a half-set-up one live (a suspended
 * brand stays suspended), adds any missing section (turf, café,
 * lounge) with its preset spaces and games, makes `ownerEmail` its owner (or invites them), and with
 * `demo` adds 12 rated players and one open game per section.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db the service client
 * @param {{ slug: string; name?: string; presets: Preset[]; ownerEmail?: string; demo?: boolean }} input
 * @returns {Promise<{ brand: 'created' | 'existing'; sectionsAdded: string[]; owner: 'member' | 'invited' | 'already' | null; demo: { players: number; sessions: number } | null }>}
 */
export async function setupBrand(db, { slug, name, presets, ownerEmail, demo = false }) {
  const presetOf = new Map(presets.map((p) => [p.businessType, p]));

  // 1. The brand, live.
  let org = must(await db.from('organizations').select('id, status').eq('slug', slug).maybeSingle());
  /** @type {'created' | 'existing'} */
  let brand = 'existing';
  if (org?.status === 'onboarding') must(await db.from('organizations').update({ status: 'live' }).eq('id', org.id));
  if (!org) {
    if (!name?.trim()) throw new Error(`There is no brand "${slug}" yet: give it a name (--name "…").`);
    org = must(await db.from('organizations').insert({ slug, name: name.trim(), status: 'live' }).select('id').single());
    brand = 'created';
  }

  // 2. Missing sections, each with its preset spaces and games. Existing sections are left alone.
  const existing = must(await db.from('sections').select('kind').eq('organization_id', org.id));
  const sectionsAdded = [];
  for (const kind of KINDS) {
    if (existing.some((s) => s.kind === kind)) continue;
    const preset = presetOf.get(kind);
    if (!preset) throw new Error(`No preset for ${kind}`);
    const sectionId = must(await db.rpc('add_section', { p_organization_id: org.id, p_kind: kind, p_name: SECTION_NAMES[kind] }));
    must(
      await db.from('resources').insert(
        preset.resources.map((r) => ({
          organization_id: org.id,
          section_id: sectionId,
          name: r.name,
          kind: r.kind,
          capacity: r.capacity,
          price_per_hour_poisha: r.pricePerHourPoisha,
          slot_minutes: r.slotMinutes,
        })),
      ),
    );
    must(
      await db.from('activities').insert(
        preset.activities.map((a) => ({
          organization_id: org.id,
          section_id: sectionId,
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
    sectionsAdded.push(must(await db.from('sections').select('slug').eq('id', sectionId).single()).slug);
  }

  // 3. The owner: a membership for an existing account, else an invite accepted at their first sign-in.
  /** @type {'member' | 'invited' | 'already' | null} */
  let owner = null;
  if (ownerEmail?.trim()) {
    const email = ownerEmail.trim().toLowerCase();
    const user = (await usersByEmail(db)).get(email);
    if (user) {
      const member = must(await db.from('organization_members').select('role').eq('organization_id', org.id).eq('user_id', user.id).maybeSingle());
      if (member?.role === 'owner') owner = 'already';
      else {
        must(await db.from('organization_members').upsert({ organization_id: org.id, user_id: user.id, role: 'owner' }, { onConflict: 'organization_id,user_id' }));
        must(await db.from('section_staff').delete().eq('organization_id', org.id).eq('user_id', user.id)); // owners run every section
        owner = 'member';
      }
    } else {
      const pending = must(
        await db
          .from('organization_invites')
          .select('id')
          .eq('organization_id', org.id)
          .eq('email', email)
          .eq('role', 'owner')
          .is('accepted_at', null)
          .gt('expires_at', new Date().toISOString()),
      );
      if (pending.length) owner = 'already';
      else {
        must(await db.from('organization_invites').insert({ organization_id: org.id, email, role: 'owner', section_ids: [] }));
        owner = 'invited';
      }
    }
  }

  return { brand, sectionsAdded, owner, demo: demo ? await addDemo(db, org.id, slug, presetOf) : null };
}

/** 12 players rated in every section, and one open game in each section that has none yet. */
async function addDemo(db, organizationId, slug, presetOf) {
  const sections = must(await db.from('sections').select('id, kind').eq('organization_id', organizationId).order('position'));
  const users = await usersByEmail(db);

  let players = 0;
  const profileIds = [];
  for (let n = 1; n <= DEMO_NAMES.length; n++) {
    const email = `demo-${slug}-${n}@example.test`;
    let user = users.get(email);
    if (!user) {
      user = must(await db.auth.admin.createUser({ email, email_confirm: true })).user;
      players++;
    }
    let profile = must(await db.from('player_profiles').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle());
    profile ??= must(await db.from('player_profiles').insert({ organization_id: organizationId, user_id: user.id, display_name: DEMO_NAMES[n - 1] }).select('id').single());
    profileIds.push(profile.id);
    must(
      await db.from('profile_section_skills').upsert(
        sections.map((s, i) => ({ organization_id: organizationId, profile_id: profile.id, section_id: s.id, skill: 1 + ((n - 1 + i) % 5) })),
        { onConflict: 'profile_id,section_id', ignoreDuplicates: true },
      ),
    );
  }

  let sessions = 0;
  for (const section of sections) {
    const plan = DEMO_GAMES[section.kind];
    const { count, error } = await db.from('open_play_sessions').select('id', { count: 'exact', head: true }).eq('section_id', section.id);
    if (error) throw error;
    if (!plan || count) continue;
    const resources = must(await db.from('resources').select('id').eq('section_id', section.id).in('name', plan.resources));
    if (resources.length !== plan.resources.length) continue; // renamed since: leave this section be
    let activityId = null;
    let durationMin = CHOOSE_DURATION_MIN;
    if (plan.activity) {
      const activity = must(await db.from('activities').select('id, duration_min').eq('section_id', section.id).eq('name', plan.activity).maybeSingle());
      if (!activity) continue;
      activityId = activity.id;
      durationMin = activity.duration_min;
    }
    const [sessionId] = must(
      await db.rpc('schedule_open_play', {
        p_organization_id: organizationId,
        p_section_id: section.id,
        p_activity_id: activityId,
        p_resource_ids: resources.map((r) => r.id),
        p_starts_at: [dhakaAt(plan.daysAhead, plan.time).toISOString()],
        p_duration_min: durationMin,
        p_seat_price_poisha: presetOf.get(section.kind)?.seatPricePoisha ?? 0,
      }),
    );
    for (const profileId of profileIds.slice(0, plan.requests)) {
      const outcome = must(await db.rpc('request_seat', { p_session_id: sessionId, p_profile_id: profileId }));
      if (outcome !== 'requested') throw new Error(`A demo request answered ${outcome}`);
    }
    sessions++;
  }
  return { players, sessions };
}
