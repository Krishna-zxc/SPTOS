import './env.js';
/**
 * End-to-end smoke test over the real HTTP surface.
 *
 * Everything runs against the throwaway in-memory PGlite database, driven
 * entirely through the API — no service is called directly — so what it proves
 * is that the PRD's core loop actually works when wired together: an admin
 * publishes a route (FR-A1), a driver runs it check-in by check-in (FR-D2), a
 * commuter sees a live position with an ETA and a freshness stamp (FR-C2…C5),
 * and the trip lands in the planning analytics (FR-A2, FR-A3).
 *
 * The tests share state and run in order on purpose: a check-in only makes
 * sense against a trip that has already started, and rebuilding the whole
 * catalogue for each assertion would test the fixtures rather than the product.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeDb, query, queryOne } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { hashPassword } from '../src/middleware/auth.js';

const app = createApp();
const PASSWORD = 'test-password-1';

/** Shared fixture ids and tokens, filled in as the tests progress. */
const ctx = { stops: [] };

const auth = (token) => ({ authorization: `Bearer ${token}` });

/** Asserts the status and returns the body, reporting the body when it differs. */
function body(res, status) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${res.text}`);
  return res.body;
}

before(async () => {
  await migrate({ log: false });

  // Bootstrap: the first administrator cannot be created through the API,
  // because nothing in the API creates admins without an admin already signed
  // in. In production this is the one-off `npm run seed`.
  const row = await queryOne(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin') RETURNING id`,
    ['Meera Admin', 'meera@test.local', await hashPassword(PASSWORD)],
  );
  ctx.adminId = Number(row.id);
});

after(async () => {
  await closeDb();
});

/* ── Accounts and RBAC (FR-S5) ──────────────────────────────────────────── */

test('an administrator signs in and the health check reports ready', async () => {
  const health = body(await request(app).get('/api/health'), 200);
  assert.equal(health.ok, true);

  const signin = body(
    await request(app).post('/api/auth/login').send({ email: 'meera@test.local', password: PASSWORD }),
    200,
  );
  assert.equal(signin.user.role, 'admin');
  assert.ok(signin.token, 'a JWT is issued');
  ctx.adminToken = signin.token;
});

test('self-registration can only ever create a commuter', async () => {
  const created = body(
    await request(app).post('/api/auth/register').send({
      name: 'Riya Commuter',
      email: 'Riya@Test.local',
      password: PASSWORD,
      // A caller trying to grant themselves a role is ignored, not rejected:
      // the column is hard-wired to 'commuter' in the INSERT.
      role: 'admin',
    }),
    201,
  );

  assert.equal(created.user.role, 'commuter');
  assert.equal(created.user.email, 'riya@test.local', 'the address is normalised');
  ctx.commuterId = created.user.id;
  ctx.commuterToken = created.token;

  const me = body(
    await request(app).get('/api/auth/me').set(auth(ctx.commuterToken)),
    200,
  );
  assert.equal(me.user.id, ctx.commuterId);
});

test('a taken address is refused and sign-in failures are indistinguishable', async () => {
  const clash = body(
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Someone Else', email: 'riya@test.local', password: PASSWORD }),
    409,
  );
  assert.match(clash.error, /already exists/);

  const wrongPassword = body(
    await request(app).post('/api/auth/login').send({ email: 'riya@test.local', password: 'not-it-at-all' }),
    401,
  );
  const noSuchUser = body(
    await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: PASSWORD }),
    401,
  );

  // Identical wording, so the endpoint cannot be used to enumerate addresses.
  assert.equal(wrongPassword.error, noSuchUser.error);
});

test('role boundaries hold on both privileged surfaces', async () => {
  body(await request(app).get('/api/driver/assignments'), 401);
  body(await request(app).get('/api/driver/assignments').set(auth(ctx.commuterToken)), 403);
  body(await request(app).get('/api/admin/routes').set(auth(ctx.commuterToken)), 403);
  body(await request(app).get('/api/admin/routes').set(auth(ctx.adminToken)), 200);

  const forged = body(
    await request(app).get('/api/auth/me').set({ authorization: 'Bearer not.a.real.token' }),
    401,
  );
  assert.ok(forged.error);
});

/* ── Catalogue management (FR-A1) and discovery (FR-C1) ─────────────────── */

