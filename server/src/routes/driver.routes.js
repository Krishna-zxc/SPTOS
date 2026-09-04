/**
 * The driver check-in app (PRD FR-D1 … FR-D6).
 *
 * The whole product rests on this being effortless: the driver is at the wheel,
 * so a check-in has to be one tap (NFR usability). That is why the server, not
 * the phone, decides which stop was just reached — the app posts an occupancy
 * bucket and the next stop in sequence is derived here.
 *
 * Two properties matter on a phone with patchy signal (FR-D6):
 *   - every write is idempotent on `clientUuid`, so a replayed request cannot
 *     create a second check-in;
 *   - the batch endpoint reports per-item outcomes rather than failing whole,
 *     so one unusable queue entry does not strand the rest on the device.
 */
import { Router } from 'express';
import { z } from 'zod';
import { OCCUPANCY_VALUES, SOCKET_EVENTS } from '@sptos/shared';
import { query, queryOne } from '../db/index.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { ApiError, conflict, notFoundError } from '../middleware/errors.js';
import { applyCheckinEffects } from '../services/checkin.service.js';
import { getRouteStops } from '../services/live.service.js';
import { broadcastRouteUpdate, emitTripLifecycle } from '../services/realtime.js';

const router = Router();

// A check-in changes what every commuter on the route sees, so the whole router
// is driver-or-admin only (FR-S5).
router.use(authenticate, requireRole('driver', 'admin'));

const idSchema = z.coerce.number().int().positive();
const occupancySchema = z.enum(OCCUPANCY_VALUES);
const latitudeSchema = z.coerce.number().min(-90).max(90);
const longitudeSchema = z.coerce.number().min(-180).max(180);

/**
 * `stopId` is optional on purpose — omitting it is the one-tap path.
 * `clientUuid` is generated on the phone before the entry joins the outbox,
 * which is what makes replaying it safe.
 */
const checkinSchema = z.object({
  occupancy: occupancySchema,
  stopId: idSchema.optional(),
  event: z.enum(['arrived', 'departed']).default('departed'),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  clientUuid: z.string().trim().min(6).max(64).optional(),
  recordedAt: z.coerce.date().optional(),
});

const toCheckin = (row) => ({
  id: Number(row.id),
  stopId: Number(row.stop_id),
  seq: Number(row.seq),
  occupancy: row.occupancy,
  event: row.event,
  recordedAt: row.recorded_at,
  clientUuid: row.client_uuid ?? null,
});

/** Loads a trip, refusing it unless the caller owns it (an admin may assist). */
async function loadOwnedTrip(tripId, user) {
  const trip = await queryOne(
    `SELECT t.id, t.route_id, t.driver_id, t.status, t.started_at,
            r.code AS route_code, r.name AS route_name
       FROM trips t
       JOIN routes r ON r.id = t.route_id
      WHERE t.id = $1`,
    [tripId],
  );
  if (!trip) throw notFoundError('Trip');
  if (user.role !== 'admin' && Number(trip.driver_id) !== user.id) {
    throw new ApiError(403, 'That trip belongs to another driver.');
  }
  return trip;
}

async function loadOwnedCheckin(checkinId, user) {
  const row = await queryOne(
    `SELECT c.id, c.trip_id, c.stop_id, c.seq, c.occupancy, c.event, c.recorded_at,
            c.client_uuid, c.voided_at, t.route_id, t.driver_id
       FROM checkins c
       JOIN trips t ON t.id = c.trip_id
      WHERE c.id = $1`,
    [checkinId],
  );
  if (!row) throw notFoundError('Check-in');
  if (user.role !== 'admin' && Number(row.driver_id) !== user.id) {
    throw new ApiError(403, 'That check-in belongs to another driver.');
  }
  return row;
}

const requireActive = (trip) => {
  if (trip.status !== 'active') throw conflict(`This trip is already ${trip.status}.`);
  return trip;
};

/** Highest stop sequence already logged, ignoring corrections that were voided. */
async function lastSeqFor(tripId) {
  const row = await queryOne(
    `SELECT COALESCE(MAX(seq), 0)::int AS last_seq
       FROM checkins WHERE trip_id = $1 AND voided_at IS NULL`,
    [tripId],
  );
  return Number(row?.last_seq ?? 0);
}

