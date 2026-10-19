import {
  createRng,
  formGroups,
  groupCapacity,
  rankWaitlist,
  type EngineGame,
  type EnginePlayer,
  type EngineTable,
  type WaitlistCandidate,
} from '@bm/engine';
import { toEngineGames, toEnginePlayer, toEngineTables } from './engine-adapters';
import type { SimPlayers } from './players';
import type {
  BookingRow,
  EventRow,
  GroupRow,
  PlayerGameRow,
  SeatOfferRow,
  SeatRequestRow,
  SessionRow,
  WaitlistEntryRow,
} from './rows';
import { zonedTimeToUtc } from './time';
import type { SimVenue } from './venue';

export interface SimHistory {
  sessions: SessionRow[];
  seat_requests: SeatRequestRow[];
  groups: GroupRow[];
  bookings: BookingRow[];
  waitlist_entries: WaitlistEntryRow[];
  seat_offers: SeatOfferRow[];
  events: EventRow[];
}

const HOUR = 3_600_000;
const SECOND = 1_000;
const DAY = 24 * HOUR;
const REFILL_CHANCE = 0.7;
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Past, closed sessions for the owner dashboard: requests, engine-formed groups,
 * attended / no-show / cancelled bookings, and cancelled seats refilled from the waitlist.
 */
