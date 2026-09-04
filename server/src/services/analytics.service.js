/**
 * Planning analytics (PRD FR-A2, FR-A3, FR-A6 and the §4 success metrics).
 *
 * Every figure here is derived from ordinary check-in history — no separate
 * warehouse, no scheduled aggregation job. That keeps the pilot honest: if
 * drivers stop checking in, the numbers visibly thin out rather than silently
 * going stale.
 */
import { OCCUPANCY_LEVELS, TIME_BANDS, bandForHour } from '@sptos/shared';
import { query } from '../db/index.js';

/** Buses at "standing only" or worse are treated as capacity pressure. */
const CROWDED = ['standing_only', 'full'];

/**
 * SQL CASE mapping occupancy buckets to load factors.
 *
 * Built from the shared constant so the dashboard and the ETA engine cannot
 * drift apart. The values are validated before interpolation: they come from our
 * own module, never from a request.
 */
function loadFactorSql(column) {
  const clauses = OCCUPANCY_LEVELS.map((level) => {
    if (!/^[a-z_]+$/.test(level.value) || !Number.isFinite(level.loadFactor)) {
      throw new Error(`Unsafe occupancy constant: ${JSON.stringify(level)}`);
    }
    return `WHEN '${level.value}' THEN ${level.loadFactor}`;
  }).join(' ');
  return `CASE ${column} ${clauses} ELSE NULL END`;
}

/** SQL CASE mapping an hour expression to a named time band. */
function timeBandSql(hourExpr) {
  const clauses = TIME_BANDS.map((band) => {
    if (!/^[a-z_]+$/.test(band.key)) throw new Error(`Unsafe time band key: ${band.key}`);
    const wraps = band.endHour <= band.startHour;
    const condition = wraps
      ? `(${hourExpr} >= ${band.startHour} OR ${hourExpr} < ${band.endHour})`
      : `(${hourExpr} >= ${band.startHour} AND ${hourExpr} < ${band.endHour})`;
    return `WHEN ${condition} THEN '${band.key}'`;
  }).join(' ');
  return `CASE ${clauses} ELSE '${TIME_BANDS.at(-1).key}' END`;
}

const DAY_TYPE_SQL = (column) =>
  `CASE WHEN EXTRACT(DOW FROM ${column}) IN (0, 6) THEN 'weekend' ELSE 'weekday' END`;

/** Normalises the window every report accepts; defaults to the last 30 days. */
export function resolveWindow({ from, to } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 3600 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}
/**
 * Stop-wise, time-band demand (FR-A2).
 *
 * @returns {{window, byStop: Array, byBand: Array, totals: object}}
 */
