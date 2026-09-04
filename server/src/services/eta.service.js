/**
 * ETA engine (PRD FR-S1, FR-C3).
 *
 * There is no GPS ground truth, so an ETA is built from two things: where the
 * bus was last reported (a driver check-in), and how long this route's
 * stop-to-stop legs have historically taken in this time band. Summing the leg
 * estimates from the last check-in to the stop the commuter cares about gives
 * the arrival time.
 *
 * Each leg estimate falls back through four sources, best first:
 *
 *   1. `measured`  — average of past legs matching route + leg + day type + hour
 *   2. `measured_daytype` — same, relaxed to day type only (any hour)
 *   3. `scheduled` — the difference of the planned offsets in route_stops
 *   4. `fallback`  — a flat configured guess
 *
 * The resolver below is a pure function of already-loaded aggregates, which is
 * what makes this testable without a database.
 */
import config from '../config.js';
import { dayType } from '@sptos/shared';
import { query } from '../db/index.js';

/** Relative width of the ETA range when a leg has no measured spread. */
const DEFAULT_SPREAD_RATIO = 0.25;

const key = (fromSeq, type, hour) => `${fromSeq}|${type}|${hour}`;
const dayKey = (fromSeq, type) => `${fromSeq}|${type}`;

/**
 * Builds the per-leg estimator.
 *
 * @param {object} profile
 * @param {Map<string, {samples:number, avgSeconds:number, stddevSeconds:number}>} profile.hourly
 * @param {Map<string, {samples:number, avgSeconds:number, stddevSeconds:number}>} profile.daily
 * @param {Map<number, number>} profile.scheduledOffsets  seq -> planned seconds from trip start
 */
export function makeSegmentResolver(profile, options = {}) {
  const minSamples = options.minSamples ?? config.etaMinSamples;
  const fallbackSeconds = options.fallbackSeconds ?? config.etaFallbackSegmentSeconds;
  const { hourly, daily, scheduledOffsets } = profile;

  return function resolveSegment(fromSeq, type, hour) {
    const hourlyStat = hourly.get(key(fromSeq, type, hour));
    if (hourlyStat && hourlyStat.samples >= minSamples) {
      return {
        seconds: hourlyStat.avgSeconds,
        source: 'measured',
        samples: hourlyStat.samples,
        spread: hourlyStat.stddevSeconds || hourlyStat.avgSeconds * DEFAULT_SPREAD_RATIO,
      };
    }
    const dailyStat = daily.get(dayKey(fromSeq, type));
    if (dailyStat && dailyStat.samples >= minSamples) {
      return {
        seconds: dailyStat.avgSeconds,
        source: 'measured_daytype',
        samples: dailyStat.samples,
        spread: dailyStat.stddevSeconds || dailyStat.avgSeconds * DEFAULT_SPREAD_RATIO,
      };
    }

    const from = scheduledOffsets.get(fromSeq);
    const to = scheduledOffsets.get(fromSeq + 1);
    if (from !== undefined && to !== undefined && to > from) {
      const seconds = to - from;
      return {
        seconds,
        source: 'scheduled',
        samples: 0,
        spread: seconds * DEFAULT_SPREAD_RATIO,
      };
    }

    return {
      seconds: fallbackSeconds,
      source: 'fallback',
      samples: 0,
      spread: fallbackSeconds * DEFAULT_SPREAD_RATIO,
    };
  };
}
const CONFIDENCE_BY_SOURCE = { measured: 'high', measured_daytype: 'medium' };

function confidenceFrom(sources) {
  if (sources.size === 0) return 'high';
  const tiers = [...sources].map((source) => CONFIDENCE_BY_SOURCE[source] ?? 'low');
  if (tiers.every((tier) => tier === 'high')) return 'high';
  if (tiers.every((tier) => tier === 'low')) return 'low';
  return 'medium';
}

