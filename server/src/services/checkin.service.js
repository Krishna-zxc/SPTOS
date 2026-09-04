/**
 * What happens after a driver check-in lands (PRD 6.4 "Driver check-in").
 *
 * One check-in has four consequences, and they are ordered deliberately:
 *
 *   1. outstanding ETA predictions for the stop just reached are reconciled,
 *      before the new state overwrites what was predicted;
 *   2. the live route state is rebuilt once and reused by everything below;
 *   3. fresh predictions are logged for the stops still ahead;
 *   4. subscribers are pushed the update and any due arrival alerts fire.
 *
 * Side effects are best-effort: a failure to broadcast must not roll back a
 * check-in the driver has already been told was saved.
 */
import { getRouteLive } from './live.service.js';
import { recordPredictions, resolvePredictions } from './predictions.service.js';
import { broadcastRouteUpdate } from './realtime.js';
import { processArrivalAlerts } from './notifications.service.js';

export async function applyCheckinEffects({ tripId, routeId, reachedStopIds = [], recordedAt }) {
  const result = { live: null, predictionsLogged: 0, alertsSent: 0, errors: [] };

  for (const stopId of reachedStopIds) {
    try {
      await resolvePredictions({ tripId, stopId, actualArrivalAt: recordedAt });
    } catch (err) {
      result.errors.push(`resolvePredictions(${stopId}): ${err.message}`);
    }
  }

  try {
    result.live = await getRouteLive(routeId);
  } catch (err) {
    result.errors.push(`getRouteLive: ${err.message}`);
    return result;
  }

  const trip = result.live?.trips.find((candidate) => candidate.tripId === tripId) ?? null;

  if (trip?.etaAvailable && trip.etas.length > 0) {
    try {
      result.predictionsLogged = await recordPredictions({
        tripId,
        routeId,
        etas: trip.etas,
        predictedAt: new Date(),
      });
    } catch (err) {
      result.errors.push(`recordPredictions: ${err.message}`);
    }
  }

  try {
    await broadcastRouteUpdate(routeId, { live: result.live, meta: { reason: 'checkin', tripId } });
  } catch (err) {
    result.errors.push(`broadcast: ${err.message}`);
  }

  try {
    result.alertsSent = (await processArrivalAlerts(routeId)).length;
  } catch (err) {
    result.errors.push(`arrivalAlerts: ${err.message}`);
  }

  if (result.errors.length > 0) {
    console.warn('[checkin] side effects partially failed:', result.errors.join('; '));
  }

  return result;
}
