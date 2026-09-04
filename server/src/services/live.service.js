/**
 * Live trip state for commuters (PRD FR-C2 … FR-C5, FR-S2).
 *
 * Everything a commuter screen needs is assembled here so the REST endpoint and
 * the WebSocket broadcast always emit the identical shape — a live update and a
 * page refresh can never disagree.
 */
import config from '../config.js';
import { freshness, occupancyLevel } from '@sptos/shared';
import { query, queryOne } from '../db/index.js';
import { estimateArrivals, getRouteResolver } from './eta.service.js';

const ACTIVE_TRIP_SQL = `
  SELECT t.id, t.route_id, t.driver_id, t.status, t.started_at,
         u.name AS driver_name,
         c.stop_id     AS last_stop_id,
         c.seq         AS last_seq,
         c.occupancy   AS last_occupancy,
         c.recorded_at AS last_recorded_at,
         g.latitude    AS gps_latitude,
         g.longitude   AS gps_longitude,
         g.recorded_at AS gps_recorded_at,
         (SELECT COUNT(*) FROM checkins x
           WHERE x.trip_id = t.id AND x.voided_at IS NULL)::int AS checkin_count
    FROM trips t
    JOIN users u ON u.id = t.driver_id
    LEFT JOIN LATERAL (
      SELECT stop_id, seq, occupancy, recorded_at
        FROM checkins
       WHERE trip_id = t.id AND voided_at IS NULL
       ORDER BY seq DESC, recorded_at DESC
       LIMIT 1
    ) c ON TRUE
    LEFT JOIN LATERAL (
      SELECT latitude, longitude, recorded_at
        FROM driver_positions
       WHERE trip_id = t.id
       ORDER BY recorded_at DESC
       LIMIT 1
    ) g ON TRUE
`;

/** Ordered stops of a route, with coordinates for the map. */
export async function getRouteStops(routeId) {
  const { rows } = await query(
    `SELECT rs.seq, rs.scheduled_offset_seconds, s.id AS stop_id, s.code, s.name,
            s.latitude, s.longitude
       FROM route_stops rs
       JOIN stops s ON s.id = rs.stop_id
      WHERE rs.route_id = $1
      ORDER BY rs.seq`,
    [routeId],
  );
  return rows.map((row) => ({
    seq: Number(row.seq),
    stopId: Number(row.stop_id),
    code: row.code,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    scheduledOffsetSeconds: Number(row.scheduled_offset_seconds),
  }));
}
/** Straight-line interpolation between two stops, for smoother map motion. */
export function interpolate(from, to, fraction) {
  const f = Math.min(1, Math.max(0, fraction));
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * f,
    longitude: from.longitude + (to.longitude - from.longitude) * f,
  };
}

/**
 * Where to draw the bus. Real GPS wins when it is fresher than the last
 * check-in (FR-D4); otherwise the position is projected along the current leg
 * from how much of the estimated leg time has elapsed. The `source` is returned
 * so the UI never implies more precision than it has.
 */
function resolvePosition({ row, stops, lastStop, nextStop, nextEta, now }) {
  const gpsAt = row.gps_recorded_at ? new Date(row.gps_recorded_at).getTime() : null;
  const checkinAt = row.last_recorded_at ? new Date(row.last_recorded_at).getTime() : null;

  if (gpsAt && (!checkinAt || gpsAt >= checkinAt)) {
    return {
      latitude: Number(row.gps_latitude),
      longitude: Number(row.gps_longitude),
      source: 'gps',
      reportedAt: new Date(gpsAt).toISOString(),
    };
  }

  if (!lastStop) {
    const first = stops[0];
    return first
      ? { latitude: first.latitude, longitude: first.longitude, source: 'route_start', reportedAt: null }
      : null;
  }

  if (nextStop && nextEta && checkinAt) {
    const legMs = new Date(nextEta.etaAt).getTime() - checkinAt;
    if (legMs > 0) {
      const point = interpolate(lastStop, nextStop, (new Date(now).getTime() - checkinAt) / legMs);
      return { ...point, source: 'projected', reportedAt: new Date(checkinAt).toISOString() };
    }
  }

  return {
    latitude: lastStop.latitude,
    longitude: lastStop.longitude,
    source: 'checkin',
    reportedAt: checkinAt ? new Date(checkinAt).toISOString() : null,
  };
}
/** Assembles one active trip into the shape every client renders. */
export function buildTripState({ row, stops, resolveSegment, now = Date.now() }) {
  const lastSeq = row.last_seq === null || row.last_seq === undefined ? 0 : Number(row.last_seq);
  const checkinCount = Number(row.checkin_count ?? 0);
  const lastStop = stops.find((stop) => stop.seq === lastSeq) ?? null;
  const nextStop = stops.find((stop) => stop.seq === lastSeq + 1) ?? null;

  // PRD open question 15.2.1: how much coverage before an ETA is trustworthy.
  // Configurable via MIN_CHECKINS_FOR_ETA rather than hard-coded.
  const hasEnoughCoverage = checkinCount >= config.minCheckinsForEta && lastSeq >= 1;

  const etas = hasEnoughCoverage
    ? estimateArrivals({
        resolveSegment,
        fromSeq: lastSeq,
        departedAt: row.last_recorded_at,
        stops,
        now,
      })
    : [];

  const fresh = freshness(row.last_recorded_at, {
    now,
    staleAfterSeconds: config.staleAfterSeconds,
  });

  const position = resolvePosition({
    row,
    stops,
    lastStop,
    nextStop,
    nextEta: etas[0] ?? null,
    now,
  });

  return {
    tripId: Number(row.id),
    routeId: Number(row.route_id),
    driverName: row.driver_name,
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    lastCheckin: lastStop
      ? {
          stopId: lastStop.stopId,
          stopName: lastStop.name,
          seq: lastSeq,
          occupancy: row.last_occupancy,
          occupancyLabel: occupancyLevel(row.last_occupancy)?.label ?? null,
          recordedAt: new Date(row.last_recorded_at).toISOString(),
        }
      : null,
    nextStop: nextStop ? { stopId: nextStop.stopId, stopName: nextStop.name, seq: nextStop.seq } : null,
    position,
    progress: {
      stopsCompleted: lastSeq,
      totalStops: stops.length,
      fraction: stops.length ? Number((lastSeq / stops.length).toFixed(3)) : 0,
    },
    checkinCount,
    // Presented separately from the ETA list so the UI can explain *why* there
    // is no estimate instead of silently showing nothing.
    etaAvailable: hasEnoughCoverage && !fresh.isStale,
    etaUnavailableReason: !hasEnoughCoverage
      ? 'awaiting_checkins'
      : fresh.isStale
        ? 'stale_data'
        : null,
    etas,
    freshness: fresh,
  };
}
/** Live view of one route: its stops plus every active trip on it (FR-C2). */
export async function getRouteLive(routeId, { now = Date.now() } = {}) {
  const route = await queryOne(
    'SELECT id, code, name, description, is_active FROM routes WHERE id = $1',
    [routeId],
  );
  if (!route) return null;

  const [stops, resolveSegment, active] = await Promise.all([
    getRouteStops(routeId),
    getRouteResolver(routeId),
    query(`${ACTIVE_TRIP_SQL} WHERE t.route_id = $1 AND t.status = 'active' ORDER BY t.started_at`, [
      routeId,
    ]),
  ]);

  return {
    route: {
      id: Number(route.id),
      code: route.code,
      name: route.name,
      description: route.description,
      isActive: route.is_active,
    },
    stops,
    trips: active.rows.map((row) => buildTripState({ row, stops, resolveSegment, now })),
    staleAfterSeconds: config.staleAfterSeconds,
    generatedAt: new Date(now).toISOString(),
  };
}

