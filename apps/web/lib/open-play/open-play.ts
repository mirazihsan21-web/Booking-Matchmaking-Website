import { createHash, randomBytes } from 'node:crypto';
import { rankWaitlist, type WaitlistCandidate } from '@bm/engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { planMatch, type MatchActivity, type MatchRequest } from './match';

/**
 * Open play for players (tenant site), staff (manage) and the job tick. Pass the service client:
 * callers have already checked who is asking. Seat, offer and session state changes live in the SQL
 * functions (spec §3); this module loads data, runs the engine (matching, who gets a freed seat),
 * applies the section's clock rules (cancel cut-off) and mints offer tokens. Levels, games and rules
 * are the session's section's.
 */

export type RequestOutcome = 'requested' | 'seated' | 'waitlisted' | 'already' | 'needs_skill' | 'closed' | 'not_found';
export type WithdrawOutcome = 'withdrawn' | 'has_offer' | 'closed' | 'not_found';
export type MatchOutcome = 'matched' | 'already_matched' | 'not_open' | 'no_groups' | 'not_found';
export type OfferNextOutcome = 'offered' | 'no_candidate' | 'seat_not_free' | 'closed';
export type CancelSeatOutcome = 'cancelled' | 'too_late' | 'closed' | 'not_found' | 'not_cancellable';
export type AcceptOutcome = 'accepted' | 'already_accepted' | 'declined' | 'expired' | 'seat_taken' | 'already_booked' | 'closed' | 'not_found';
export type RespondOutcome = AcceptOutcome | 'not_pending';

export interface OfferView {
  id: string;
  organizationSlug: string;
  status: string;
  expiresAt: string;
  seatNo: number;
  team: 1 | 2 | null;
  session: { id: string; startsAt: string; endsAt: string; activityName: string; resourceName: string; pricePoisha: number };
}

export interface SessionSummary {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  activityName: string | null;
  sectionId: string;
  sectionName: string;
  pricePoisha: number;
}

export interface PlayerSessionView {
  session: SessionSummary;
  seatsLeft: number;
  me: {
    state: 'none' | 'requested' | 'seated' | 'waitlisted' | 'offered';
    position?: number;
    offerId?: string;
    bookingId?: string;
    team?: 1 | 2 | null;
    cancellable?: boolean;
    /** Not asked yet, and no level for this section: asking would answer needs_skill. */
    needsRating?: boolean;
  } | null;
  /** The player's own group, only once they hold a seat: display names, never phones. */
  group: { resourceName: string; activityName: string; teams: Array<{ team: 1 | 2 | null; names: string[] }> } | null;
}

export interface StaffSessionView {
  session: SessionSummary;
  requests: Array<{ profileId: string; name: string; skill: number }>;
  groups: Array<{
    id: string;
    resourceName: string;
    activityName: string;
    capacity: number;
    teams: Array<{ team: 1 | 2 | null; skillTotal: number; players: Array<{ bookingId: string; name: string; skill: number; seatNo: number }> }>;
  }>;
  waitlist: Array<{ position: number; name: string; status: string }>;
  offers: Array<{ name: string; seatNo: number; resourceName: string; expiresAt: string }>;
  /** Players a group needs (both teams for team games); null when nobody could be seated. */
  needed: number | null;
  /** Still open although its match cut-off has passed: not enough players yet. */
  notEnoughPlayers: boolean;
}

