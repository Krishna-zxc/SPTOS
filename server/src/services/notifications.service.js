/**
 * Arrival alerts (PRD FR-C6, FR-S4).
 *
 * After every check-in the subscriptions for that route are re-evaluated: if a
 * subscribed commuter's stop is now within their chosen lead time, the alert
 * fires once for that trip.
 *
 * Delivery currently goes over the WebSocket the commuter app already holds, so
 * it works while the app is open. Background push (Firebase Cloud Messaging /
 * Web Push, per PRD 10) plugs in at `deliver()` below — it needs project
 * credentials, so it is deliberately left as a seam rather than stubbed.
 */
import { query } from '../db/index.js';
import { emitArrivalAlert } from './realtime.js';
import { getRouteLive } from './live.service.js';

async function deliver(subscription, payload) {
  emitArrivalAlert(subscription.userId, payload);
  // TODO(FR-S4, v1.1): also hand `payload` to FCM / Web Push using the tokens
  // registered by the client, so alerts arrive with the app backgrounded.
}

/**
 * Fires any due alerts for a route.
 * @returns {Promise<Array<object>>} the alerts that were sent
 */
export async function processArrivalAlerts(routeId, { now = Date.now() } = {}) {
  const { rows } = await query(
    `SELECT id, user_id, route_id, stop_id, minutes_before, trip_id, notified_at
       FROM alert_subscriptions
      WHERE route_id = $1`,
    [routeId],
  );
  if (rows.length === 0) return [];

  const live = await getRouteLive(routeId, { now });
  if (!live) return [];

  const sent = [];

  for (const row of rows) {
    const subscription = {
      id: Number(row.id),
      userId: Number(row.user_id),
      stopId: Number(row.stop_id),
      minutesBefore: Number(row.minutes_before),
      notifiedTripId: row.trip_id === null ? null : Number(row.trip_id),
      notifiedAt: row.notified_at,
    };

    // Soonest trip that is still upstream of the stop and has a usable estimate.
    const candidates = live.trips
      .filter((trip) => trip.etaAvailable)
      .map((trip) => ({ trip, eta: trip.etas.find((e) => e.stopId === subscription.stopId) }))
      .filter((entry) => entry.eta && entry.eta.etaMinutes <= subscription.minutesBefore)
      .sort((a, b) => a.eta.etaMinutes - b.eta.etaMinutes);

    const match = candidates[0];
    if (!match) continue;

    // Already alerted for this trip — do not nag on every subsequent check-in.
    if (subscription.notifiedAt && subscription.notifiedTripId === match.trip.tripId) continue;

    const payload = {
      subscriptionId: subscription.id,
      routeId,
      routeCode: live.route.code,
      routeName: live.route.name,
      stopId: subscription.stopId,
      stopName: match.eta.stopName,
      tripId: match.trip.tripId,
      etaMinutes: match.eta.etaMinutes,
      rangeLowMinutes: match.eta.rangeLowMinutes,
      rangeHighMinutes: match.eta.rangeHighMinutes,
      occupancy: match.trip.lastCheckin?.occupancy ?? null,
      isEstimate: true,
      sentAt: new Date(now).toISOString(),
    };

    await query(
      'UPDATE alert_subscriptions SET notified_at = now(), trip_id = $2 WHERE id = $1',
      [subscription.id, match.trip.tripId],
    );
    await deliver(subscription, payload);
    sent.push(payload);
  }

  return sent;
}
