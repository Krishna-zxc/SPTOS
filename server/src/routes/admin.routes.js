/**
 * The planning dashboard (PRD FR-A1 … FR-A6).
 *
 * §4 frames the point of this surface: the pilot has to be able to show whether
 * the system worked. So alongside the CRUD that keeps routes accurate, the
 * analytics endpoints report the PRD's own success metrics — demand by stop and
 * time band, punctuality per segment, ETA accuracy, check-in coverage and
 * update freshness — and every one of them is exportable as CSV.
 */
import { Router } from 'express';
import { z } from 'zod';
import { ISSUE_KINDS, ISSUE_STATUSES, ROLES } from '@sptos/shared';
import { query, queryOne, withTransaction } from '../db/index.js';
import { authenticate, hashPassword, requireRole } from '../middleware/auth.js';
import { ApiError, conflict, notFoundError } from '../middleware/errors.js';
import {
  getDemandAnalytics,
  getOperationsSummary,
  getPunctualityAnalytics,
  toCsv,
} from '../services/analytics.service.js';
import { getNetworkLive } from '../services/live.service.js';

const router = Router();

router.use(authenticate, requireRole('admin'));

const idSchema = z.coerce.number().int().positive();
const windowSchema = z.object({
  routeId: idSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, 'Use letters, digits, spaces, dashes or underscores.');

/* ── Routes and their stop sequences (FR-A1) ─────────────────────────────── */

const routeBody = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
});

router.get('/routes', async (_req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.code, r.name, r.description, r.is_active,
            (SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = r.id)::int AS stop_count,
            (SELECT COUNT(*) FROM trips t WHERE t.route_id = r.id)::int          AS trip_count
       FROM routes r
      ORDER BY r.code`,
  );
  res.json({
    routes: rows.map((row) => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      description: row.description,
      isActive: row.is_active,
      stopCount: Number(row.stop_count),
      tripCount: Number(row.trip_count),
    })),
  });
});

router.post('/routes', async (req, res) => {
  const input = routeBody.parse(req.body);
  const row = await queryOne(
    `INSERT INTO routes (code, name, description, is_active)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.code, input.name, input.description ?? null, input.isActive],
  );
  res.status(201).json({ id: Number(row.id) });
});

router.patch('/routes/:id', async (req, res) => {
  const routeId = idSchema.parse(req.params.id);
  const input = routeBody.partial().parse(req.body);

  const row = await queryOne(
    `UPDATE routes
        SET code        = COALESCE($2, code),
            name        = COALESCE($3, name),
            description = COALESCE($4, description),
            is_active   = COALESCE($5, is_active)
      WHERE id = $1
      RETURNING id, code, name, description, is_active`,
    [
      routeId,
      input.code ?? null,
      input.name ?? null,
      input.description ?? null,
      input.isActive ?? null,
    ],
  );
  if (!row) throw notFoundError('Route');

  res.json({
    route: {
      id: Number(row.id),
      code: row.code,
      name: row.name,
      description: row.description,
      isActive: row.is_active,
    },
  });
});

/**
 * Retiring a route rather than deleting it. Its trips are the historical record
 * the ETA averages are computed from, so a hard delete would silently degrade
 * every remaining prediction on shared segments.
 */
router.delete('/routes/:id', async (req, res) => {
  const routeId = idSchema.parse(req.params.id);
  const { rowCount } = await query('UPDATE routes SET is_active = FALSE WHERE id = $1', [routeId]);
  if (!rowCount) throw notFoundError('Route');
  res.status(204).end();
});

/**
 * Replaces a route's stop sequence and its schedule in one call.
 *
 * `scheduledOffsetSeconds` — minutes from the start of the trip to this stop —
 * is the timetable: FR-A3 measures delay against it, and the ETA engine falls
 * back to it on segments with no measured history yet.
 *
 * Refused while a bus is mid-route: the driver app derives the next stop from
 * the sequence, so renumbering under an active trip would send it to the wrong
 * one.
 */