/**
 * Everything the check-in screen renders: the ordered stops, what has already
 * been logged, and the single stop the next tap will confirm.
 */
async function tripProgress(trip) {
  const routeId = Number(trip.route_id);
  const [stops, logged] = await Promise.all([
    getRouteStops(routeId),
    query(
      `SELECT id, stop_id, seq, occupancy, event, recorded_at, client_uuid
         FROM checkins
        WHERE trip_id = $1 AND voided_at IS NULL
        ORDER BY seq, recorded_at`,
      [trip.id],
    ).then(({ rows }) => rows.map(toCheckin)),
  ]);

  const lastSeq = logged.reduce((max, row) => Math.max(max, row.seq), 0);

  return {
    trip: {
      tripId: Number(trip.id),
      routeId,
      routeCode: trip.route_code,
      routeName: trip.route_name,
      status: trip.status,
      startedAt: trip.started_at,
      lastOccupancy: logged.at(-1)?.occupancy ?? null,
    },
    stops,
    checkins: logged,
    nextStop: stops.find((stop) => stop.seq === lastSeq + 1) ?? null,
    stopsRemaining: Math.max(0, stops.length - lastSeq),
    isComplete: stops.length > 0 && lastSeq >= stops.length,
  };
}

/**
 * Writes one check-in. Returns `{ row, duplicate }` — a `clientUuid` already on
 * file resolves to the stored row instead of an error, so the outbox can safely
 * re-send anything whose response it never saw.
 */
async function insertCheckin({ trip, stops, input, lastSeq }) {
  if (stops.length === 0) throw conflict('This route has no stops configured.');

  const target = input.stopId
    ? stops.find((stop) => stop.stopId === Number(input.stopId))
    : stops.find((stop) => stop.seq === lastSeq + 1);

  if (input.stopId && !target) throw notFoundError('That stop on this route');
  if (!target) throw conflict('Every stop on this trip already has a check-in.');

  const recordedAt = (input.recordedAt ? new Date(input.recordedAt) : new Date()).toISOString();

  const inserted = await queryOne(
    `INSERT INTO checkins
       (trip_id, stop_id, seq, occupancy, event, latitude, longitude, client_uuid, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
     ON CONFLICT (client_uuid) DO NOTHING
     RETURNING id, stop_id, seq, occupancy, event, recorded_at, client_uuid`,
    [
      trip.id,
      target.stopId,
      target.seq,
      input.occupancy,
      input.event,
      input.latitude ?? null,
      input.longitude ?? null,
      input.clientUuid ?? null,
      recordedAt,
    ],
  );

  if (inserted) return { row: toCheckin(inserted), duplicate: false, stop: target };

  // DO NOTHING fired, so this uuid was stored by an earlier attempt. A null
  // client_uuid never conflicts, so reaching here means one was supplied.
  const existing = await queryOne(
    `SELECT id, stop_id, seq, occupancy, event, recorded_at, client_uuid
       FROM checkins WHERE client_uuid = $1`,
    [input.clientUuid],
  );
  return { row: existing ? toCheckin(existing) : null, duplicate: true, stop: target };
}

const ROUTE_CARD_COLUMNS = `r.id, r.code, r.name, r.description,
       (SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = r.id)::int AS stop_count`;

/** Routes this driver may run (FR-D1). */
router.get('/assignments', async (req, res) => {
  // An admin covering a shift is not in driver_assignments, so they see every
  // active route rather than an empty list they cannot fix from this screen.
  const isAdmin = req.user.role === 'admin';
  const { rows } = await query(
    isAdmin
      ? `SELECT ${ROUTE_CARD_COLUMNS} FROM routes r WHERE r.is_active = TRUE ORDER BY r.code`
      : `SELECT ${ROUTE_CARD_COLUMNS}
           FROM driver_assignments da
           JOIN routes r ON r.id = da.route_id AND r.is_active = TRUE
          WHERE da.driver_id = $1
          ORDER BY r.code`,
    isAdmin ? [] : [req.user.id],
  );

  res.json({
    routes: rows.map((row) => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      description: row.description,
      stopCount: Number(row.stop_count),
    })),
  });
});