export async function getDemandAnalytics({ routeId = null, from, to } = {}) {
  const window = resolveWindow({ from, to });
  const params = [routeId, window.from, window.to];

  const eventsCte = `
    WITH events AS (
      SELECT c.stop_id,
             t.route_id,
             c.occupancy,
             ${loadFactorSql('c.occupancy')}                       AS load_factor,
             ${timeBandSql('EXTRACT(HOUR FROM c.recorded_at)')}     AS band,
             ${DAY_TYPE_SQL('c.recorded_at')}                       AS day_type
        FROM checkins c
        JOIN trips t ON t.id = c.trip_id
       WHERE c.voided_at IS NULL
         AND t.status <> 'cancelled'
         AND ($1::int IS NULL OR t.route_id = $1::int)
         AND c.recorded_at >= $2::timestamptz
         AND c.recorded_at <  $3::timestamptz
    )
  `;

  const crowdedSql = `SUM(CASE WHEN occupancy IN (${CROWDED.map((c) => `'${c}'`).join(', ')})
                                THEN 1 ELSE 0 END)::int`;

  const [byStop, byBand, totals] = await Promise.all([
    query(
      `${eventsCte}
       SELECT s.id AS stop_id, s.code, s.name,
              e.band, e.day_type,
              COUNT(*)::int                 AS checkins,
              AVG(e.load_factor)::float     AS avg_load_factor,
              ${crowdedSql}                 AS crowded_checkins
         FROM events e
         JOIN stops s ON s.id = e.stop_id
        GROUP BY s.id, s.code, s.name, e.band, e.day_type
        ORDER BY checkins DESC, s.name`,
      params,
    ),
    query(
      `${eventsCte}
       SELECT e.band, e.day_type,
              COUNT(*)::int             AS checkins,
              AVG(e.load_factor)::float AS avg_load_factor,
              ${crowdedSql}             AS crowded_checkins
         FROM events e
        GROUP BY e.band, e.day_type`,
      params,
    ),
    query(
      `${eventsCte}
       SELECT COUNT(*)::int                        AS checkins,
              COUNT(DISTINCT e.stop_id)::int       AS stops_reporting,
              AVG(e.load_factor)::float            AS avg_load_factor,
              ${crowdedSql}                        AS crowded_checkins
         FROM events e`,
      params,
    ),
  ]);
  const shapeStop = (row) => ({
    stopId: Number(row.stop_id),
    stopCode: row.code,
    stopName: row.name,
    band: row.band,
    bandLabel: TIME_BANDS.find((b) => b.key === row.band)?.label ?? row.band,
    dayType: row.day_type,
    checkins: Number(row.checkins),
    avgLoadFactor: row.avg_load_factor === null ? null : Number(row.avg_load_factor),
    crowdedCheckins: Number(row.crowded_checkins),
    crowdedShare: Number(row.checkins) ? Number(row.crowded_checkins) / Number(row.checkins) : 0,
  });

  const summary = totals.rows[0] ?? {};

  return {
    window,
    routeId,
    byStop: byStop.rows.map(shapeStop),
    byBand: byBand.rows.map((row) => ({
      band: row.band,
      bandLabel: TIME_BANDS.find((b) => b.key === row.band)?.label ?? row.band,
      dayType: row.day_type,
      checkins: Number(row.checkins),
      avgLoadFactor: row.avg_load_factor === null ? null : Number(row.avg_load_factor),
      crowdedCheckins: Number(row.crowded_checkins),
    })),
    totals: {
      checkins: Number(summary.checkins ?? 0),
      stopsReporting: Number(summary.stops_reporting ?? 0),
      avgLoadFactor: summary.avg_load_factor === null || summary.avg_load_factor === undefined
        ? null
        : Number(summary.avg_load_factor),
      crowdedCheckins: Number(summary.crowded_checkins ?? 0),
    },
  };
}
/**
 * Route punctuality and chronically delayed segments (FR-A3).
 *
 * Delay is the check-in time relative to the trip's own start, compared with the
 * planned offset for that stop. Measuring from the trip start rather than from a
 * timetable means a bus that departs late is not penalised twice, so what the
 * numbers isolate is where time is *lost along the route*.
 */
