/**
 * ETA prediction logging (PRD §4 success metric "ETA accuracy").
 *
 * An accuracy figure cannot be reconstructed after the fact, so each broadcast
 * ETA is written down when it is issued and reconciled when the bus actually
 * reports at that stop.
 */
import { query } from '../db/index.js';

/**
 * How many stops ahead to log. Beyond a handful of stops an estimate is a rough
 * indication rather than a promise, and logging every horizon on every check-in
 * grows quadratically with route length.
 */
const HORIZON_STOPS = 6;

export async function recordPredictions({ tripId, routeId, etas, predictedAt = new Date() }) {
  const horizon = etas.slice(0, HORIZON_STOPS);
  if (horizon.length === 0) return 0;

  const issuedAt = new Date(predictedAt).toISOString();
  const values = [];
  const params = [];

  const COLUMNS_PER_ROW = 9;

  horizon.forEach((eta, index) => {
    const base = index * COLUMNS_PER_ROW;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::timestamptz, ` +
        `$${base + 6}::timestamptz, $${base + 7}, $${base + 8}, $${base + 9})`,
    );
    params.push(
      tripId,
      routeId,
      eta.stopId,
      eta.seq,
      issuedAt,
      eta.etaAt,
      Math.max(0, Math.round((new Date(eta.etaAt) - new Date(issuedAt)) / 1000)),
      eta.confidence,
      eta.basedOnSamples ?? 0,
    );
  });

  await query(
    `INSERT INTO eta_predictions
       (trip_id, route_id, stop_id, seq, predicted_at, predicted_eta_at,
        horizon_seconds, confidence, based_on_samples)
     VALUES ${values.join(', ')}
     ON CONFLICT (trip_id, stop_id, predicted_at) DO NOTHING`,
    params,
  );

  return horizon.length;
}

/** Closes out every outstanding prediction for a stop the bus has now reached. */
export async function resolvePredictions({ tripId, stopId, actualArrivalAt }) {
  const { rowCount } = await query(
    `UPDATE eta_predictions
        SET actual_arrival_at = $3::timestamptz,
            resolved_at       = now(),
            error_seconds     = EXTRACT(EPOCH FROM ($3::timestamptz - predicted_eta_at))::int
      WHERE trip_id = $1
        AND stop_id = $2
        AND actual_arrival_at IS NULL`,
    [tripId, stopId, new Date(actualArrivalAt).toISOString()],
  );
  return rowCount ?? 0;
}