/**
 * The trip in progress, if any. The app calls this on launch so a driver who
 * closed the tab mid-route resumes exactly where they left off.
 */
router.get('/active-trip', async (req, res) => {
  const trip = await queryOne(
    `SELECT t.id, t.route_id, t.driver_id, t.status, t.started_at,
            r.code AS route_code, r.name AS route_name
       FROM trips t
       JOIN routes r ON r.id = t.route_id
      WHERE t.driver_id = $1 AND t.status = 'active'
      ORDER BY t.started_at DESC
      LIMIT 1`,
    [req.user.id],
  );
  res.json(trip ? await tripProgress(trip) : { trip: null });
});

/** A driver's own recent trips, so they can review or correct today's work. */
router.get('/trips', async (req, res) => {
  const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) })
    .parse(req.query);

  const { rows } = await query(
    `SELECT t.id, t.route_id, t.status, t.started_at, t.ended_at,
            r.code AS route_code, r.name AS route_name,
            (SELECT COUNT(*) FROM checkins c
              WHERE c.trip_id = t.id AND c.voided_at IS NULL)::int AS checkin_count,
            (SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = t.route_id)::int AS stop_count
       FROM trips t
       JOIN routes r ON r.id = t.route_id
      WHERE t.driver_id = $1
      ORDER BY COALESCE(t.started_at, t.created_at) DESC
      LIMIT $2`,
    [req.user.id, limit],
  );

  res.json({
    trips: rows.map((row) => ({
      tripId: Number(row.id),
      routeId: Number(row.route_id),
      routeCode: row.route_code,
      routeName: row.route_name,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      checkinCount: Number(row.checkin_count),
      stopCount: Number(row.stop_count),
    })),
  });
});

router.get('/trips/:id', async (req, res) => {
  const tripId = idSchema.parse(req.params.id);
  res.json(await tripProgress(await loadOwnedTrip(tripId, req.user)));
});

/** Begin a trip on an assigned route (FR-D1). */
router.post('/trips', async (req, res) => {
  const input = z
    .object({ routeId: idSchema, scheduledStartAt: z.coerce.date().optional() })
    .parse(req.body);

  // A driver can only be on one bus at a time. Without this, a trip someone
  // forgot to end would keep broadcasting alongside the real one.
  const open = await queryOne("SELECT id FROM trips WHERE driver_id = $1 AND status = 'active'", [
    req.user.id,
  ]);
  if (open) throw conflict('Finish or cancel your current trip before starting another.');

  const route = await queryOne(
    'SELECT id, code, name FROM routes WHERE id = $1 AND is_active = TRUE',
    [input.routeId],
  );
  if (!route) throw notFoundError('Route');

  if (req.user.role !== 'admin') {
    const assigned = await queryOne(
      'SELECT 1 FROM driver_assignments WHERE driver_id = $1 AND route_id = $2',
      [req.user.id, input.routeId],
    );
    if (!assigned) throw new ApiError(403, 'You are not assigned to that route.');
  }

  const created = await queryOne(
    `INSERT INTO trips (route_id, driver_id, status, scheduled_start_at, started_at)
     VALUES ($1, $2, 'active', $3::timestamptz, now())
     RETURNING id, route_id, status, started_at`,
    [
      input.routeId,
      req.user.id,
      input.scheduledStartAt ? new Date(input.scheduledStartAt).toISOString() : null,
    ],
  );

  emitTripLifecycle(SOCKET_EVENTS.TRIP_STARTED, {
    tripId: Number(created.id),
    routeId: Number(route.id),
    routeCode: route.code,
    driverName: req.user.name,
    startedAt: created.started_at,
  });

  const trip = { ...created, route_code: route.code, route_name: route.name };
  res.status(201).json(await tripProgress(trip));
});

/**
 * The one tap (FR-D2, FR-D3). A body of `{ occupancy }` is enough: the stop is
 * derived, the response carries the refreshed screen state, and every commuter
 * watching the route is pushed the new position before this returns.
 */