/**
 * Projects arrival at every stop downstream of `fromSeq`.
 *
 * Legs are walked in order and each one is priced using the *projected* clock
 * at which the bus is expected to start it, so a trip crossing into the evening
 * peak picks up the slower evening averages.
 *
 * @param {object}   input
 * @param {Function} input.resolveSegment  from makeSegmentResolver()
 * @param {number}   input.fromSeq         seq of the last stop the bus left
 * @param {string|Date} input.departedAt   when it left that stop
 * @param {Array<{seq:number, stopId:number, name?:string}>} input.stops  route stops, seq ascending
 * @param {number}   [input.now]
 * @returns {Array<object>} one estimate per downstream stop
 */
export function estimateArrivals({ resolveSegment, fromSeq, departedAt, stops, now = Date.now() }) {
  const nowMs = new Date(now).getTime();
  let cursorMs = new Date(departedAt).getTime();
  let variance = 0;
  const sources = new Set();
  const estimates = [];

  const downstream = stops.filter((stop) => stop.seq > fromSeq).sort((a, b) => a.seq - b.seq);

  for (const stop of downstream) {
    const legStart = new Date(cursorMs);
    const leg = resolveSegment(stop.seq - 1, dayType(legStart), legStart.getHours());

    cursorMs += leg.seconds * 1000;
    variance += leg.spread ** 2;
    sources.add(leg.source);

    const spreadMs = Math.sqrt(variance) * 1000;
    const toMinutes = (ms) => Math.max(0, Math.round((ms - nowMs) / 60000));

    estimates.push({
      seq: stop.seq,
      stopId: stop.stopId,
      stopName: stop.name,
      etaAt: new Date(cursorMs).toISOString(),
      etaMinutes: toMinutes(cursorMs),
      rangeLowMinutes: toMinutes(cursorMs - spreadMs),
      rangeHighMinutes: toMinutes(cursorMs + spreadMs),
      overdueSeconds: cursorMs < nowMs ? Math.round((nowMs - cursorMs) / 1000) : 0,
      confidence: confidenceFrom(sources),
      basedOnSamples: leg.samples,
      // Always true — the UI must label this an estimate (NFR: Transparency).
      isEstimate: true,
    });
  }

  return estimates;
}
/** Loads the historical aggregates the resolver needs for one route. */
export async function loadRouteSegmentProfile(routeId) {
  const [hourlyRows, dailyRows, scheduleRows] = await Promise.all([
    query(
      `SELECT from_seq,
              day_type,
              hour_of_day,
              COUNT(*)::int                              AS samples,
              AVG(travel_seconds)::float                 AS avg_seconds,
              COALESCE(STDDEV_SAMP(travel_seconds), 0)::float AS stddev_seconds
         FROM segment_travel_samples
        WHERE route_id = $1
        GROUP BY from_seq, day_type, hour_of_day`,
      [routeId],
    ),
    query(
      `SELECT from_seq,
              day_type,
              COUNT(*)::int                              AS samples,
              AVG(travel_seconds)::float                 AS avg_seconds,
              COALESCE(STDDEV_SAMP(travel_seconds), 0)::float AS stddev_seconds
         FROM segment_travel_samples
        WHERE route_id = $1
        GROUP BY from_seq, day_type`,
      [routeId],
    ),
    query(
      `SELECT seq, scheduled_offset_seconds
         FROM route_stops
        WHERE route_id = $1
        ORDER BY seq`,
      [routeId],
    ),
  ]);

  const stat = (row) => ({
    samples: Number(row.samples),
    avgSeconds: Number(row.avg_seconds),
    stddevSeconds: Number(row.stddev_seconds),
  });

  return {
    hourly: new Map(
      hourlyRows.rows.map((row) => [key(Number(row.from_seq), row.day_type, Number(row.hour_of_day)), stat(row)]),
    ),
    daily: new Map(dailyRows.rows.map((row) => [dayKey(Number(row.from_seq), row.day_type), stat(row)])),
    scheduledOffsets: new Map(
      scheduleRows.rows.map((row) => [Number(row.seq), Number(row.scheduled_offset_seconds)]),
    ),
  };
}

/** Convenience: profile + resolver for a route in one call. */
export async function getRouteResolver(routeId) {
  return makeSegmentResolver(await loadRouteSegmentProfile(routeId));
}