const FIXTURE_STOPS = [
  { code: 'TST1', name: 'Test Depot', latitude: 18.53, longitude: 73.85 },
  { code: 'TST2', name: 'Test Chowk', latitude: 18.55, longitude: 73.83 },
  { code: 'TST3', name: 'Test Bridge', latitude: 18.57, longitude: 73.81 },
  { code: 'TST4', name: 'Test Terminus', latitude: 18.59, longitude: 73.79 },
];

test('an administrator publishes a route with its stop sequence and timetable', async () => {
  for (const stop of FIXTURE_STOPS) {
    const created = body(
      await request(app).post('/api/admin/stops').set(auth(ctx.adminToken)).send(stop),
      201,
    );
    ctx.stops.push({ ...stop, id: created.id });
  }

  const route = body(
    await request(app)
      .post('/api/admin/routes')
      .set(auth(ctx.adminToken))
      .send({ code: 'T1', name: 'Test Depot — Test Terminus' }),
    201,
  );
  ctx.routeId = route.id;

  // The offsets are the timetable FR-A3 measures delay against and the ETA
  // engine falls back to before any leg has measured history: 10 min a leg.
  const sequence = body(
    await request(app)
      .put(`/api/admin/routes/${ctx.routeId}/stops`)
      .set(auth(ctx.adminToken))
      .send({
        stops: ctx.stops.map((stop, index) => ({
          stopId: stop.id,
          scheduledOffsetSeconds: index * 600,
        })),
      }),
    200,
  );
  assert.equal(sequence.stopCount, 4);
});

test('a route needs at least two stops and cannot repeat one', async () => {
  const tooShort = body(
    await request(app)
      .put(`/api/admin/routes/${ctx.routeId}/stops`)
      .set(auth(ctx.adminToken))
      .send({ stops: [{ stopId: ctx.stops[0].id }] }),
    400,
  );
  assert.match(JSON.stringify(tooShort.details), /at least two stops/);

  const repeated = body(
    await request(app)
      .put(`/api/admin/routes/${ctx.routeId}/stops`)
      .set(auth(ctx.adminToken))
      .send({ stops: [{ stopId: ctx.stops[0].id }, { stopId: ctx.stops[0].id }] }),
    409,
  );
  assert.match(repeated.error, /only once/);
});

test('the public catalogue finds the route and its ordered stops', async () => {
  const search = body(await request(app).get('/api/routes?q=Terminus'), 200);
  assert.equal(search.routes.length, 1);
  assert.equal(search.routes[0].stopCount, 4);

  const detail = body(await request(app).get(`/api/routes/${ctx.routeId}`), 200);
  assert.deepEqual(
    detail.stops.map((stop) => stop.seq),
    [1, 2, 3, 4],
  );
  assert.equal(detail.stops[3].scheduledOffsetSeconds, 1800);

  const stops = body(await request(app).get('/api/stops?q=Test%20Chowk'), 200);
  assert.equal(stops.stops.length, 1);
  assert.deepEqual(
    stops.stops[0].routes.map((entry) => entry.code),
    ['T1'],
    'a stop lists the routes serving it',
  );

  // A typed % must not act as a wildcard.
  const literal = body(await request(app).get('/api/stops?q=%25'), 200);
  assert.equal(literal.stops.length, 0);
});

test('a driver account is provisioned and assigned to the route', async () => {
  const created = body(
    await request(app).post('/api/admin/users').set(auth(ctx.adminToken)).send({
      name: 'Suresh Driver',
      email: 'suresh@test.local',
      password: PASSWORD,
      role: 'driver',
    }),
    201,
  );
  assert.equal(created.user.role, 'driver');
  ctx.driverId = created.user.id;

  body(
    await request(app)
      .put(`/api/admin/users/${ctx.driverId}/assignments`)
      .set(auth(ctx.adminToken))
      .send({ routeIds: [ctx.routeId] }),
    200,
  );

  // Only drivers can hold route assignments.
  const notADriver = body(
    await request(app)
      .put(`/api/admin/users/${ctx.commuterId}/assignments`)
      .set(auth(ctx.adminToken))
      .send({ routeIds: [ctx.routeId] }),
    409,
  );
  assert.match(notADriver.error, /driver accounts/);

  const signin = body(
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'suresh@test.local', password: PASSWORD }),
    200,
  );
  ctx.driverToken = signin.token;
});

/* ── The core loop: check-in → live tracker → ETA (FR-D1…D3, FR-C2…C5) ──── */