router.post('/trips/:id/checkins', async (req, res) => {
  const tripId = idSchema.parse(req.params.id);
  const input = checkinSchema.parse(req.body);
  const trip = requireActive(await loadOwnedTrip(tripId, req.user));

  const [stops, lastSeq] = await Promise.all([
    getRouteStops(Number(trip.route_id)),
    lastSeqFor(tripId),
  ]);

  const { row, duplicate } = await insertCheckin({ trip, stops, input, lastSeq });

  // A replayed queue entry has already had its effects applied; re-running them
  // would log a second set of ETA predictions for the same moment.
  const effects = duplicate
    ? null
    : await applyCheckinEffects({
        tripId,
        routeId: Number(trip.route_id),
        reachedStopIds: [row.stopId],
        recordedAt: row.recordedAt,
      });

  res.status(duplicate ? 200 : 201).json({
    checkin: row,
    duplicate,
    alertsSent: effects?.alertsSent ?? 0,
    ...(await tripProgress(trip)),
  });
});

/**
 * Drains the offline outbox (FR-D6).
 *
 * Deliberately not one transaction: an all-or-nothing batch means a single
 * unusable entry — a stop that has since been removed, say — keeps the entire
 * queue stuck on the phone forever. Each entry is applied on its own and the
 * response says what happened to each, so the client can clear what landed and
 * show the driver only what genuinely failed.
 */
router.post('/trips/:id/checkins/batch', async (req, res) => {
  const tripId = idSchema.parse(req.params.id);
  const { checkins } = z
    .object({ checkins: z.array(checkinSchema).min(1).max(50) })
    .parse(req.body);
  const trip = requireActive(await loadOwnedTrip(tripId, req.user));

  const stops = await getRouteStops(Number(trip.route_id));
  let lastSeq = await lastSeqFor(tripId);

  // Oldest first: the queue is a timeline, and each entry's derived stop depends
  // on the ones before it.
  const ordered = [...checkins].sort(
    (a, b) => new Date(a.recordedAt ?? 0) - new Date(b.recordedAt ?? 0),
  );

  const results = [];
  const reachedStopIds = [];
  let latestRecordedAt = null;

  for (const input of ordered) {
    try {
      const { row, duplicate } = await insertCheckin({ trip, stops, input, lastSeq });
      if (row) {
        lastSeq = Math.max(lastSeq, row.seq);
        if (!duplicate) {
          reachedStopIds.push(row.stopId);
          latestRecordedAt = row.recordedAt;
        }
      }
      results.push({
        clientUuid: input.clientUuid ?? null,
        status: duplicate ? 'duplicate' : 'accepted',
        checkin: row,
      });
    } catch (err) {
      results.push({
        clientUuid: input.clientUuid ?? null,
        status: 'rejected',
        reason: err.message,
      });
    }
  }

    // One broadcast for the whole batch — subscribers care about where the bus is
  // now, not about each backfilled step it took to get there.
  const effects = reachedStopIds.length
    ? await applyCheckinEffects({
        tripId,
        routeId: Number(trip.route_id),
        reachedStopIds,
        recordedAt: latestRecordedAt ?? new Date(),
      })
    : null;

  const tally = (status) => results.filter((entry) => entry.status === status).length;

  res.status(201).json({
    results,
    accepted: tally('accepted'),
    duplicates: tally('duplicate'),
    rejected: tally('rejected'),
    alertsSent: effects?.alertsSent ?? 0,
    ...(await tripProgress(trip)),
  });
});

/** Correct a mistaken check-in (FR-D5) — usually the wrong occupancy button. */
router.patch('/checkins/:id', async (req, res) => {
  const checkinId = idSchema.parse(req.params.id);
  const input = z
    .object({ occupancy: occupancySchema.optional(), recordedAt: z.coerce.date().optional() })
    .refine((value) => value.occupancy || value.recordedAt, {
      message: 'Provide occupancy or recordedAt.',
    })
    .parse(req.body);

  const existing = await loadOwnedCheckin(checkinId, req.user);
  if (existing.voided_at) throw conflict('That check-in has already been removed.');

  const updated = await queryOne(
    `UPDATE checkins
        SET occupancy   = COALESCE($2, occupancy),
            recorded_at = COALESCE($3::timestamptz, recorded_at)
      WHERE id = $1
      RETURNING id, stop_id, seq, occupancy, event, recorded_at, client_uuid`,
    [
      checkinId,
      input.occupancy ?? null,
      input.recordedAt ? new Date(input.recordedAt).toISOString() : null,
    ],
  );

    // No stop was newly reached, so nothing to reconcile — but the crowding badge
  // and any downstream ETA shift still have to reach subscribers.
  await applyCheckinEffects({
    tripId: Number(existing.trip_id),
    routeId: Number(existing.route_id),
    reachedStopIds: [],
    recordedAt: updated.recorded_at,
  });

  res.json({ checkin: toCheckin(updated) });
});