router.put('/routes/:id/stops', async (req, res) => {
  const routeId = idSchema.parse(req.params.id);
  const { stops } = z
    .object({
      stops: z
        .array(
          z.object({
            stopId: idSchema,
            scheduledOffsetSeconds: z.coerce.number().int().min(0).max(86_400).default(0),
          }),
        )
        .min(2, 'A route needs at least two stops.')
        .max(200),
    })
    .parse(req.body);

  const route = await queryOne('SELECT id FROM routes WHERE id = $1', [routeId]);
  if (!route) throw notFoundError('Route');

  const unique = new Set(stops.map((stop) => stop.stopId));
  if (unique.size !== stops.length) throw conflict('A stop can appear only once on a route.');

  const active = await queryOne(
    "SELECT id FROM trips WHERE route_id = $1 AND status = 'active' LIMIT 1",
    [routeId],
  );
  if (active) throw conflict('End the active trip on this route before changing its stops.');

  const { rows: known } = await query('SELECT id FROM stops WHERE id = ANY($1::bigint[])', [
    [...unique],
  ]);
  if (known.length !== unique.size) throw notFoundError('One of those stops');

    // All-or-nothing: a half-written sequence would leave the route unusable, and
  // unlike an offline queue there is nothing here worth partially applying.
  await withTransaction(async (tx) => {
    await tx.query('DELETE FROM route_stops WHERE route_id = $1', [routeId]);
    for (const [index, stop] of stops.entries()) {
      await tx.query(
        `INSERT INTO route_stops (route_id, stop_id, seq, scheduled_offset_seconds)
         VALUES ($1, $2, $3, $4)`,
        [routeId, stop.stopId, index + 1, stop.scheduledOffsetSeconds],
      );
    }
  });

  res.json({ routeId, stopCount: stops.length });
});

/* ── Stops (FR-A1) ──────────────────────────────────────────────────────── */

const stopBody = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(120),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

router.post('/stops', async (req, res) => {
  const input = stopBody.parse(req.body);
  const row = await queryOne(
    'INSERT INTO stops (code, name, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING id',
    [input.code, input.name, input.latitude, input.longitude],
  );
  res.status(201).json({ id: Number(row.id) });
});

router.patch('/stops/:id', async (req, res) => {
  const stopId = idSchema.parse(req.params.id);
  const input = stopBody.partial().parse(req.body);

  const row = await queryOne(
    `UPDATE stops
        SET code = COALESCE($2, code), name = COALESCE($3, name),
            latitude = COALESCE($4, latitude), longitude = COALESCE($5, longitude)
      WHERE id = $1
      RETURNING id, code, name, latitude, longitude`,
    [stopId, input.code ?? null, input.name ?? null, input.latitude ?? null, input.longitude ?? null],
  );
  if (!row) throw notFoundError('Stop');

  res.json({
    stop: {
      id: Number(row.id),
      code: row.code,
      name: row.name,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    },
  });
});

/* ── Accounts and driver assignments (FR-A1, FR-S5) ─────────────────────── */

/**
 * The only way a driver or admin account comes into existence. Self-service
 * registration is hard-wired to `commuter`, so the ability to publish check-ins
 * or read this dashboard is always granted deliberately by someone who already
 * has it.
 */
const userBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8, 'Use at least 8 characters.'),
  role: z.enum(ROLES),
  phone: z.string().trim().max(20).optional(),
});

const publicUser = (row) => ({
  id: Number(row.id),
  name: row.name,
  email: row.email,
  role: row.role,
  phone: row.phone ?? null,
  isActive: row.is_active,
});