export interface MySeat {
  bookingId: string;
  sessionId: string;
  activityName: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  team: 1 | 2 | null;
  pricePoisha: number;
  status: string;
  cancellable: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const sha256hex = (value: string) => createHash('sha256').update(value).digest('hex');

interface SessionRow {
  id: string;
  organization_id: string;
  activity_id: string | null;
  starts_at: string;
  ends_at: string;
  seat_price_poisha: number;
  status: string;
  section_id: string;
  activities: { name: string; min_players: number; max_players: number; team_mode: 'none' | 'two_teams'; team_size: number | null } | null;
  sections: { name: string; cancel_cutoff_minutes: number; match_cutoff_minutes: number };
}

const isLive = (s: { status: string; starts_at: string }, now = new Date()) =>
  (s.status === 'open' || s.status === 'matched') && new Date(s.starts_at) > now;

const teamOf = (seatNo: number, activity: { team_mode: string; team_size: number | null }): 1 | 2 | null =>
  activity.team_mode === 'two_teams' && activity.team_size ? (seatNo <= activity.team_size ? 1 : 2) : null;

async function loadSession(db: SupabaseClient, organizationId: string, sessionId: string): Promise<SessionRow | null> {
  if (!UUID.test(organizationId) || !UUID.test(sessionId)) return null;
  const { data, error } = await db
    .from('open_play_sessions')
    .select(
      'id, organization_id, activity_id, starts_at, ends_at, seat_price_poisha, status, section_id, activities(name, min_players, max_players, team_mode, team_size), sections(name, cancel_cutoff_minutes, match_cutoff_minutes)',
    )
    .eq('id', sessionId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return data as SessionRow | null;
}

const summary = (s: SessionRow): SessionSummary => ({
  id: s.id,
  status: s.status,
  startsAt: s.starts_at,
  endsAt: s.ends_at,
  activityName: s.activities?.name ?? null,
  sectionId: s.section_id,
  sectionName: s.sections.name,
  pricePoisha: s.seat_price_poisha,
});

/**
 * Each profile's favourite games in this section, most preferred first. Favourites elsewhere don't
 * count: someone whose favourites are all turf games plays anything at the café (as private.wants_game).
 */
async function favouritesOf(db: SupabaseClient, sectionId: string, profileIds: string[]): Promise<Map<string, string[]>> {
  const favourites = new Map<string, string[]>();
  if (profileIds.length === 0) return favourites;
  const { data, error } = await db
    .from('profile_activities')
    .select('profile_id, activity_id, activities!inner(section_id)')
    .in('profile_id', profileIds)
    .eq('activities.section_id', sectionId)
    .order('rank');
  if (error) throw error;
  for (const row of data as unknown as Array<{ profile_id: string; activity_id: string }>) {
    favourites.set(row.profile_id, [...(favourites.get(row.profile_id) ?? []), row.activity_id]);
  }
  return favourites;
}

/** Players without a rating count as 3: requests need one (request_seat), so only rows from before ratings lack it. */
const UNRATED_SKILL = 3;

/** Each profile's level in this section. */
async function skillsOf(db: SupabaseClient, sectionId: string, profileIds: string[]): Promise<Map<string, number>> {
  const skills = new Map<string, number>();
  if (profileIds.length === 0) return skills;
  const { data, error } = await db.from('profile_section_skills').select('profile_id, skill').eq('section_id', sectionId).in('profile_id', profileIds);
  if (error) throw error;
  for (const row of data as Array<{ profile_id: string; skill: number }>) skills.set(row.profile_id, row.skill);
  return skills;
}
const skillIn = (skills: Map<string, number>, profileId: string) => skills.get(profileId) ?? UNRATED_SKILL;

// ── Requests ────────────────────────────────────────────────────────────────

export async function requestSeat(db: SupabaseClient, input: { organizationId: string; sessionId: string; profileId: string }): Promise<RequestOutcome> {
  if (!UUID.test(input.profileId) || !(await loadSession(db, input.organizationId, input.sessionId))) return 'not_found';
  const { data, error } = await db.rpc('request_seat', { p_session_id: input.sessionId, p_profile_id: input.profileId });
  if (error) throw error;
  return data === 'invalid' ? 'not_found' : (data as RequestOutcome);
}

export async function withdrawRequest(db: SupabaseClient, input: { organizationId: string; sessionId: string; profileId: string }): Promise<WithdrawOutcome> {
  if (!UUID.test(input.profileId) || !(await loadSession(db, input.organizationId, input.sessionId))) return 'not_found';
  const { data, error } = await db.rpc('withdraw_request', { p_session_id: input.sessionId, p_profile_id: input.profileId });
  if (error) throw error;
  return data as WithdrawOutcome;
}

// ── Matching ────────────────────────────────────────────────────────────────

/** Runs the engine over the session's requests and applies the plan. Used by "Match now" and the tick. */
export async function matchSession(db: SupabaseClient, input: { organizationId: string; sessionId: string }): Promise<MatchOutcome> {
  const session = await loadSession(db, input.organizationId, input.sessionId);
  if (!session) return 'not_found';
  if (session.status === 'matched') return 'already_matched';
  if (session.status !== 'open' || !isLive(session)) return 'not_open';

  const [requestsResult, resourcesResult, activitiesResult] = await Promise.all([
    db.from('seat_requests').select('profile_id, priority, created_at').eq('session_id', session.id),
    db.from('open_play_session_resources').select('resources(id, capacity)').eq('session_id', session.id),
    session.activity_id
      ? db.from('activities').select('id, min_players, max_players, team_mode, team_size').eq('id', session.activity_id)
      : db.from('activities').select('id, min_players, max_players, team_mode, team_size').eq('section_id', session.section_id).eq('active', true),
  ]);
  for (const result of [requestsResult, resourcesResult, activitiesResult]) if (result.error) throw result.error;

  const rows = requestsResult.data as Array<{ profile_id: string; priority: number; created_at: string }>;
  const profileIds = rows.map((r) => r.profile_id);
  const [favourites, skills] = await Promise.all([
    session.activity_id ? new Map<string, string[]>() : favouritesOf(db, session.section_id, profileIds),
    skillsOf(db, session.section_id, profileIds),
  ]);
  const requests: MatchRequest[] = rows.map((r) => ({
    profileId: r.profile_id,
    skill: skillIn(skills, r.profile_id),
    favourites: favourites.get(r.profile_id) ?? [],
    priority: r.priority,
    requestedAt: Date.parse(r.created_at),
  }));
  const activities: MatchActivity[] = (activitiesResult.data as Array<{ id: string; min_players: number; max_players: number; team_mode: 'none' | 'two_teams'; team_size: number | null }>).map(
    (a) => ({ id: a.id, minPlayers: a.min_players, maxPlayers: a.max_players, teamMode: a.team_mode, teamSize: a.team_size }),
  );
  const resources = (resourcesResult.data as unknown as Array<{ resources: { id: string; capacity: number } }>).map((r) => r.resources);

  const plan = planMatch({ sessionId: session.id, fixedActivityId: session.activity_id, activities, resources, requests });
  if (plan.groups.length === 0) return 'no_groups';

  const { data, error } = await db.rpc('apply_match', {
    p_session_id: session.id,
    p_groups: plan.groups.map((g) => ({
      resource_id: g.resourceId,
      activity_id: g.activityId,
      capacity: g.capacity,
      seats: g.seats.map((s) => ({ profile_id: s.profileId, seat_no: s.seatNo, team: s.team })),
    })),
    p_waitlist: plan.waitlist,
  });
  if (error) throw error;
  return data as MatchOutcome;
}

// ── Freed seats and offers ──────────────────────────────────────────────────

/** Offers a free seat to the waiting player who fits the table best (rankWaitlist). */
export async function offerNext(db: SupabaseClient, input: { groupId: string; seatNo: number }): Promise<OfferNextOutcome> {
  const { data: group, error } = await db
    .from('groups')
    .select('id, session_id, activity_id, open_play_sessions(activity_id, status, starts_at, section_id)')
    .eq('id', input.groupId)
    .maybeSingle();
  if (error) throw error;
  const session = (group as { open_play_sessions: { activity_id: string | null; status: string; starts_at: string; section_id: string } } | null)?.open_play_sessions;
  if (!group || !session || !isLive(session)) return 'closed';

  const [entriesResult, tableResult] = await Promise.all([
    db.from('waitlist_entries').select('id, profile_id, priority, created_at').eq('session_id', group.session_id).eq('status', 'waiting'),
    db.from('bookings').select('profile_id').eq('group_id', group.id).neq('status', 'cancelled'),
  ]);
  for (const result of [entriesResult, tableResult]) if (result.error) throw result.error;
  const waiting = entriesResult.data as Array<{ id: string; profile_id: string; priority: number; created_at: string }>;
  if (waiting.length === 0) return 'no_candidate';
  const table = (tableResult.data as Array<{ profile_id: string }>).map((b) => b.profile_id);

  const [favourites, skills] = await Promise.all([
    session.activity_id ? new Map<string, string[]>() : favouritesOf(db, session.section_id, waiting.map((e) => e.profile_id)),
    skillsOf(db, session.section_id, [...waiting.map((e) => e.profile_id), ...table]),
  ]);
  const candidates: WaitlistCandidate[] = waiting.map((e) => {
    const picked = favourites.get(e.profile_id) ?? [];
    return {
      id: e.profile_id,
      skill: skillIn(skills, e.profile_id),
      // A fixed session's game is everyone's; someone with no favourites plays anything.
      favourites: session.activity_id ? [session.activity_id] : picked.length > 0 ? picked : [group.activity_id],
      priority: e.priority,
      requestedAt: Date.parse(e.created_at),
      available: true,
    };
  });
  const tableSkills = table.map((id) => skillIn(skills, id));
  const entryOf = new Map(waiting.map((e) => [e.profile_id, e.id]));

  for (const profileId of rankWaitlist({ gameId: group.activity_id, tableSkills }, candidates)) {
    const { error: offerError } = await db.rpc('create_offer', { p_group_id: group.id, p_seat_no: input.seatNo, p_waitlist_entry_id: entryOf.get(profileId) });
    if (!offerError) return 'offered';
    if (/seat_not_free|offer_pending/.test(offerError.message)) return 'seat_not_free';
    if (/session_closed/.test(offerError.message)) return 'closed';
    if (!/entry_not_waiting/.test(offerError.message)) throw offerError;
    // That player was just offered another seat or withdrew; try the next one.
  }
  return 'no_candidate';
}

/** Cancels a seat (a player their own, before the cut-off; staff any, before the start) and offers it on. */
export async function cancelSeat(
  db: SupabaseClient,
  input: { organizationId: string; bookingId: string; actor: { kind: 'player'; profileId: string } | { kind: 'staff' }; now?: Date },
): Promise<CancelSeatOutcome> {
  if (!UUID.test(input.bookingId) || !UUID.test(input.organizationId)) return 'not_found';
  const { data, error } = await db
    .from('bookings')
    .select('id, profile_id, status, group_id, seat_no, open_play_sessions(status, starts_at, sections(cancel_cutoff_minutes))')
    .eq('id', input.bookingId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (error) throw error;
  const booking = data as {
    profile_id: string;
    status: string;
    group_id: string;
    seat_no: number;
    open_play_sessions: { status: string; starts_at: string; sections: { cancel_cutoff_minutes: number } };
  } | null;
  if (!booking || (input.actor.kind === 'player' && booking.profile_id !== input.actor.profileId)) return 'not_found';
  if (booking.status !== 'confirmed') return 'not_cancellable';
  const session = booking.open_play_sessions;
  if (session.status !== 'open' && session.status !== 'matched') return 'closed';

  const now = input.now ?? new Date();
  const start = new Date(session.starts_at).getTime();
  if (now.getTime() >= start) return 'too_late';
  if (input.actor.kind === 'player' && now.getTime() >= start - session.sections.cancel_cutoff_minutes * 60_000) return 'too_late';

  const { data: freed, error: cancelError } = await db.rpc('cancel_booking', { p_booking_id: input.bookingId, p_by_venue: input.actor.kind === 'staff' });
  if (cancelError) throw cancelError;
  if (!(freed as unknown[]).length) return 'closed';
  await handOn(db, booking.group_id, booking.seat_no);
  return 'cancelled';
}

/** Take the seat / No thanks. A declined seat (or one the player no longer needs) goes to the next player. */
export async function respondToOffer(db: SupabaseClient, input: { offerId: string; response: 'accept' | 'decline' }): Promise<RespondOutcome> {
  if (!UUID.test(input.offerId)) return 'not_found';
  const { data: offer, error } = await db.from('seat_offers').select('group_id, seat_no').eq('id', input.offerId).maybeSingle();
  if (error) throw error;
  if (!offer) return 'not_found';
  const { data, error: rpcError } = await db.rpc(input.response === 'accept' ? 'accept_offer' : 'decline_offer', { p_offer_id: input.offerId });
  if (rpcError) throw rpcError;
  const outcome = data as RespondOutcome;
  if ((input.response === 'decline' && outcome === 'declined') || outcome === 'already_booked') {
    await handOn(db, offer.group_id, offer.seat_no);
  }
  return outcome;
}

/**
 * Offers a just-freed seat on. The cancel or decline has already committed, so a failure here is only
 * logged: the player still gets their answer, and the tick's refill step offers the seat next time.
 */
async function handOn(db: SupabaseClient, groupId: string, seatNo: number): Promise<void> {
  try {
    await offerNext(db, { groupId, seatNo });
  } catch (error) {
    console.error(`offering seat ${seatNo} of group ${groupId} failed; the tick will retry:`, error);
  }
}

/**
 * Mints the token for an offer email and stores only its hash; a newer token replaces the older one.
 * Returns null once the offer is no longer pending. The token must go nowhere but the email.
 */
export async function issueOfferToken(db: SupabaseClient, offerId: string): Promise<string | null> {
  if (!UUID.test(offerId)) return null;
  const token = randomBytes(32).toString('base64url');
  const { data, error } = await db.rpc('issue_offer_token', { p_offer_id: offerId, p_token_hash: sha256hex(token) });
  if (error) throw error;
  return data === 'issued' ? token : null;
}

/** An offer by its email token (anyone holding the link), or by id for the signed-in player it was made to. */
export async function findOffer(
  db: SupabaseClient,
  by: { token: string } | { offerId: string; profileId: string; organizationId: string },
): Promise<OfferView | null> {
  let query = db
    .from('seat_offers')
    .select(
      'id, status, expires_at, seat_no, organizations(slug), waitlist_entries(profile_id), groups(activities(name, team_mode, team_size), resources(name), open_play_sessions(id, starts_at, ends_at, seat_price_poisha))',
    );
  if ('token' in by) {
    if (!TOKEN.test(by.token)) return null;
    query = query.eq('token_hash', sha256hex(by.token));
  } else {
    if (!UUID.test(by.offerId) || !UUID.test(by.organizationId)) return null;
    query = query.eq('id', by.offerId).eq('organization_id', by.organizationId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  const row = data as {
    id: string;
    status: string;
    expires_at: string;
    seat_no: number;
    organizations: { slug: string };
    waitlist_entries: { profile_id: string };
    groups: {
      activities: { name: string; team_mode: string; team_size: number | null };
      resources: { name: string };
      open_play_sessions: { id: string; starts_at: string; ends_at: string; seat_price_poisha: number };
    };
  } | null;
  if (!row || ('profileId' in by && row.waitlist_entries.profile_id !== by.profileId)) return null;
  const session = row.groups.open_play_sessions;
  return {
    id: row.id,
    organizationSlug: row.organizations.slug,
    status: row.status,
    expiresAt: row.expires_at,
    seatNo: row.seat_no,
    team: teamOf(row.seat_no, row.groups.activities),
    session: {
      id: session.id,
      startsAt: session.starts_at,
      endsAt: session.ends_at,
      activityName: row.groups.activities.name,
      resourceName: row.groups.resources.name,
      pricePoisha: session.seat_price_poisha,
    },
  };
}

// ── Views ───────────────────────────────────────────────────────────────────

/** Seats still to be had per session (counts only); see seatCounts. */
export async function seatsLeft(db: SupabaseClient, input: { organizationId: string; sessionIds: string[] }): Promise<Map<string, number>> {
  const counts = await seatCounts(db, input);
  return new Map([...counts].map(([id, c]) => [id, c.left]));
}

/**
 * Seats per session (counts only). `total`: before matching, what the session's spaces could seat;
 * after, the formed groups' capacity. `left`: total minus requests (before) or minus seats taken and
 * on offer (after). Never below 0; 0 left once closed.
 */
export async function seatCounts(
  db: SupabaseClient,
  input: { organizationId: string; sessionIds: string[] },
): Promise<Map<string, { left: number; total: number }>> {
  const ids = input.sessionIds.filter((id) => UUID.test(id));
  const result = new Map<string, { left: number; total: number }>();
  if (ids.length === 0 || !UUID.test(input.organizationId)) return result;

  const [sessionsResult, bookingsResult, offersResult] = await Promise.all([
    db
      .from('open_play_sessions')
      .select('id, status, activities(min_players, max_players, team_mode, team_size), open_play_session_resources(resources(capacity)), groups(capacity), seat_requests(count)')
      .in('id', ids)
      .eq('organization_id', input.organizationId),
    db.from('bookings').select('session_id').in('session_id', ids).neq('status', 'cancelled'),
    db.from('seat_offers').select('groups!inner(session_id)').in('groups.session_id', ids).eq('status', 'pending'),
  ]);
  for (const r of [sessionsResult, bookingsResult, offersResult]) if (r.error) throw r.error;

  const tally = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const booked = tally((bookingsResult.data as Array<{ session_id: string }>).map((b) => b.session_id));
  const offered = tally((offersResult.data as unknown as Array<{ groups: { session_id: string } }>).map((o) => o.groups.session_id));

  for (const s of sessionsResult.data as unknown as Array<{
    id: string;
    status: string;
    activities: { min_players: number; max_players: number; team_mode: string; team_size: number | null } | null;
    open_play_session_resources: Array<{ resources: { capacity: number } }>;
    groups: Array<{ capacity: number }>;
    seat_requests: Array<{ count: number }>;
  }>) {
    let free = 0;
    let total = 0;
    if (s.status === 'matched') {
      total = s.groups.reduce((sum, g) => sum + g.capacity, 0);
      free = total - (booked.get(s.id) ?? 0) - (offered.get(s.id) ?? 0);
    } else if (s.status === 'open') {
      total = s.open_play_session_resources.reduce((sum, { resources: r }) => {
        const a = s.activities;
        if (!a) return sum + r.capacity;
        const size = a.team_mode === 'two_teams' && a.team_size ? 2 * a.team_size : Math.min(r.capacity, a.max_players);
        return sum + (r.capacity >= size && size >= a.min_players ? size : 0);
      }, 0);
      free = total - (s.seat_requests[0]?.count ?? 0);
    }
    result.set(s.id, { left: Math.max(0, free), total });
  }
  return result;
}

interface GroupRow {
  id: string;
  capacity: number;
  resources: { name: string };
  activities: { name: string; team_mode: string; team_size: number | null };
  bookings: Array<{ id: string; seat_no: number; status: string; profile_id: string; player_profiles: { display_name: string } }>;
}

const GROUP_COLUMNS = 'id, capacity, resources(name), activities(name, team_mode, team_size), bookings(id, seat_no, status, profile_id, player_profiles(display_name))';

/** A group's live seats split by team (one list for free-for-all games), in seat order. */
function teamsOf(group: GroupRow) {
  const seats = group.bookings.filter((b) => b.status !== 'cancelled').sort((a, b) => a.seat_no - b.seat_no);
  const teams: Array<1 | 2 | null> = group.activities.team_mode === 'two_teams' ? [1, 2] : [null];
  return teams.map((team) => ({ team, seats: seats.filter((b) => teamOf(b.seat_no, group.activities) === team) }));
}

export async function playerSessionView(
  db: SupabaseClient,
  input: { organizationId: string; sessionId: string; profileId: string | null; now?: Date },
): Promise<PlayerSessionView | null> {
  const session = await loadSession(db, input.organizationId, input.sessionId);
  if (!session) return null;
  const left = (await seatsLeft(db, { organizationId: input.organizationId, sessionIds: [session.id] })).get(session.id) ?? 0;
  const view: PlayerSessionView = { session: summary(session), seatsLeft: left, me: null, group: null };
  if (!input.profileId || !UUID.test(input.profileId)) return view;

  const [bookingResult, entryResult, requestResult] = await Promise.all([
    db.from('bookings').select('id, group_id, seat_no, team').eq('session_id', session.id).eq('profile_id', input.profileId).neq('status', 'cancelled').maybeSingle(),
    db.from('waitlist_entries').select('id, status, queue_position').eq('session_id', session.id).eq('profile_id', input.profileId).maybeSingle(),
    db.from('seat_requests').select('id').eq('session_id', session.id).eq('profile_id', input.profileId).maybeSingle(),
  ]);
  for (const r of [bookingResult, entryResult, requestResult]) if (r.error) throw r.error;
  const booking = bookingResult.data as { id: string; group_id: string; team: 1 | 2 | null } | null;
  const entry = entryResult.data as { id: string; status: string; queue_position: number } | null;

  if (booking) {
    const cutoff = session.sections.cancel_cutoff_minutes;
    const now = (input.now ?? new Date()).getTime();
    view.me = {
      state: 'seated',
      bookingId: booking.id,
      team: booking.team,
      cancellable: isLive(session) && now < new Date(session.starts_at).getTime() - cutoff * 60_000,
    };
    const { data: group, error } = await db.from('groups').select(GROUP_COLUMNS).eq('id', booking.group_id).single();
    if (error) throw error;
    const row = group as unknown as GroupRow;
    view.group = {
      resourceName: row.resources.name,
      activityName: row.activities.name,
      teams: teamsOf(row).map(({ team, seats }) => ({ team, names: seats.map((b) => b.player_profiles.display_name) })),
    };
  } else if (entry?.status === 'offered') {
    const { data: offer, error } = await db.from('seat_offers').select('id').eq('waitlist_entry_id', entry.id).eq('status', 'pending').maybeSingle();
    if (error) throw error;
    view.me = { state: 'offered', offerId: offer?.id };
  } else if (entry?.status === 'waiting') {
    const { count, error } = await db
      .from('waitlist_entries')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', session.id)
      .in('status', ['waiting', 'offered'])
      .lte('queue_position', entry.queue_position);
    if (error) throw error;
    view.me = { state: 'waitlisted', position: count ?? 1 };
  } else if (requestResult.data && session.status === 'open') {
    view.me = { state: 'requested' };
  } else {
    const { count, error } = await db
      .from('profile_section_skills')
      .select('profile_id', { count: 'exact', head: true })
      .eq('profile_id', input.profileId)
      .eq('section_id', session.section_id);
    if (error) throw error;
    view.me = { state: 'none', needsRating: (count ?? 0) === 0 };
  }
  return view;
}

export async function staffSessionView(
  db: SupabaseClient,
  input: { organizationId: string; sessionId: string; now?: Date },
): Promise<StaffSessionView | null> {
  const session = await loadSession(db, input.organizationId, input.sessionId);
  if (!session) return null;

  const [requestsResult, groupsResult, entriesResult, offersResult, choicesResult] = await Promise.all([
    db.from('seat_requests').select('profile_id, created_at, player_profiles(display_name)').eq('session_id', session.id).order('created_at'),
    db.from('groups').select(GROUP_COLUMNS).eq('session_id', session.id).order('id'),
    db.from('waitlist_entries').select('queue_position, status, player_profiles(display_name)').eq('session_id', session.id).in('status', ['waiting', 'offered']).order('queue_position'),
    db
      .from('seat_offers')
      .select('seat_no, expires_at, waitlist_entries(player_profiles(display_name)), groups!inner(session_id, resources(name))')
      .eq('groups.session_id', session.id)
      .eq('status', 'pending')
      .order('expires_at'),
    session.activity_id
      ? Promise.resolve({ data: [], error: null })
      : db.from('activities').select('min_players').eq('section_id', session.section_id).eq('active', true),
  ]);
  for (const r of [requestsResult, groupsResult, entriesResult, offersResult, choicesResult]) if (r.error) throw r.error;

  const requests = requestsResult.data as unknown as Array<{ profile_id: string; player_profiles: { display_name: string } }>;
  const groups = groupsResult.data as unknown as GroupRow[];
  const skills = await skillsOf(db, session.section_id, [...requests.map((r) => r.profile_id), ...groups.flatMap((g) => g.bookings.map((b) => b.profile_id))]);

  const fixed = session.activities;
  const minima = (choicesResult.data as Array<{ min_players: number }>).map((a) => a.min_players);
  const needed = fixed ? (fixed.team_mode === 'two_teams' && fixed.team_size ? 2 * fixed.team_size : fixed.min_players) : minima.length ? Math.min(...minima) : null;
  const now = (input.now ?? new Date()).getTime();
  const cutoff = new Date(session.starts_at).getTime() - session.sections.match_cutoff_minutes * 60_000;

  return {
    session: summary(session),
    requests: requests.map((r) => ({ profileId: r.profile_id, name: r.player_profiles.display_name, skill: skillIn(skills, r.profile_id) })),
    groups: groups.map((g) => ({
      id: g.id,
      resourceName: g.resources.name,
      activityName: g.activities.name,
      capacity: g.capacity,
      teams: teamsOf(g).map(({ team, seats }) => ({
        team,
        skillTotal: seats.reduce((sum, b) => sum + skillIn(skills, b.profile_id), 0),
        players: seats.map((b) => ({ bookingId: b.id, name: b.player_profiles.display_name, skill: skillIn(skills, b.profile_id), seatNo: b.seat_no })),
      })),
    })),
    waitlist: (entriesResult.data as unknown as Array<{ status: string; player_profiles: { display_name: string } }>).map((e, i) => ({
      position: i + 1,
      name: e.player_profiles.display_name,
      status: e.status,
    })),
    offers: (offersResult.data as unknown as Array<{ seat_no: number; expires_at: string; waitlist_entries: { player_profiles: { display_name: string } }; groups: { resources: { name: string } } }>).map(
      (o) => ({ name: o.waitlist_entries.player_profiles.display_name, seatNo: o.seat_no, resourceName: o.groups.resources.name, expiresAt: o.expires_at }),
    ),
    needed,
    notEnoughPlayers: session.status === 'open' && now >= cutoff && isLive(session, new Date(now)),
  };
}

/** A player's open-play seats at one venue: upcoming (soonest first) and the last 20 past ones. */
export async function listMySeats(
  db: SupabaseClient,
  input: { organizationId: string; profileId: string; now?: Date },
): Promise<{ upcoming: MySeat[]; past: MySeat[] }> {
  if (!UUID.test(input.organizationId) || !UUID.test(input.profileId)) return { upcoming: [], past: [] };
  const { data, error } = await db
    .from('bookings')
    .select('id, session_id, seat_no, team, price_poisha, status, groups(activities(name), resources(name)), open_play_sessions(starts_at, ends_at, status, sections(cancel_cutoff_minutes))')
    .eq('organization_id', input.organizationId)
    .eq('profile_id', input.profileId);
  if (error) throw error;
  const now = (input.now ?? new Date()).getTime();
  const seats = (data as unknown as Array<{
    id: string;
    session_id: string;
    team: 1 | 2 | null;
    price_poisha: number;
    status: string;
    groups: { activities: { name: string }; resources: { name: string } };
    open_play_sessions: { starts_at: string; ends_at: string; status: string; sections: { cancel_cutoff_minutes: number } };
  }>).map((b): MySeat => {
    const start = new Date(b.open_play_sessions.starts_at).getTime();
    const cutoff = b.open_play_sessions.sections.cancel_cutoff_minutes;
    return {
      bookingId: b.id,
      sessionId: b.session_id,
      activityName: b.groups.activities.name,
      resourceName: b.groups.resources.name,
      startsAt: b.open_play_sessions.starts_at,
      endsAt: b.open_play_sessions.ends_at,
      team: b.team,
      pricePoisha: b.price_poisha,
      status: b.status,
      cancellable: b.status === 'confirmed' && isLive(b.open_play_sessions, new Date(now)) && now < start - cutoff * 60_000,
    };
  });
  const upcoming = seats.filter((s) => s.status === 'confirmed' && Date.parse(s.startsAt) > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = seats
    .filter((s) => !upcoming.includes(s))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 20);
  return { upcoming, past };
}