test('the driver app opens on the assigned route and no trip in progress', async () => {
  const assignments = body(
    await request(app).get('/api/driver/assignments').set(auth(ctx.driverToken)),
    200,
  );
  assert.deepEqual(
    assignments.routes.map((route) => route.code),
    ['T1'],
  );

  const resumed = body(
    await request(app).get('/api/driver/active-trip').set(auth(ctx.driverToken)),
    200,
  );
  assert.equal(resumed.trip, null);
});

test('starting a trip points at the first stop and blocks a second bus', async () => {
  const started = body(
    await request(app).post('/api/driver/trips').set(auth(ctx.driverToken)).send({ routeId: ctx.routeId }),
    201,
  );
  ctx.tripId = started.trip.tripId;

  assert.equal(started.trip.status, 'active');
  assert.equal(started.nextStop.seq, 1, 'the next tap confirms the first stop');
  assert.equal(started.stopsRemaining, 4);
  assert.equal(started.isComplete, false);

  // A driver is on one bus at a time; a forgotten trip would otherwise keep
  // broadcasting next to the real one.
  const second = body(
    await request(app).post('/api/driver/trips').set(auth(ctx.driverToken)).send({ routeId: ctx.routeId }),
    409,
  );
  assert.match(second.error, /Finish or cancel/);
});

test('one tap is a whole check-in: the stop is derived from the sequence', async () => {
  // FR-D2/NFR-usability: the body carries only what the driver actually chose.
  // `recordedAt` is backdated two minutes so the first leg is a plausible one —
  // segment_travel_samples discards anything under 20 seconds as a double tap,
  // and a trip driven entirely inside one test would leave no ETA history at all.
  const first = body(
    await request(app)
      .post(`/api/driver/trips/${ctx.tripId}/checkins`)
      .set(auth(ctx.driverToken))
      .send({ occupancy: 'seats_free', recordedAt: new Date(Date.now() - 120_000).toISOString() }),
    201,
  );

  assert.equal(first.checkin.seq, 1);
  assert.equal(first.checkin.stopId, ctx.stops[0].id);
  assert.equal(first.duplicate, false);
  assert.equal(first.nextStop.seq, 2, 'the screen has already advanced');
  assert.equal(first.trip.lastOccupancy, 'seats_free');
});

test('a replayed queue entry resolves to the stored check-in, not a duplicate row', async () => {
  const send = () =>
    request(app)
      .post(`/api/driver/trips/${ctx.tripId}/checkins`)
      .set(auth(ctx.driverToken))
      .send({ occupancy: 'standing_only', clientUuid: 'replay-stop-2' });

  const accepted = body(await send(), 201);
  assert.equal(accepted.checkin.seq, 2);
  assert.equal(accepted.duplicate, false);
  ctx.stop2CheckinId = accepted.checkin.id;

  // FR-D6: the phone re-sends anything whose response it never saw. The reply is
  // a 200 rather than a 201 or an error, so the outbox can clear the entry.
  const replayed = body(await send(), 200);
  assert.equal(replayed.duplicate, true);
  assert.equal(replayed.checkin.id, ctx.stop2CheckinId);

  const { rows } = await query(
    'SELECT id FROM checkins WHERE client_uuid = $1',
    ['replay-stop-2'],
  );
  assert.equal(rows.length, 1, 'the unique client_uuid kept it to one row');
});