export async function getPunctualityAnalytics({
  routeId = null,
  from,
  to,
  toleranceSeconds = 300,
} = {}) {
  const window = resolveWindow({ from, to });
  const params = [routeId, window.from, window.to, toleranceSeconds];

  const obsCte = `
    WITH obs AS (
      SELECT t.route_id,
             t.id      AS trip_id,
             c.stop_id,
             rs.seq,
             EXTRACT(EPOCH FROM (c.recorded_at - t.started_at))::int
               - rs.scheduled_offset_seconds AS delay_seconds
        FROM checkins c
        JOIN trips t       ON t.id = c.trip_id
        JOIN route_stops rs ON rs.route_id = t.route_id AND rs.stop_id = c.stop_id
       WHERE c.voided_at IS NULL
         AND t.status <> 'cancelled'
         -- The first stop's offset is 0 by definition, so it carries no signal.
         AND rs.scheduled_offset_seconds > 0
         AND ($1::int IS NULL OR t.route_id = $1::int)
         AND c.recorded_at >= $2::timestamptz
         AND c.recorded_at <  $3::timestamptz
    )
  `;

  const stats = `
    COUNT(*)::int                                                        AS samples,
    AVG(delay_seconds)::float                                            AS avg_delay_seconds,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delay_seconds)::float    AS median_delay_seconds,
    MAX(delay_seconds)::int                                              AS worst_delay_seconds,
    SUM(CASE WHEN ABS(delay_seconds) <= $4::int THEN 1 ELSE 0 END)::int  AS on_time_samples
  `;

  const [byRoute, byStop] = await Promise.all([
    query(
      `${obsCte}
       SELECT r.id AS route_id, r.code, r.name, ${stats}
         FROM obs JOIN routes r ON r.id = obs.route_id
        GROUP BY r.id, r.code, r.name
        ORDER BY avg_delay_seconds DESC NULLS LAST`,
      params,
    ),
    query(
      `${obsCte}
       SELECT r.id AS route_id, r.code AS route_code,
              s.id AS stop_id, s.code AS stop_code, s.name AS stop_name,
              obs.seq, ${stats}
         FROM obs
         JOIN stops  s ON s.id = obs.stop_id
         JOIN routes r ON r.id = obs.route_id
        GROUP BY r.id, r.code, s.id, s.code, s.name, obs.seq
        ORDER BY avg_delay_seconds DESC NULLS LAST`,
      params,
    ),
  ]);
  const shape = (row) => {
    const samples = Number(row.samples);
    return {
      samples,
      avgDelaySeconds: row.avg_delay_seconds === null ? null : Math.round(Number(row.avg_delay_seconds)),
      medianDelaySeconds:
        row.median_delay_seconds === null ? null : Math.round(Number(row.median_delay_seconds)),
      worstDelaySeconds: row.worst_delay_seconds === null ? null : Number(row.worst_delay_seconds),
      onTimeSamples: Number(row.on_time_samples),
      onTimeShare: samples ? Number(row.on_time_samples) / samples : null,
    };
  };

  return {
    window,
    routeId,
    toleranceSeconds,
    byRoute: byRoute.rows.map((row) => ({
      routeId: Number(row.route_id),
      routeCode: row.code,
      routeName: row.name,
      ...shape(row),
    })),
    bySegment: byStop.rows.map((row) => ({
      routeId: Number(row.route_id),
      routeCode: row.route_code,
      stopId: Number(row.stop_id),
      stopCode: row.stop_code,
      stopName: row.stop_name,
      seq: Number(row.seq),
      ...shape(row),
    })),
  };
}
/**
 * Pilot health against the PRD §4 success metrics: check-in coverage, update
 * freshness, ETA accuracy and adoption.
 */
