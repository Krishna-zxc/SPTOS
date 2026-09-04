/**
 * What a commuter sees (PRD FR-C2 … FR-C7).
 *
 * These endpoints are the REST twin of the WebSocket broadcasts: both are built
 * by live.service, so a page load and a pushed update can never disagree about
 * where a bus is.
 *
 * Every payload carries `staleAfterSeconds` and a per-trip `freshness` block.
 * That is not decoration — the transparency NFR forbids presenting an old
 * position as live, and it is the client's only way to tell the difference.
 */
import { Router } from 'express';
import { z } from 'zod';
import { ISSUE_KINDS } from '@sptos/shared';
import config from '../config.js';
import { query, queryOne } from '../db/index.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { notFoundError } from '../middleware/errors.js';
import { getRouteLive, getStopLive } from '../services/live.service.js';

const router = Router();

const idSchema = z.coerce.number().int().positive();

/** Live state of one route: active buses, positions, and ETAs per stop. */
router.get('/routes/:id/live', async (req, res) => {
  const routeId = idSchema.parse(req.params.id);
  const live = await getRouteLive(routeId);
  if (!live) throw notFoundError('Route');
  res.json(live);
});

/**
 * Live state at one stop — the screen a commuter actually waits on. `routeId`
 * narrows it to a single route when they already know which bus they want.
 */
router.get('/stops/:id/live', async (req, res) => {
  const stopId = idSchema.parse(req.params.id);
  const { routeId } = z.object({ routeId: idSchema.optional() }).parse(req.query);
  const live = await getStopLive(stopId, { routeId: routeId ?? null });
  if (!live) throw notFoundError('Stop');
  res.json(live);
});

/**
 * A trip's timeline, for the commuter who wants to know why the ETA moved.
 * Public, but deliberately thin: check-in times and occupancy, no driver
 * identity beyond a display name and no GPS breadcrumb trail.
 */
router.get('/trips/:id', optionalAuth, async (req, res) => {
  const tripId = idSchema.parse(req.params.id);
  const trip = await queryOne(
    `SELECT t.id, t.route_id, t.status, t.started_at, t.ended_at,
            u.name AS driver_name, r.code AS route_code, r.name AS route_name
       FROM trips t
       JOIN users u ON u.id = t.driver_id
       JOIN routes r ON r.id = t.route_id
      WHERE t.id = $1`,
    [tripId],
  );
  if (!trip) throw notFoundError('Trip');

  const { rows } = await query(
    `SELECT c.seq, c.stop_id, c.occupancy, c.event, c.recorded_at, s.name AS stop_name
       FROM checkins c
       JOIN stops s ON s.id = c.stop_id
      WHERE c.trip_id = $1 AND c.voided_at IS NULL
      ORDER BY c.seq, c.recorded_at`,
    [tripId],
  );

  res.json({
    trip: {
      tripId: Number(trip.id),
      routeId: Number(trip.route_id),
      routeCode: trip.route_code,
      routeName: trip.route_name,
      driverName: trip.driver_name,
      status: trip.status,
      startedAt: trip.started_at,
      endedAt: trip.ended_at,
    },
    checkins: rows.map((row) => ({
      seq: Number(row.seq),
      stopId: Number(row.stop_id),
      stopName: row.stop_name,
      occupancy: row.occupancy,
      event: row.event,
      recordedAt: row.recorded_at,
    })),
    staleAfterSeconds: config.staleAfterSeconds,
  });
});

/* ── Arrival alerts (FR-C6) ─────────────────────────────────────────────── */

const alertSchema = z.object({
  routeId: idSchema,
  stopId: idSchema,
  minutesBefore: z.coerce.number().int().min(1).max(60).default(config.arrivalAlertMinutes),
});

const toAlert = (row) => ({
  id: Number(row.id),
  routeId: Number(row.route_id),
  routeCode: row.route_code,
  routeName: row.route_name,
  stopId: Number(row.stop_id),
  stopName: row.stop_name,
  minutesBefore: Number(row.minutes_before),
  notifiedAt: row.notified_at ?? null,
  tripId: row.trip_id ? Number(row.trip_id) : null,
});