test('the live route view carries a position, a freshness stamp and labelled ETAs', async () => {
  const live = body(await request(app).get(`/api/routes/${ctx.routeId}/live`), 200);

  assert.equal(live.trips.length, 1);
  const [trip] = live.trips;

  assert.equal(trip.lastCheckin.seq, 2);
  assert.equal(trip.lastCheckin.occupancyLabel, 'Standing only', 'FR-C4 crowding');
  assert.equal(trip.nextStop.seq, 3);
  assert.deepEqual(trip.progress, { stopsCompleted: 2, totalStops: 4, fraction: 0.5 });

  // FR-C2: with no phone GPS the bus is projected along the leg it is on, and
  // says so, rather than implying a precision it does not have.
  assert.equal(trip.position.source, 'projected');
  assert.ok(Number.isFinite(trip.position.latitude));

  // FR-C5 / NFR-transparency: a live reading is never unlabelled.
  assert.equal(trip.freshness.hasData, true);
  assert.equal(trip.freshness.isStale, false);
  assert.ok(trip.freshness.ageSeconds < 60);
  assert.equal(live.staleAfterSeconds, 480);

  // FR-C3 / §12 mitigation: an estimate, with a range, for every stop ahead.
  assert.equal(trip.etaAvailable, true);
  assert.equal(trip.etaUnavailableReason, null);
  assert.deepEqual(
    trip.etas.map((eta) => eta.seq),
    [3, 4],
  );
  for (const eta of trip.etas) {
    assert.equal(eta.isEstimate, true);
    assert.ok(eta.rangeLowMinutes <= eta.etaMinutes);
    assert.ok(eta.rangeHighMinutes >= eta.etaMinutes);
  }

  // No leg has measured history yet, so the timetable is used and the estimate
  // is honest about being weak.
  assert.equal(trip.etas[0].confidence, 'low');
  assert.ok(trip.etas[0].etaMinutes >= 9 && trip.etas[0].etaMinutes <= 10);
  assert.ok(trip.etas[1].etaMinutes >= 19 && trip.etas[1].etaMinutes <= 20);
});

test('a commuter at a stop sees only buses still upstream of them', async () => {
  const terminus = body(await request(app).get(`/api/stops/${ctx.stops[3].id}/live`), 200);
  assert.equal(terminus.arrivals.length, 1);
  assert.equal(terminus.arrivals[0].stopsAway, 2);
  assert.equal(terminus.arrivals[0].occupancy, 'standing_only');
  assert.equal(terminus.arrivals[0].eta.isEstimate, true);
  assert.equal(terminus.arrivals[0].freshness.isStale, false);

  // The bus has already left the first two stops, so it is not an arrival there.
  const passed = body(await request(app).get(`/api/stops/${ctx.stops[0].id}/live`), 200);
  assert.equal(passed.arrivals.length, 0);
});

test('the public trip view exposes progress without the driver breadcrumb trail', async () => {
  const view = body(await request(app).get(`/api/trips/${ctx.tripId}`), 200);
  assert.equal(view.trip.status, 'active');
  assert.equal(view.trip.driverName, 'Suresh Driver');
  assert.ok(!('latitude' in view.trip), 'no raw driver coordinates leak to the public view');
  assert.equal(view.checkins.length, 2);
});

test('the stop sequence cannot be renumbered under a moving bus', async () => {
  const refused = body(
    await request(app)
      .put(`/api/admin/routes/${ctx.routeId}/stops`)
      .set(auth(ctx.adminToken))
      .send({
        stops: [...ctx.stops].reverse().map((stop, index) => ({
          stopId: stop.id,
          scheduledOffsetSeconds: index * 600,
        })),
      }),
    409,
  );
  assert.match(refused.error, /End the active trip/);
});

/* ── Arrival alerts (FR-C6) and the offline outbox (FR-D6) ──────────────── */

test('a subscribed commuter is alerted once the bus is inside their lead time', async () => {
  const created = body(
    await request(app)
      .post('/api/alerts')
      .set(auth(ctx.commuterToken))
      .send({ routeId: ctx.routeId, stopId: ctx.stops[3].id, minutesBefore: 30 }),
    201,
  );
  ctx.alertId = created.alert.id;

  const listed = body(await request(app).get('/api/alerts').set(auth(ctx.commuterToken)), 200);
  assert.equal(listed.alerts.length, 1);
  assert.equal(listed.alerts[0].minutesBefore, 30);

  // Checking in at stop 3 puts the terminus ~10 minutes out, inside the 30 the
  // commuter asked for, so the alert fires as part of the check-in.
  const third = body(
    await request(app)
      .post(`/api/driver/trips/${ctx.tripId}/checkins`)
      .set(auth(ctx.driverToken))
      .send({ occupancy: 'full', clientUuid: 'stop-3-uuid' }),
    201,
  );
  assert.equal(third.checkin.seq, 3);
  assert.equal(third.alertsSent, 1);

  // The subscription is stamped with the trip it fired for, which is what stops
  // the next check-in on the same bus from nagging the same commuter again.
  const stamped = await queryOne(
    'SELECT trip_id, notified_at FROM alert_subscriptions WHERE id = $1',
    [ctx.alertId],
  );
  assert.equal(Number(stamped.trip_id), ctx.tripId);
  assert.ok(stamped.notified_at);
});