router.get('/users', async (req, res) => {
  const { role } = z.object({ role: z.enum(ROLES).optional() }).parse(req.query);
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_active,
            COALESCE(
              (SELECT json_agg(json_build_object('id', r.id, 'code', r.code) ORDER BY r.code)
                 FROM driver_assignments da
                 JOIN routes r ON r.id = da.route_id
                WHERE da.driver_id = u.id),
              '[]'::json
            ) AS routes
       FROM users u
      WHERE ($1::text IS NULL OR u.role = $1)
      ORDER BY u.role, u.name`,
    [role ?? null],
  );

  res.json({
    users: rows.map((row) => ({
      ...publicUser(row),
      routes: typeof row.routes === 'string' ? JSON.parse(row.routes) : row.routes,
    })),
  });
});

router.post('/users', async (req, res) => {
  const input = userBody.parse(req.body);

  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [input.email]);
  if (existing) throw conflict('An account with that email already exists.');

  const row = await queryOne(
    `INSERT INTO users (name, email, password_hash, role, phone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, role, phone, is_active`,
    [
      input.name,
      input.email,
      await hashPassword(input.password),
      input.role,
      input.phone ?? null,
    ],
  );

  res.status(201).json({ user: publicUser(row) });
});

router.patch('/users/:id', async (req, res) => {
  const userId = idSchema.parse(req.params.id);
  const input = z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: z.string().trim().max(20).optional(),
      role: z.enum(ROLES).optional(),
      isActive: z.boolean().optional(),
    })
    .parse(req.body);

  // Without this an admin can lock themselves — and possibly everyone — out of
  // the only surface that can grant the role back.
  if (userId === req.user.id && (input.isActive === false || (input.role && input.role !== 'admin'))) {
    throw new ApiError(400, 'You cannot remove your own admin access.');
  }

  const row = await queryOne(
    `UPDATE users
        SET name = COALESCE($2, name), phone = COALESCE($3, phone),
            role = COALESCE($4, role), is_active = COALESCE($5, is_active)
      WHERE id = $1
      RETURNING id, name, email, role, phone, is_active`,
    [userId, input.name ?? null, input.phone ?? null, input.role ?? null, input.isActive ?? null],
  );
  if (!row) throw notFoundError('User');

  res.json({ user: publicUser(row) });
});

/** Reset a driver's password after the inevitable "I forgot it" phone call. */
router.post('/users/:id/password', async (req, res) => {
  const userId = idSchema.parse(req.params.id);
  const { password } = z
    .object({ password: z.string().min(8, 'Use at least 8 characters.') })
    .parse(req.body);

  const { rowCount } = await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
    userId,
    await hashPassword(password),
  ]);
  if (!rowCount) throw notFoundError('User');
  res.status(204).end();
});

/** Which routes a driver may start a trip on (checked by POST /driver/trips). */
router.put('/users/:id/assignments', async (req, res) => {
  const userId = idSchema.parse(req.params.id);
  const { routeIds } = z.object({ routeIds: z.array(idSchema).max(50) }).parse(req.body);

  const driver = await queryOne('SELECT id, role FROM users WHERE id = $1', [userId]);
  if (!driver) throw notFoundError('User');
  if (driver.role !== 'driver') throw conflict('Only driver accounts can be assigned to routes.');

  const wanted = [...new Set(routeIds)];
  await withTransaction(async (tx) => {
    await tx.query('DELETE FROM driver_assignments WHERE driver_id = $1', [userId]);
    for (const routeId of wanted) {
      await tx.query(
        'INSERT INTO driver_assignments (driver_id, route_id) VALUES ($1, $2)',
        [userId, routeId],
      );
    }
  });

  res.json({ driverId: userId, routeIds: wanted });
});

/* ── Analytics (FR-A2, FR-A3) and pilot health (§4) ─────────────────────── */

/** Stop-wise and time-band demand — where and when people actually board. */
router.get('/analytics/demand', async (req, res) => {
  const input = windowSchema.parse(req.query);
  res.json(await getDemandAnalytics(input));
});

/** Route punctuality and the segments that chronically lose time. */
router.get('/analytics/punctuality', async (req, res) => {
  const input = windowSchema
    .extend({ toleranceSeconds: z.coerce.number().int().min(0).max(3600).optional() })
    .parse(req.query);
  res.json(await getPunctualityAnalytics(input));
});

/**
 * The pilot scorecard: check-in coverage, update freshness, ETA accuracy and
 * adoption — the four numbers §4 says the project is judged on.
 */
router.get('/analytics/operations', async (req, res) => {
  const input = windowSchema.parse(req.query);
  res.json(await getOperationsSummary(input));
});

/** Every bus currently running, for the network map (FR-A4). */
router.get('/live/network', async (_req, res) => {
  res.json(await getNetworkLive());
});

/* ── Triage of commuter reports (FR-A5) ─────────────────────────────────── */

router.get('/issues', async (req, res) => {
  const input = z
    .object({
      status: z.enum(ISSUE_STATUSES).optional(),
      kind: z.enum(ISSUE_KINDS.map((entry) => entry.value)).optional(),
      routeId: idSchema.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    })
    .parse(req.query);

  const { rows } = await query(
    `SELECT i.id, i.kind, i.note, i.status, i.created_at, i.trip_id,
            u.name AS reporter_name, u.email AS reporter_email,
            r.id AS route_id, r.code AS route_code, s.id AS stop_id, s.name AS stop_name
       FROM issue_reports i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN routes r ON r.id = i.route_id
       LEFT JOIN stops  s ON s.id = i.stop_id
      WHERE ($1::text IS NULL OR i.status = $1)
        AND ($2::text IS NULL OR i.kind   = $2)
        AND ($3::int  IS NULL OR i.route_id = $3::int)
      ORDER BY (i.status = 'open') DESC, i.created_at DESC
      LIMIT $4`,
    [input.status ?? null, input.kind ?? null, input.routeId ?? null, input.limit],
  );

  res.json({
    issues: rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      kindLabel: ISSUE_KINDS.find((entry) => entry.value === row.kind)?.label ?? row.kind,
      note: row.note,
      status: row.status,
      createdAt: row.created_at,
      tripId: row.trip_id ? Number(row.trip_id) : null,
      routeId: row.route_id ? Number(row.route_id) : null,
      routeCode: row.route_code ?? null,
      stopId: row.stop_id ? Number(row.stop_id) : null,
      stopName: row.stop_name ?? null,
      reporterName: row.reporter_name,
      reporterEmail: row.reporter_email,
    })),
  });
});

router.patch('/issues/:id', async (req, res) => {
  const issueId = idSchema.parse(req.params.id);
  const { status } = z.object({ status: z.enum(ISSUE_STATUSES) }).parse(req.body);

  const row = await queryOne(
    'UPDATE issue_reports SET status = $2 WHERE id = $1 RETURNING id, status',
    [issueId, status],
  );
  if (!row) throw notFoundError('Issue');
  res.json({ issue: { id: Number(row.id), status: row.status } });
});

/* ── CSV export (FR-A6) ─────────────────────────────────────────────────── */

/**
 * A fixed registry of reports rather than an arbitrary query surface: the column
 * list is chosen here, so no request value ever reaches the SQL or the header.
 */
const EXPORTS = {
  'demand-by-stop': {
    columns: [
      { key: 'stopCode', label: 'Stop code' },
      { key: 'stopName', label: 'Stop' },
      { key: 'bandLabel', label: 'Time band' },
      { key: 'dayType', label: 'Day type' },
      { key: 'checkins', label: 'Check-ins' },
      { key: 'avgLoadFactor', label: 'Avg load factor' },
      { key: 'crowdedCheckins', label: 'Crowded check-ins' },
      { key: 'crowdedShare', label: 'Crowded share' },
    ],
    load: async (input) => (await getDemandAnalytics(input)).byStop,
  },
  'demand-by-band': {
    columns: [
      { key: 'bandLabel', label: 'Time band' },
      { key: 'dayType', label: 'Day type' },
      { key: 'checkins', label: 'Check-ins' },
      { key: 'avgLoadFactor', label: 'Avg load factor' },
      { key: 'crowdedCheckins', label: 'Crowded check-ins' },
    ],
    load: async (input) => (await getDemandAnalytics(input)).byBand,
  },
  'punctuality-by-route': {
    columns: [
      { key: 'routeCode', label: 'Route' },
      { key: 'routeName', label: 'Name' },
      { key: 'samples', label: 'Observations' },
      { key: 'avgDelaySeconds', label: 'Avg delay (s)' },
      { key: 'medianDelaySeconds', label: 'Median delay (s)' },
      { key: 'worstDelaySeconds', label: 'Worst delay (s)' },
      { key: 'onTimeShare', label: 'On-time share' },
    ],
    load: async (input) => (await getPunctualityAnalytics(input)).byRoute,
  },
  'punctuality-by-segment': {
    columns: [
      { key: 'routeCode', label: 'Route' },
      { key: 'seq', label: 'Seq' },
      { key: 'stopCode', label: 'Stop code' },
      { key: 'stopName', label: 'Stop' },
      { key: 'samples', label: 'Observations' },
      { key: 'avgDelaySeconds', label: 'Avg delay (s)' },
      { key: 'medianDelaySeconds', label: 'Median delay (s)' },
      { key: 'onTimeShare', label: 'On-time share' },
    ],
    load: async (input) => (await getPunctualityAnalytics(input)).bySegment,
  },
};

router.get('/export/:dataset', async (req, res) => {
  const { dataset } = z
    .object({ dataset: z.enum(Object.keys(EXPORTS)) })
    .parse(req.params);
  const input = windowSchema.parse(req.query);

  const report = EXPORTS[dataset];
  const rows = await report.load(input);
  const csv = toCsv(report.columns, rows);

  const stamp = new Date().toISOString().slice(0, 10);
  res.type('text/csv; charset=utf-8');
  res.set('content-disposition', `attachment; filename="sptos-${dataset}-${stamp}.csv"`);
  res.send(csv);
});

/** Lets the dashboard render its export menu from the same registry. */
router.get('/exports', (_req, res) => {
  res.json({
    datasets: Object.entries(EXPORTS).map(([key, report]) => ({
      key,
      columns: report.columns.map((column) => column.label),
    })),
  });
});

export default router;