const ALERT_COLUMNS = `a.id, a.route_id, a.stop_id, a.minutes_before, a.notified_at, a.trip_id,
       r.code AS route_code, r.name AS route_name, s.name AS stop_name`;

router.get('/alerts', authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT ${ALERT_COLUMNS}
       FROM alert_subscriptions a
       JOIN routes r ON r.id = a.route_id
       JOIN stops  s ON s.id = a.stop_id
      WHERE a.user_id = $1
      ORDER BY r.code, s.name`,
    [req.user.id],
  );
  res.json({ alerts: rows.map(toAlert), defaultMinutesBefore: config.arrivalAlertMinutes });
});

/**
 * One subscription per user/route/stop, so tapping "alert me" twice adjusts the
 * lead time instead of queueing two notifications for the same bus.
 *
 * Re-subscribing clears `notified_at` and `trip_id`: the commuter is asking
 * about the *next* bus, and leaving the old marks in place would suppress it.
 */
router.post('/alerts', authenticate, async (req, res) => {
  const input = alertSchema.parse(req.body);

  const served = await queryOne('SELECT 1 FROM route_stops WHERE route_id = $1 AND stop_id = $2', [
    input.routeId,
    input.stopId,
  ]);
  if (!served) throw notFoundError('That stop on that route');

  const row = await queryOne(
    `INSERT INTO alert_subscriptions (user_id, route_id, stop_id, minutes_before)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, route_id, stop_id)
       DO UPDATE SET minutes_before = EXCLUDED.minutes_before,
                     notified_at    = NULL,
                     trip_id        = NULL
     RETURNING id`,
    [req.user.id, input.routeId, input.stopId, input.minutesBefore],
  );

  const created = await queryOne(
    `SELECT ${ALERT_COLUMNS}
       FROM alert_subscriptions a
       JOIN routes r ON r.id = a.route_id
       JOIN stops  s ON s.id = a.stop_id
      WHERE a.id = $1`,
    [row.id],
  );

  res.status(201).json({ alert: toAlert(created) });
});

router.delete('/alerts/:id', authenticate, async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const { rowCount } = await query(
    'DELETE FROM alert_subscriptions WHERE id = $1 AND user_id = $2',
    [id, req.user.id],
  );
  if (!rowCount) throw notFoundError('Alert');
  res.status(204).end();
});

/* ── Flagging a bad update (FR-C7) ──────────────────────────────────────── */

/**
 * Commuter corrections are the only quality signal on a system with no sensors,
 * so the barrier is one dropdown and an optional sentence. Sign-in is required
 * because §12 lists "inaccurate early ETAs" as a risk that an admin has to be
 * able to follow up on, not merely count.
 */
router.post('/issues', authenticate, async (req, res) => {
  const input = z
    .object({
      kind: z.enum(ISSUE_KINDS.map((entry) => entry.value)),
      routeId: idSchema.optional(),
      stopId: idSchema.optional(),
      tripId: idSchema.optional(),
      note: z.string().trim().max(500).optional(),
    })
    .parse(req.body);

  const row = await queryOne(
    `INSERT INTO issue_reports (user_id, route_id, stop_id, trip_id, kind, note, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'open')
     RETURNING id, kind, note, status, created_at`,
    [
      req.user.id,
      input.routeId ?? null,
      input.stopId ?? null,
      input.tripId ?? null,
      input.kind,
      input.note ?? null,
    ],
  );

  res.status(201).json({
    issue: {
      id: Number(row.id),
      kind: row.kind,
      note: row.note,
      status: row.status,
      createdAt: row.created_at,
    },
  });
});

/** Seeing a report get acknowledged is what makes reporting the next one feel worthwhile. */
router.get('/issues/mine', authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.kind, i.note, i.status, i.created_at,
            r.code AS route_code, s.name AS stop_name
       FROM issue_reports i
       LEFT JOIN routes r ON r.id = i.route_id
       LEFT JOIN stops  s ON s.id = i.stop_id
      WHERE i.user_id = $1
      ORDER BY i.created_at DESC
      LIMIT 50`,
    [req.user.id],
  );

  res.json({
    issues: rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      note: row.note,
      status: row.status,
      createdAt: row.created_at,
      routeCode: row.route_code ?? null,
      stopName: row.stop_name ?? null,
    })),
  });
});

export default router;
