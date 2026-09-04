/** Route and stop discovery (PRD FR-C1) plus client bootstrap metadata. */
import { Router } from 'express';
import { z } from 'zod';
import {
  ISSUE_KINDS,
  OCCUPANCY_LEVELS,
  TIME_BANDS,
} from '@sptos/shared';
import config from '../config.js';
import { query, queryOne } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { notFoundError } from '../middleware/errors.js';

const router = Router();

const idSchema = z.coerce.number().int().positive();
const searchSchema = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Escapes LIKE wildcards so a typed % behaves as a literal character. */
const likeTerm = (term) => `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/**
 * Values the clients would otherwise hard-code. Serving them keeps the driver
 * app's occupancy buttons, the dashboard's bands and the commuter app's
 * staleness cutoff in step with the server.
 */
router.get('/meta', (_req, res) => {
  res.json({
    occupancyLevels: OCCUPANCY_LEVELS,
    timeBands: TIME_BANDS,
    issueKinds: ISSUE_KINDS,
    staleAfterSeconds: config.staleAfterSeconds,
    arrivalAlertMinutes: config.arrivalAlertMinutes,
    minCheckinsForEta: config.minCheckinsForEta,
  });
});

router.get('/routes', async (req, res) => {
  const { q, limit } = searchSchema.parse(req.query);
  const { rows } = await query(
    `SELECT r.id, r.code, r.name, r.description, r.is_active,
            (SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = r.id)::int AS stop_count,
            (SELECT COUNT(*) FROM trips t
              WHERE t.route_id = r.id AND t.status = 'active')::int              AS active_trips
       FROM routes r
      WHERE r.is_active = TRUE
        AND ($1::text IS NULL OR r.name ILIKE $1 OR r.code ILIKE $1)
      ORDER BY r.code
      LIMIT $2`,
    [q ? likeTerm(q) : null, limit],
  );

  res.json({
    routes: rows.map((row) => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      description: row.description,
      stopCount: Number(row.stop_count),
      activeTrips: Number(row.active_trips),
    })),
  });
});
router.get('/routes/:id', async (req, res) => {
  const routeId = idSchema.parse(req.params.id);
  const route = await queryOne(
    'SELECT id, code, name, description, is_active FROM routes WHERE id = $1',
    [routeId],
  );
  if (!route) throw notFoundError('Route');

  const { rows } = await query(
    `SELECT rs.seq, rs.scheduled_offset_seconds, s.id, s.code, s.name, s.latitude, s.longitude
       FROM route_stops rs
       JOIN stops s ON s.id = rs.stop_id
      WHERE rs.route_id = $1
      ORDER BY rs.seq`,
    [routeId],
  );

  res.json({
    route: {
      id: Number(route.id),
      code: route.code,
      name: route.name,
      description: route.description,
      isActive: route.is_active,
    },
    stops: rows.map((row) => ({
      seq: Number(row.seq),
      stopId: Number(row.id),
      code: row.code,
      name: row.name,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      scheduledOffsetSeconds: Number(row.scheduled_offset_seconds),
    })),
  });
});

router.get('/stops', async (req, res) => {
  const { q, limit } = searchSchema.parse(req.query);
  const { rows } = await query(
    `SELECT s.id, s.code, s.name, s.latitude, s.longitude,
            COALESCE(
              (SELECT json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name)
                               ORDER BY r.code)
                 FROM route_stops rs
                 JOIN routes r ON r.id = rs.route_id AND r.is_active = TRUE
                WHERE rs.stop_id = s.id),
              '[]'::json
            ) AS routes
       FROM stops s
      WHERE ($1::text IS NULL OR s.name ILIKE $1 OR s.code ILIKE $1)
      ORDER BY s.name
      LIMIT $2`,
    [q ? likeTerm(q) : null, limit],
  );

  res.json({
    stops: rows.map((row) => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      routes: typeof row.routes === 'string' ? JSON.parse(row.routes) : row.routes,
    })),
  });
});
/** Saved routes and stops for one-tap access (FR-C8). */
router.get('/favourites', authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT f.id, f.route_id, f.stop_id, r.code AS route_code, r.name AS route_name,
            s.name AS stop_name, s.code AS stop_code
       FROM favourites f
       JOIN routes r ON r.id = f.route_id
       JOIN stops  s ON s.id = f.stop_id
      WHERE f.user_id = $1
      ORDER BY r.code, s.name`,
    [req.user.id],
  );

  res.json({
    favourites: rows.map((row) => ({
      id: Number(row.id),
      routeId: Number(row.route_id),
      routeCode: row.route_code,
      routeName: row.route_name,
      stopId: Number(row.stop_id),
      stopCode: row.stop_code,
      stopName: row.stop_name,
    })),
  });
});

router.post('/favourites', authenticate, async (req, res) => {
  const input = z.object({ routeId: idSchema, stopId: idSchema }).parse(req.body);

  const served = await queryOne(
    'SELECT 1 FROM route_stops WHERE route_id = $1 AND stop_id = $2',
    [input.routeId, input.stopId],
  );
  if (!served) throw notFoundError('That stop on that route');

  const row = await queryOne(
    `INSERT INTO favourites (user_id, route_id, stop_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, route_id, stop_id) DO UPDATE SET route_id = EXCLUDED.route_id
     RETURNING id`,
    [req.user.id, input.routeId, input.stopId],
  );

  res.status(201).json({ id: Number(row.id) });
});

router.delete('/favourites/:id', authenticate, async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const { rowCount } = await query('DELETE FROM favourites WHERE id = $1 AND user_id = $2', [
    id,
    req.user.id,
  ]);
  if (!rowCount) throw notFoundError('Favourite');
  res.status(204).end();
});

export default router;