/**
 * Live view for a commuter standing at one stop (FR-C3, FR-C4, FR-C5): every
 * bus still upstream of them, soonest first.
 *
 * Routes are loaded one at a time. At pilot scale a stop is served by a handful
 * of routes, so this stays cheap; if a stop ever serves dozens, batch the
 * per-route loads before optimising anything else here.
 */
export async function getStopLive(stopId, { now = Date.now(), routeId = null } = {}) {
  const stop = await queryOne(
    'SELECT id, code, name, latitude, longitude FROM stops WHERE id = $1',
    [stopId],
  );
  if (!stop) return null;

  const { rows: serving } = await query(
    `SELECT rs.route_id, rs.seq, r.code, r.name
       FROM route_stops rs
       JOIN routes r ON r.id = rs.route_id
      WHERE rs.stop_id = $1
        AND r.is_active = TRUE
        AND ($2::int IS NULL OR rs.route_id = $2::int)
      ORDER BY r.code`,
    [stopId, routeId],
  );

  const arrivals = [];
  for (const entry of serving) {
    const live = await getRouteLive(Number(entry.route_id), { now });
    if (!live) continue;
    const stopSeq = Number(entry.seq);

    for (const trip of live.trips) {
      if (trip.progress.stopsCompleted >= stopSeq) continue; // already passed
      const eta = trip.etas.find((candidate) => candidate.seq === stopSeq) ?? null;
      arrivals.push({
        tripId: trip.tripId,
        routeId: Number(entry.route_id),
        routeCode: entry.code,
        routeName: entry.name,
        stopsAway: stopSeq - trip.progress.stopsCompleted,
        eta,
        occupancy: trip.lastCheckin?.occupancy ?? null,
        occupancyLabel: trip.lastCheckin?.occupancyLabel ?? null,
        lastCheckin: trip.lastCheckin,
        position: trip.position,
        freshness: trip.freshness,
        etaAvailable: trip.etaAvailable,
        etaUnavailableReason: trip.etaUnavailableReason,
      });
    }
  }

  arrivals.sort((a, b) => (a.eta?.etaMinutes ?? Infinity) - (b.eta?.etaMinutes ?? Infinity));

  return {
    stop: {
      id: Number(stop.id),
      code: stop.code,
      name: stop.name,
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
    },
    routes: serving.map((entry) => ({
      id: Number(entry.route_id),
      code: entry.code,
      name: entry.name,
      seq: Number(entry.seq),
    })),
    arrivals,
    staleAfterSeconds: config.staleAfterSeconds,
    generatedAt: new Date(now).toISOString(),
  };
}

/** Every active trip across the network, for the admin live map (FR-A4). */
export async function getNetworkLive({ now = Date.now() } = {}) {
  const { rows } = await query(
    `SELECT DISTINCT t.route_id FROM trips t WHERE t.status = 'active'`,
  );
  const routes = [];
  for (const row of rows) {
    const live = await getRouteLive(Number(row.route_id), { now });
    if (live) routes.push(live);
  }
  return {
    routes,
    activeTrips: routes.reduce((total, route) => total + route.trips.length, 0),
    generatedAt: new Date(now).toISOString(),
  };
}