test('draining the offline outbox reports each entry separately', async () => {
  const drained = body(
    await request(app)
      .post(`/api/driver/trips/${ctx.tripId}/checkins/batch`)
      .set(auth(ctx.driverToken))
      .send({
        checkins: [
          // Already on file from when the phone had signal — a safe replay.
          {
            occupancy: 'standing_only',
            clientUuid: 'replay-stop-2',
            recordedAt: new Date(Date.now() - 120_000).toISOString(),
          },
          // Unusable: this stop is not on the route, and never will be.
          {
            occupancy: 'full',
            stopId: 999_999,
            clientUuid: 'queued-nonsense',
            recordedAt: new Date(Date.now() - 90_000).toISOString(),
          },
          // The genuinely new one, which must still land despite the bad entry.
          {
            occupancy: 'seats_free',
            clientUuid: 'queued-stop-4',
            recordedAt: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      }),
    201,
  );

  assert.deepEqual(
    drained.results.map((entry) => entry.status),
    ['duplicate', 'rejected', 'accepted'],
    'oldest first, and one bad entry does not strand the queue',
  );
  assert.deepEqual(
    { accepted: drained.accepted, duplicates: drained.duplicates, rejected: drained.rejected },
    { accepted: 1, duplicates: 1, rejected: 1 },
  );
  assert.match(drained.results[1].reason, /not found/);

  assert.equal(drained.isComplete, true, 'the route is now fully checked in');
  assert.equal(drained.stopsRemaining, 0);
  assert.equal(drained.nextStop, null);
  assert.equal(drained.alertsSent, 0, 'the commuter was already told about this bus');
  ctx.stop4CheckinId = drained.results[2].checkin.id;
});

/* ── Corrections (FR-D5) and phone GPS (FR-D4) ──────────────────────────── */

test('a mistaken occupancy is corrected in place and the live view follows', async () => {
  const fixed = body(
    await request(app)
      .patch(`/api/driver/checkins/${ctx.stop4CheckinId}`)
      .set(auth(ctx.driverToken))
      .send({ occupancy: 'empty' }),
    200,
  );
  assert.equal(fixed.checkin.occupancy, 'empty');

  const live = body(await request(app).get(`/api/routes/${ctx.routeId}/live`), 200);
  assert.equal(live.trips[0].lastCheckin.occupancy, 'empty');
  assert.equal(live.trips[0].lastCheckin.occupancyLabel, 'Empty');

  const empty = body(
    await request(app)
      .patch(`/api/driver/checkins/${ctx.stop4CheckinId}`)
      .set(auth(ctx.driverToken))
      .send({}),
    400,
  );
  assert.match(JSON.stringify(empty.details), /occupancy or recordedAt/);
});

test('removing a check-in rewinds the next stop and stays idempotent', async () => {
  body(
    await request(app)
      .delete(`/api/driver/checkins/${ctx.stop4CheckinId}`)
      .set(auth(ctx.driverToken)),
    204,
  );

  const progress = body(
    await request(app).get(`/api/driver/trips/${ctx.tripId}`).set(auth(ctx.driverToken)),
    200,
  );
  assert.equal(progress.nextStop.seq, 4, 'the terminus is offered again');
  assert.equal(progress.stopsRemaining, 1);
  assert.equal(progress.isComplete, false);

  // A retried delete from a flaky connection is not an error.
  body(
    await request(app)
      .delete(`/api/driver/checkins/${ctx.stop4CheckinId}`)
      .set(auth(ctx.driverToken)),
    204,
  );
});

test('a phone GPS breadcrumb sharpens the map and says the position is measured', async () => {
  body(
    await request(app)
      .post(`/api/driver/trips/${ctx.tripId}/positions`)
      .set(auth(ctx.driverToken))
      .send({ latitude: 18.58, longitude: 73.8 }),
    202,
  );

  const live = body(await request(app).get(`/api/routes/${ctx.routeId}/live`), 200);
  assert.equal(live.trips[0].position.source, 'gps');
  assert.equal(live.trips[0].position.latitude, 18.58);

  const rejected = body(
    await request(app)
      .post(`/api/driver/trips/${ctx.tripId}/positions`)
      .set(auth(ctx.driverToken))
      .send({ latitude: 999, longitude: 73.8 }),
    400,
  );
  assert.ok(rejected.details.length > 0);
});

test('one driver cannot check in on another driver\'s trip', async () => {
  const other = body(
    await request(app).post('/api/admin/users').set(auth(ctx.adminToken)).send({
      name: 'Anil Driver',
      email: 'anil@test.local',
      password: PASSWORD,
      role: 'driver',
    }),
    201,
  );
  const signin = body(
    await request(app).post('/api/auth/login').send({ email: 'anil@test.local', password: PASSWORD }),
    200,
  );

  const refused = body(
    await request(app)
      .post(`/api/driver/trips/${ctx.tripId}/checkins`)
      .set(auth(signin.token))
      .send({ occupancy: 'full' }),
    403,
  );
  assert.match(refused.error, /another driver/);
  assert.equal(other.user.role, 'driver');
});

/* ── Commuter feedback (FR-C7) and admin triage (FR-A5) ─────────────────── */

test('a commuter flags a bad update and an administrator triages it', async () => {
  const reported = body(
    await request(app).post('/api/issues').set(auth(ctx.commuterToken)).send({
      kind: 'wrong_position',
      routeId: ctx.routeId,
      stopId: ctx.stops[2].id,
      tripId: ctx.tripId,
      note: 'Bus showed at the bridge but I watched it go past ten minutes ago.',
    }),
    201,
  );
  assert.equal(reported.issue.status, 'open');

  const mine = body(await request(app).get('/api/issues/mine').set(auth(ctx.commuterToken)), 200);
  assert.equal(mine.issues.length, 1);
  assert.equal(mine.issues[0].routeCode, 'T1');

  const queue = body(
    await request(app).get('/api/admin/issues?status=open').set(auth(ctx.adminToken)),
    200,
  );
  assert.equal(queue.issues.length, 1);
  assert.equal(queue.issues[0].kindLabel, 'Position looks wrong');
  assert.equal(queue.issues[0].reporterEmail, 'riya@test.local');

  const resolved = body(
    await request(app)
      .patch(`/api/admin/issues/${reported.issue.id}`)
      .set(auth(ctx.adminToken))
      .send({ status: 'resolved' }),
    200,
  );
  assert.equal(resolved.issue.status, 'resolved');

  const invalid = body(
    await request(app)
      .patch(`/api/admin/issues/${reported.issue.id}`)
      .set(auth(ctx.adminToken))
      .send({ status: 'made-up' }),
    400,
  );
  assert.ok(invalid.details.length > 0);
});

test('favourites save a route-and-stop pair and reject a pair that is not served', async () => {
  const saved = body(
    await request(app)
      .post('/api/favourites')
      .set(auth(ctx.commuterToken))
      .send({ routeId: ctx.routeId, stopId: ctx.stops[1].id }),
    201,
  );

  const listed = body(await request(app).get('/api/favourites').set(auth(ctx.commuterToken)), 200);
  assert.equal(listed.favourites.length, 1);
  assert.equal(listed.favourites[0].stopName, 'Test Chowk');

  // Tapping the star twice adjusts the same row rather than stacking duplicates.
  const again = body(
    await request(app)
      .post('/api/favourites')
      .set(auth(ctx.commuterToken))
      .send({ routeId: ctx.routeId, stopId: ctx.stops[1].id }),
    201,
  );
  assert.equal(again.id, saved.id);

  body(
    await request(app).delete(`/api/favourites/${saved.id}`).set(auth(ctx.commuterToken)),
    204,
  );
  body(
    await request(app).delete(`/api/favourites/${saved.id}`).set(auth(ctx.commuterToken)),
    404,
  );
});

/* ── Ending the trip, and what the planners get out of it ───────────────── */

test('ending the trip clears it from the live view and frees waiting commuters', async () => {
  const ended = body(
    await request(app).post(`/api/driver/trips/${ctx.tripId}/end`).set(auth(ctx.driverToken)),
    200,
  );
  assert.equal(ended.trip.status, 'completed');
  assert.ok(ended.trip.endedAt);

  const live = body(await request(app).get(`/api/routes/${ctx.routeId}/live`), 200);
  assert.equal(live.trips.length, 0, 'a finished bus is not a live bus');

  // The subscription is released so the *next* bus can still alert them.
  const released = await queryOne('SELECT trip_id, notified_at FROM alert_subscriptions WHERE id = $1', [
    ctx.alertId,
  ]);
  assert.equal(released.trip_id, null);
  assert.equal(released.notified_at, null);

  const twice = body(
    await request(app).post(`/api/driver/trips/${ctx.tripId}/end`).set(auth(ctx.driverToken)),
    409,
  );
  assert.match(twice.error, /already completed/);
});

test('the completed trip lands in stop-wise demand analytics', async () => {
  const demand = body(
    await request(app).get(`/api/admin/analytics/demand?routeId=${ctx.routeId}`).set(auth(ctx.adminToken)),
    200,
  );

  // Three surviving check-ins: stops 1–3. The terminus tap was voided.
  assert.equal(demand.totals.checkins, 3);
  assert.equal(demand.totals.stopsReporting, 3);
  assert.ok(demand.totals.avgLoadFactor > 0 && demand.totals.avgLoadFactor <= 1);

  const bridge = demand.byStop.find((row) => row.stopCode === 'TST3');
  assert.equal(bridge.checkins, 1);
  assert.equal(bridge.crowdedCheckins, 1, 'a "full" bus counts as crowded');
  assert.ok(bridge.bandLabel, 'every row is attributed to a named time band');

  assert.ok(demand.byBand.length >= 1);
  assert.equal(
    demand.byBand.reduce((sum, row) => sum + row.checkins, 0),
    3,
  );
});

test('punctuality is measured per route and per segment against the timetable', async () => {
  const punctuality = body(
    await request(app)
      .get(`/api/admin/analytics/punctuality?routeId=${ctx.routeId}&toleranceSeconds=120`)
      .set(auth(ctx.adminToken)),
    200,
  );

  assert.equal(punctuality.toleranceSeconds, 120);
  assert.equal(punctuality.byRoute.length, 1);
  assert.equal(punctuality.byRoute[0].routeCode, 'T1');
  assert.ok(punctuality.byRoute[0].samples >= 1);

  // The whole route was driven in seconds against a 30-minute timetable, so
  // every stop after the first reads as far ahead of schedule.
  assert.ok(punctuality.byRoute[0].avgDelaySeconds < 0);
  assert.ok(punctuality.bySegment.length >= 1);
  assert.ok(punctuality.bySegment.every((row) => Number.isFinite(row.seq)));
});

test('the operations summary reports the PRD §4 success metrics', async () => {
  const ops = body(
    await request(app).get('/api/admin/analytics/operations').set(auth(ctx.adminToken)),
    200,
  );

  assert.deepEqual(ops.trips, { total: 1, active: 0, completed: 1, cancelled: 0 });

  // §4 "check-in coverage": 3 of 4 stops were confirmed.
  assert.equal(ops.checkinCoverage.tripsMeasured, 1);
  assert.ok(ops.checkinCoverage.averageShare > 0.7 && ops.checkinCoverage.averageShare <= 0.8);

  // §4 "ETA accuracy": predictions logged at each check-in and reconciled on
  // arrival, so MAE is measurable rather than asserted.
  assert.ok(ops.etaAccuracy.resolvedPredictions >= 1);
  assert.ok(Number.isFinite(ops.etaAccuracy.maeSeconds));

  // §4 "update freshness".
  assert.ok(Number.isFinite(ops.updateFreshness.medianGapSeconds));

  assert.equal(ops.adoption.registeredDrivers, 2);
  assert.equal(ops.adoption.registeredCommuters, 1);
  assert.equal(ops.adoption.activeRoutes, 1);
  assert.equal(ops.adoption.stops, 4);
  assert.equal(ops.adoption.openIssues, 0, 'the flagged issue was triaged');
});

test('the admin live map is empty once every bus has finished', async () => {
  const network = body(
    await request(app).get('/api/admin/live/network').set(auth(ctx.adminToken)),
    200,
  );
  assert.equal(network.activeTrips, 0);
  assert.ok(network.generatedAt);
});

/* ── CSV export (FR-A6) and the last two guards ─────────────────────────── */

test('every report in the export registry downloads as CSV', async () => {
  const registry = body(await request(app).get('/api/admin/exports').set(auth(ctx.adminToken)), 200);
  assert.ok(registry.datasets.length >= 4);

  for (const dataset of registry.datasets) {
    const res = await request(app)
      .get(`/api/admin/export/${dataset.key}`)
      .set(auth(ctx.adminToken));
    assert.equal(res.status, 200, `${dataset.key} → ${res.status}`);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], /attachment; filename="sptos-/);
    assert.equal(res.text.split('\r\n')[0], dataset.columns.join(','));
  }

  const demand = await request(app)
    .get('/api/admin/export/demand-by-stop')
    .set(auth(ctx.adminToken));
  assert.match(demand.text, /Test Bridge/);

  // Only the fixed registry keys are routable, so nothing from the URL reaches
  // the query or the filename.
  body(
    await request(app).get('/api/admin/export/../../etc/passwd').set(auth(ctx.adminToken)),
    404,
  );
  body(await request(app).get('/api/admin/export/anything-else').set(auth(ctx.adminToken)), 400);
});

test('an administrator cannot demote or deactivate their own account', async () => {
  const demote = body(
    await request(app)
      .patch(`/api/admin/users/${ctx.adminId}`)
      .set(auth(ctx.adminToken))
      .send({ role: 'driver' }),
    400,
  );
  assert.match(demote.error, /your own admin access/);

  body(
    await request(app)
      .patch(`/api/admin/users/${ctx.adminId}`)
      .set(auth(ctx.adminToken))
      .send({ isActive: false }),
    400,
  );

  // Someone else's account is fair game.
  const suspended = body(
    await request(app)
      .patch(`/api/admin/users/${ctx.driverId}`)
      .set(auth(ctx.adminToken))
      .send({ isActive: false }),
    200,
  );
  assert.equal(suspended.user.isActive, false);

  const lockedOut = body(
    await request(app).post('/api/auth/login').send({ email: 'suresh@test.local', password: PASSWORD }),
    403,
  );
  assert.match(lockedOut.error, /deactivated/);
});

/* ── The transparency NFR, which no UI can compensate for later ──────────── */

test('a bus that stopped reporting is shown as no recent data, not as live', async () => {
  // An admin covering a shift is not in driver_assignments and starts a trip
  // anyway — the same path a supervisor uses on the road.
  const started = body(
    await request(app).post('/api/driver/trips').set(auth(ctx.adminToken)).send({ routeId: ctx.routeId }),
    201,
  );
  const tripId = started.trip.tripId;

  // One check-in, then silence for twenty minutes: well past the 480s cutoff.
  body(
    await request(app)
      .post(`/api/driver/trips/${tripId}/checkins`)
      .set(auth(ctx.adminToken))
      .send({ occupancy: 'seats_free', recordedAt: new Date(Date.now() - 20 * 60_000).toISOString() }),
    201,
  );

  const live = body(await request(app).get(`/api/routes/${ctx.routeId}/live`), 200);
  const trip = live.trips.find((candidate) => candidate.tripId === tripId);

  assert.equal(trip.freshness.isStale, true);
  assert.match(trip.freshness.label, /No recent data/);
  assert.ok(trip.freshness.ageSeconds >= 1200);

  // The estimate is withheld rather than quietly extrapolated, and the reason is
  // machine-readable so the UI can say why instead of showing a blank.
  assert.equal(trip.etaAvailable, false);
  assert.equal(trip.etaUnavailableReason, 'stale_data');

  const atStop = body(await request(app).get(`/api/stops/${ctx.stops[1].id}/live`), 200);
  assert.equal(atStop.arrivals.length, 1);
  assert.equal(atStop.arrivals[0].etaAvailable, false);
  assert.equal(atStop.arrivals[0].freshness.isStale, true);

  body(await request(app).post(`/api/driver/trips/${tripId}/cancel`).set(auth(ctx.adminToken)), 200);
});

test('retiring a route hides it from commuters without deleting its history', async () => {
  body(await request(app).delete(`/api/admin/routes/${ctx.routeId}`).set(auth(ctx.adminToken)), 204);

  const publicList = body(await request(app).get('/api/routes'), 200);
  assert.equal(publicList.routes.length, 0);

  // A hard delete would take the segment history with it and silently degrade
  // ETAs on every route sharing those stops.
  const adminList = body(await request(app).get('/api/admin/routes').set(auth(ctx.adminToken)), 200);
  assert.equal(adminList.routes.length, 1);
  assert.equal(adminList.routes[0].isActive, false);
  assert.equal(adminList.routes[0].tripCount, 2);

  const stillCounted = body(
    await request(app).get(`/api/admin/analytics/demand?routeId=${ctx.routeId}`).set(auth(ctx.adminToken)),
    200,
  );
  assert.ok(stillCounted.totals.checkins >= 3);
});