export async function getOperationsSummary({ routeId = null, from, to } = {}) {
  const window = resolveWindow({ from, to });
  const params = [routeId, window.from, window.to];

  const [coverage, statuses, accuracy, gaps, adoption] = await Promise.all([
    query(
      `WITH per_trip AS (
         SELECT t.id,
                (SELECT COUNT(DISTINCT c.stop_id) FROM checkins c
                  WHERE c.trip_id = t.id AND c.voided_at IS NULL)::int AS reported,
                (SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = t.route_id)::int AS total
           FROM trips t
          WHERE t.status <> 'cancelled'
            AND ($1::int IS NULL OR t.route_id = $1::int)
            AND t.started_at >= $2::timestamptz AND t.started_at < $3::timestamptz
       )
       SELECT COUNT(*)::int AS trips,
              AVG(CASE WHEN total > 0 THEN reported::float / total END)::float AS avg_coverage
         FROM per_trip`,
      params,
    ),
    query(
      `SELECT status, COUNT(*)::int AS count
         FROM trips
        WHERE ($1::int IS NULL OR route_id = $1::int)
          AND started_at >= $2::timestamptz AND started_at < $3::timestamptz
        GROUP BY status`,
      params,
    ),
    query(
      `SELECT COUNT(*)::int                                                       AS resolved,
              AVG(ABS(error_seconds))::float                                      AS mae_seconds,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(error_seconds))::float
                                                                                  AS median_abs_error_seconds,
              AVG(error_seconds)::float                                           AS bias_seconds
         FROM eta_predictions
        WHERE actual_arrival_at IS NOT NULL
          AND ($1::int IS NULL OR route_id = $1::int)
          AND resolved_at >= $2::timestamptz AND resolved_at < $3::timestamptz`,
      params,
    ),
    query(
      `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY travel_seconds)::float AS median_gap_seconds
         FROM segment_travel_samples
        WHERE ($1::int IS NULL OR route_id = $1::int)
          AND departed_at >= $2::timestamptz AND departed_at < $3::timestamptz`,
      params,
    ),
    query(
      `SELECT (SELECT COUNT(DISTINCT driver_id) FROM trips
                WHERE started_at >= $2::timestamptz AND started_at < $3::timestamptz
                  AND ($1::int IS NULL OR route_id = $1::int))::int      AS active_drivers,
              (SELECT COUNT(*) FROM users WHERE role = 'commuter')::int    AS commuters,
              (SELECT COUNT(*) FROM users WHERE role = 'driver')::int      AS drivers,
              (SELECT COUNT(*) FROM routes WHERE is_active)::int           AS active_routes,
              (SELECT COUNT(*) FROM stops)::int                            AS stops,
              (SELECT COUNT(*) FROM issue_reports WHERE status = 'open')::int AS open_issues`,
      params,
    ),
  ]);
  const cov = coverage.rows[0] ?? {};
  const acc = accuracy.rows[0] ?? {};
  const ado = adoption.rows[0] ?? {};
  const tripsByStatus = Object.fromEntries(statuses.rows.map((r) => [r.status, Number(r.count)]));
  const asFloat = (value) => (value === null || value === undefined ? null : Number(value));

  return {
    window,
    routeId,
    trips: {
      total: Object.values(tripsByStatus).reduce((sum, n) => sum + n, 0),
      active: tripsByStatus.active ?? 0,
      completed: tripsByStatus.completed ?? 0,
      cancelled: tripsByStatus.cancelled ?? 0,
    },
    // §4 "Check-in coverage": share of a trip's stops that received a check-in.
    checkinCoverage: {
      tripsMeasured: Number(cov.trips ?? 0),
      averageShare: asFloat(cov.avg_coverage),
    },
    // §4 "ETA accuracy": mean absolute error of predictions that have resolved.
    etaAccuracy: {
      resolvedPredictions: Number(acc.resolved ?? 0),
      maeSeconds: asFloat(acc.mae_seconds),
      medianAbsErrorSeconds: asFloat(acc.median_abs_error_seconds),
      // Positive bias = the bus arrives later than promised.
      biasSeconds: asFloat(acc.bias_seconds),
    },
    // §4 "Update freshness": typical interval between consecutive check-ins,
    // which is the ceiling on how old a live status can be mid-trip.
    updateFreshness: {
      medianGapSeconds: asFloat(gaps.rows[0]?.median_gap_seconds),
    },
    adoption: {
      activeDrivers: Number(ado.active_drivers ?? 0),
      registeredDrivers: Number(ado.drivers ?? 0),
      registeredCommuters: Number(ado.commuters ?? 0),
      activeRoutes: Number(ado.active_routes ?? 0),
      stops: Number(ado.stops ?? 0),
      openIssues: Number(ado.open_issues ?? 0),
    },
  };
}

/**
 * Serialises report rows to CSV (FR-A6).
 *
 * Leading =, +, - and @ are escaped: a spreadsheet would otherwise treat a stop
 * name beginning with one of them as a formula.
 */
export function toCsv(columns, rows) {
  const cell = (value) => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  const header = columns.map((column) => cell(column.label ?? column.key)).join(',');
  const body = rows.map((row) => columns.map((column) => cell(row[column.key])).join(','));
  return [header, ...body].join('\r\n');
}

export { bandForHour };