export function generateHistory(o: {
  venue: SimVenue;
  players: SimPlayers;
  weeks: number;
  /** YYYY-MM-DD, exclusive. */
  endDate: string;
  seed: number;
}): SimHistory {
  const rng = createRng(o.seed);
  const venueId = o.venue.venue.id;
  const tz = o.venue.venue.timezone;
  const ttlMs = o.venue.venue.offer_ttl_seconds * SECOND;
  const games = toEngineGames(o.venue.games);
  const tables = toEngineTables(o.venue.venue_tables);
  const gameById = new Map<string, EngineGame>(games.map((g) => [g.id, g]));
  const tableById = new Map<string, EngineTable>(tables.map((t) => [t.id, t]));
  const skillOf = new Map(o.players.players.map((p) => [p.id, p.skill]));

  const gamesByPlayer = new Map<string, PlayerGameRow[]>();
  for (const pg of o.players.player_games) gamesByPlayer.set(pg.player_id, [...(gamesByPlayer.get(pg.player_id) ?? []), pg]);
  const weekdaysByPlayer = new Map<string, Set<number>>();
  for (const a of o.players.availability) {
    weekdaysByPlayer.set(a.player_id, (weekdaysByPlayer.get(a.player_id) ?? new Set()).add(a.weekday));
  }

  const out: SimHistory = { sessions: [], seat_requests: [], groups: [], bookings: [], waitlist_entries: [], seat_offers: [], events: [] };
  const waitlistedLastTime = new Map<string, boolean>();
  const event = (sessionId: string, type: EventRow['type'], payload: Record<string, unknown>, at: number) =>
    out.events.push({ id: rng.uuid(), venue_id: venueId, session_id: sessionId, type, payload, created_at: iso(at) });

  const end = Date.parse(`${o.endDate}T00:00:00Z`);
  let sessionIndex = 0;
  for (let day = end - o.weeks * 7 * DAY; day < end; day += DAY) {
    const date = iso(day).slice(0, 10);
    const weekday = new Date(day).getUTCDay();
    for (const night of o.venue.nights.filter((n) => n.weekday === weekday)) {
      const startsAt = zonedTimeToUtc(date, night.start, tz).getTime();
      const session: SessionRow = {
        id: rng.uuid(),
        venue_id: venueId,
        starts_at: iso(startsAt),
        ends_at: iso(zonedTimeToUtc(date, night.end, tz).getTime()),
        seat_price_cents: night.seatPriceCents,
        status: 'closed',
      };
      out.sessions.push(session);

      // Requests from players free that night.
      const requestChance = weekday === 5 || weekday === 6 ? 0.55 : 0.35;
      const requesters: EnginePlayer[] = [];
      for (const player of o.players.players) {
        if (!weekdaysByPlayer.get(player.id)?.has(weekday) || rng.next() >= requestChance) continue;
        const priority = waitlistedLastTime.get(player.id) ? 1 : 0;
        const requestedAt = startsAt - rng.int(73, 240) * HOUR;
        out.seat_requests.push({
          id: rng.uuid(),
          venue_id: venueId,
          session_id: session.id,
          player_id: player.id,
          priority,
          created_at: iso(requestedAt),
        });
        requesters.push(toEnginePlayer(player, gamesByPlayer.get(player.id) ?? [], priority, requestedAt));
      }

      const result = formGroups({ players: requesters, games, tables, seed: o.seed + sessionIndex });
      const bookedAt = iso(startsAt - 72 * HOUR);
      const cancelled: Array<{ booking: BookingRow; group: GroupRow }> = [];

      for (const g of result.groups) {
        const group: GroupRow = {
          id: rng.uuid(),
          venue_id: venueId,
          session_id: session.id,
          table_id: g.tableId,
          game_id: g.gameId,
          capacity: groupCapacity(gameById.get(g.gameId)!, tableById.get(g.tableId)!),
        };
        out.groups.push(group);
        g.playerIds.forEach((playerId, i) => {
          const roll = rng.next();
          const status = roll < 0.85 ? 'attended' : roll < 0.9 ? 'no_show' : 'cancelled';
          const booking: BookingRow = {
            id: rng.uuid(),
            venue_id: venueId,
            session_id: session.id,
            group_id: group.id,
            player_id: playerId,
            seat_no: i + 1,
            status,
            source: 'matched',
            price_cents: session.seat_price_cents,
            created_at: bookedAt,
            cancelled_at: status === 'cancelled' ? iso(startsAt - rng.int(1, 48) * HOUR) : null,
          };
          out.bookings.push(booking);
          if (status === 'cancelled') cancelled.push({ booking, group });
        });
      }

      const requesterById = new Map(requesters.map((p) => [p.id, p]));
      const entries = result.waitlist.map((playerId, i): WaitlistEntryRow => ({
        id: rng.uuid(),
        venue_id: venueId,
        session_id: session.id,
        player_id: playerId,
        priority: requesterById.get(playerId)!.priority,
        queue_position: i + 1,
        status: 'waiting',
        created_at: bookedAt,
      }));
      out.waitlist_entries.push(...entries);

      // Cancellations, some refilled from the waitlist.
      cancelled.sort((a, b) => a.booking.cancelled_at!.localeCompare(b.booking.cancelled_at!));
      for (const { booking, group } of cancelled) {
        const cancelledAt = Date.parse(booking.cancelled_at!);
        event(session.id, 'booking_cancelled', {
          booking_id: booking.id,
          player_id: booking.player_id,
          group_id: group.id,
          seat_no: booking.seat_no,
        }, cancelledAt);
        if (rng.next() >= REFILL_CHANCE) continue;

        const waiting = entries.filter((e) => e.status === 'waiting');
        const tableSkills = out.bookings
          .filter((b) => b.group_id === group.id && b.status !== 'cancelled')
          .map((b) => skillOf.get(b.player_id)!);
        const candidates: WaitlistCandidate[] = waiting.map((e) => ({ ...requesterById.get(e.player_id)!, available: true }));
        const [topId] = rankWaitlist({ gameId: group.game_id, tableSkills }, candidates);
        if (!topId) continue;
        const entry = waiting.find((e) => e.player_id === topId)!;

        // Answered inside the offer TTL so history never shows an accepted-after-expiry offer.
        const offeredAt = cancelledAt + rng.int(0, 120) * SECOND;
        const respondedAt = offeredAt + rng.int(60, Math.max(60, ttlMs / SECOND - 60)) * SECOND;
        const offer: SeatOfferRow = {
          id: rng.uuid(),
          venue_id: venueId,
          group_id: group.id,
          seat_no: booking.seat_no,
          waitlist_entry_id: entry.id,
          status: 'accepted',
          expires_at: iso(offeredAt + ttlMs),
          created_at: iso(offeredAt),
          responded_at: iso(respondedAt),
        };
        const refill: BookingRow = {
          id: rng.uuid(),
          venue_id: venueId,
          session_id: session.id,
          group_id: group.id,
          player_id: topId,
          seat_no: booking.seat_no,
          status: 'attended',
          source: 'waitlist',
          price_cents: session.seat_price_cents,
          created_at: iso(respondedAt),
          cancelled_at: null,
        };
        out.seat_offers.push(offer);
        out.bookings.push(refill);
        entry.status = 'promoted';
        event(session.id, 'offer_created', {
          offer_id: offer.id,
          player_id: topId,
          group_id: group.id,
          seat_no: booking.seat_no,
          expires_at: offer.expires_at,
        }, offeredAt);
        event(session.id, 'offer_accepted', { offer_id: offer.id, booking_id: refill.id, player_id: topId }, respondedAt);
        event(session.id, 'seat_filled', {
          group_id: group.id,
          seat_no: booking.seat_no,
          booking_id: refill.id,
          seconds_since_cancel: Math.round((respondedAt - cancelledAt) / SECOND),
        }, respondedAt);
      }

      for (const e of entries) if (e.status === 'waiting') e.status = 'expired';
      for (const p of requesters) waitlistedLastTime.set(p.id, false);
      for (const e of entries) if (e.status === 'expired') waitlistedLastTime.set(e.player_id, true);
      sessionIndex++;
    }
  }
  return out;
}