/** Undo a check-in logged at the wrong stop (FR-D5). */
router.delete('/checkins/:id', async (req, res) => {
  const checkinId = idSchema.parse(req.params.id);
  const existing = await loadOwnedCheckin(checkinId, req.user);

  if (!existing.voided_at) {
    // Soft delete: the row survives so a mistaken tap stays auditable, and
    // segment_travel_samples already filters voided rows out of ETA history.
    await query('UPDATE checkins SET voided_at = now() WHERE id = $1', [checkinId]);
    await applyCheckinEffects({
      tripId: Number(existing.trip_id),
      routeId: Number(existing.route_id),
      reachedStopIds: [],
      recordedAt: new Date(),
    });
  }

  res.status(204).end();
});

/**
 * Optional GPS refinement while a trip is running (FR-D4).
 *
 * Accepted only for an active trip: per the privacy NFR, a driver's location is
 * of interest during their shift and at no other time.
 */
router.post('/trips/:id/positions', async (req, res) => {
  const tripId = idSchema.parse(req.params.id);
  const input = z
    .object({
      latitude: latitudeSchema,
      longitude: longitudeSchema,
      recordedAt: z.coerce.date().optional(),
    })
    .parse(req.body);

    const trip = requireActive(await loadOwnedTrip(tripId, req.user));

  await query(
    `INSERT INTO driver_positions (trip_id, latitude, longitude, recorded_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()))`,
    [
      tripId,
      input.latitude,
      input.longitude,
      input.recordedAt ? new Date(input.recordedAt).toISOString() : null,
    ],
  );

  // A breadcrumb sharpens the map but reaches no new stop, so no prediction is
  // logged and no arrival alert is evaluated.
  await broadcastRouteUpdate(Number(trip.route_id), {
    meta: { reason: 'position', tripId },
  });

  res.status(202).json({ ok: true });
});

/** Shared tail of end and cancel (FR-D5). */
async function closeTrip({ trip, status, driverName }) {
  const row = await queryOne(
    `UPDATE trips SET status = $2, ended_at = now()
      WHERE id = $1 AND status = 'active'
      RETURNING id, route_id, status, started_at, ended_at`,
    [trip.id, status],
  );
  if (!row) throw conflict(`This trip is already ${trip.status}.`);

  // Release commuters waiting on this bus: leaving the subscription pinned to a
  // finished trip would suppress the alert for the next one.
  await query(
    'UPDATE alert_subscriptions SET trip_id = NULL, notified_at = NULL WHERE trip_id = $1',
    [trip.id],
  );

  emitTripLifecycle(SOCKET_EVENTS.TRIP_ENDED, {
    tripId: Number(row.id),
    routeId: Number(row.route_id),
    routeCode: trip.route_code,
    driverName,
    status: row.status,
    endedAt: row.ended_at,
  });

    // The route now has one fewer active trip, so redraw it for subscribers.
  await broadcastRouteUpdate(Number(row.route_id), {
    meta: { reason: status, tripId: Number(row.id) },
  });

  return {
    tripId: Number(row.id),
    routeId: Number(row.route_id),
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

router.post('/trips/:id/end', async (req, res) => {
  const tripId = idSchema.parse(req.params.id);
  const trip = await loadOwnedTrip(tripId, req.user);
  res.json({
    trip: await closeTrip({ trip, status: 'completed', driverName: req.user.name }),
  });
});

/**
 * Cancelled trips are excluded from segment_travel_samples, so a run abandoned
 * part-way cannot poison the historical averages the ETAs are built from.
 */
router.post('/trips/:id/cancel', async (req, res) => {
  const tripId = idSchema.parse(req.params.id);
  const trip = await loadOwnedTrip(tripId, req.user);
  res.json({
    trip: await closeTrip({ trip, status: 'cancelled', driverName: req.user.name }),
  });
});

export default router;
