/**
 * Pilot data for the two-to-three routes in PRD §7.
 *
 * The interesting part is the synthetic history. SPTOS derives ETAs from
 * measured stop-to-stop averages (FR-S1), so a freshly migrated database has no
 * ETAs at all and every analytics panel is empty — which makes the whole product
 * impossible to review. This backfills a fortnight of plausible trips, including
 * rush-hour slowdown, so the ETA engine has real samples to average and the
 * dashboard has something to plot on first run.
 *
 * Run with `npm run seed`, or `npm run reset` to clear first.
 */
import { pathToFileURL } from 'node:url';
import config from '../config.js';
import { closeDb, query, queryOne } from './index.js';
import { migrate } from './migrate.js';
import { hashPassword } from '../middleware/auth.js';

/** Dev credentials only — every one of these is public in this file. */
const DEV_PASSWORD = 'sptos1234';

const USERS = [
  { name: 'Meera Nair', email: 'meera@sptos.local', role: 'admin', phone: '+91 90000 00001' },
  { name: 'Suresh Patil', email: 'suresh@sptos.local', role: 'driver', phone: '+91 90000 00002' },
  { name: 'Anil Kamble', email: 'anil@sptos.local', role: 'driver', phone: '+91 90000 00003' },
  { name: 'Riya Sharma', email: 'riya@sptos.local', role: 'commuter', phone: '+91 90000 00004' },
];

/**
 * Stops carry real coordinates so the Leaflet map and the projected-position
 * interpolation between stops both behave like they will in the pilot.
 */
const STOPS = [
  { code: 'SHV', name: 'Shivajinagar Bus Stand', latitude: 18.5308, longitude: 73.8478 },
  { code: 'UNI', name: 'University Circle', latitude: 18.5523, longitude: 73.8250 },
  { code: 'AUN', name: 'Aundh Gaon', latitude: 18.5622, longitude: 73.8071 },
  { code: 'BAN', name: 'Baner Phata', latitude: 18.5590, longitude: 73.7768 },
  { code: 'BAL', name: 'Balewadi Stadium', latitude: 18.5679, longitude: 73.7714 },
  { code: 'WAK', name: 'Wakad Chowk', latitude: 18.5975, longitude: 73.7623 },
  { code: 'HIN', name: 'Hinjawadi Phase 1', latitude: 18.5912, longitude: 73.7389 },
  { code: 'SWG', name: 'Swargate', latitude: 18.5013, longitude: 73.8580 },
  { code: 'KAT', name: 'Katraj Depot', latitude: 18.4529, longitude: 73.8600 },
  { code: 'BIB', name: 'Bibvewadi Corner', latitude: 18.4749, longitude: 73.8636 },
  { code: 'HAD', name: 'Hadapsar Gadital', latitude: 18.5089, longitude: 73.9260 },
  { code: 'MAG', name: 'Magarpatta Gate', latitude: 18.5150, longitude: 73.9270 },
  { code: 'KHA', name: 'Kharadi Bypass', latitude: 18.5510, longitude: 73.9410 },
  { code: 'VIM', name: 'Viman Nagar Chowk', latitude: 18.5679, longitude: 73.9143 },
  { code: 'YER', name: 'Yerawada Jail Road', latitude: 18.5490, longitude: 73.8790 },
];

/**
 * Three routes, deliberately overlapping: SHV, SWG and YER are each served by
 * more than one, which is what exercises the multi-route stop view (FR-C3).
 *
 * `offset` is minutes from the start of the trip — the timetable FR-A3 measures
 * delay against, and the ETA engine's fallback before a leg has history.
 */
const ROUTES = [
  {
    code: 'R1',
    name: 'Shivajinagar — Hinjawadi',
    description: 'IT corridor express via Aundh and Wakad.',
    stops: [
      ['SHV', 0], ['UNI', 8], ['AUN', 16], ['BAN', 24],
      ['BAL', 30], ['WAK', 42], ['HIN', 52],
    ],
  },
  {
    code: 'R2',
    name: 'Katraj — Kharadi',
    description: 'Cross-city link through Swargate and Hadapsar.',
    stops: [
      ['KAT', 0], ['BIB', 9], ['SWG', 18], ['HAD', 31],
      ['MAG', 37], ['KHA', 48],
    ],
  },
  {
    code: 'R3',
    name: 'Swargate — Viman Nagar',
    description: 'Airport road service via Yerawada.',
    stops: [
      ['SWG', 0], ['SHV', 11], ['YER', 20], ['VIM', 32],
    ],
  },
];

const DRIVER_ROUTES = {
  'suresh@sptos.local': ['R1', 'R3'],
  'anil@sptos.local': ['R2', 'R3'],
};

/** Departure times seeded per day, chosen to straddle both peaks and the lull. */
const DEPARTURE_HOURS = [7.25, 9.5, 13.0, 18.25];
const HISTORY_DAYS = 14;

/**
 * Seeded PRNG — a re-seed produces the same history, so a number that looked odd
 * on the dashboard can actually be chased down.
 */
function createRandom(seed = 20260826) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Traffic multiplier on the scheduled leg time — this is what makes the peaks visible. */
function congestion(hour) {
  if (hour >= 7 && hour < 11) return 1.35;
  if (hour >= 17 && hour < 21) return 1.45;
  if (hour >= 11 && hour < 16) return 1.05;
  return 0.92;
}

/** Crowding follows the same curve; drivers report what they actually see. */
function occupancyFor(hour, random) {
  const roll = random();
  if (hour >= 7 && hour < 11) return roll < 0.45 ? 'full' : 'standing_only';
  if (hour >= 17 && hour < 21) return roll < 0.55 ? 'standing_only' : 'full';
  if (hour >= 11 && hour < 16) return roll < 0.7 ? 'seats_free' : 'standing_only';
  return roll < 0.6 ? 'empty' : 'seats_free';
}

const TABLES = [
  'eta_predictions',
  'issue_reports',
  'alert_subscriptions',
  'favourites',
  'driver_positions',
  'checkins',
  'trips',
  'driver_assignments',
  'route_stops',
  'stops',
  'routes',
  'users',
];

async function resetData(log) {
  await query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  log('cleared existing data');
}

/** Idempotent so `npm run seed` twice does not duplicate the catalogue. */
async function seedCatalogue() {
  const passwordHash = await hashPassword(DEV_PASSWORD);

  const users = new Map();
  for (const user of USERS) {
    const row = await queryOne(
      `INSERT INTO users (name, email, password_hash, role, phone)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
       RETURNING id`,
      [user.name, user.email, passwordHash, user.role, user.phone],
    );
    users.set(user.email, Number(row.id));
  }

  const stops = new Map();
  for (const stop of STOPS) {
    const row = await queryOne(
      `INSERT INTO stops (code, name, latitude, longitude)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name,
                                        latitude = EXCLUDED.latitude,
                                        longitude = EXCLUDED.longitude
       RETURNING id`,
      [stop.code, stop.name, stop.latitude, stop.longitude],
    );
    stops.set(stop.code, Number(row.id));
  }

  const routes = new Map();
  for (const route of ROUTES) {
    const row = await queryOne(
      `INSERT INTO routes (code, name, description, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name,
                                        description = EXCLUDED.description
       RETURNING id`,
      [route.code, route.name, route.description],
    );
    const routeId = Number(row.id);
    routes.set(route.code, routeId);

    await query('DELETE FROM route_stops WHERE route_id = $1', [routeId]);
    for (const [seq, [code, offsetMinutes]] of route.stops.entries()) {
      await query(
        `INSERT INTO route_stops (route_id, stop_id, seq, scheduled_offset_seconds)
         VALUES ($1, $2, $3, $4)`,
        [routeId, stops.get(code), seq + 1, offsetMinutes * 60],
      );
    }
  }

  for (const [email, codes] of Object.entries(DRIVER_ROUTES)) {
    for (const code of codes) {
      await query(
        `INSERT INTO driver_assignments (driver_id, route_id) VALUES ($1, $2)
         ON CONFLICT (driver_id, route_id) DO NOTHING`,
        [users.get(email), routes.get(code)],
      );
    }
  }

  return { users, stops, routes };
}

/** Ordered stop ids and scheduled offsets for a route, straight from the DB. */
async function routeLegs(routeId) {
  const { rows } = await query(
    `SELECT rs.seq, rs.stop_id, rs.scheduled_offset_seconds
       FROM route_stops rs WHERE rs.route_id = $1 ORDER BY rs.seq`,
    [routeId],
  );
  return rows.map((row) => ({
    seq: Number(row.seq),
    stopId: Number(row.stop_id),
    offsetSeconds: Number(row.scheduled_offset_seconds),
  }));
}

/**
 * Writes one completed trip: a check-in per stop, spaced by the scheduled leg
 * time scaled for traffic and jittered. These rows are what
 * `segment_travel_samples` averages into the ETAs.
 */
async function seedTrip({ routeId, driverId, legs, departAt, random }) {
  // Timings first, so the trip row can record when it genuinely finished.
  let clock = departAt.getTime();
  const events = legs.map((leg, index) => {
    if (index > 0) {
      const scheduled = leg.offsetSeconds - legs[index - 1].offsetSeconds;
      const hour = new Date(clock).getHours();
      const jitter = 0.88 + random() * 0.24;
      clock += Math.round(scheduled * congestion(hour) * jitter) * 1000;
    }
    return {
      ...leg,
      recordedAt: new Date(clock),
      occupancy: occupancyFor(new Date(clock).getHours(), random),
    };
  });

  const trip = await queryOne(
    `INSERT INTO trips (route_id, driver_id, status, scheduled_start_at, started_at, ended_at)
     VALUES ($1, $2, 'completed', $3::timestamptz, $3::timestamptz, $4::timestamptz)
     RETURNING id`,
    [routeId, driverId, departAt.toISOString(), events.at(-1).recordedAt.toISOString()],
  );

  for (const event of events) {
    await query(
      `INSERT INTO checkins (trip_id, stop_id, seq, occupancy, event, recorded_at)
       VALUES ($1, $2, $3, $4, 'departed', $5::timestamptz)`,
      [trip.id, event.stopId, event.seq, event.occupancy, event.recordedAt.toISOString()],
    );
  }

  return Number(trip.id);
}

/**
 * A bus part-way along its route whose last check-in is three minutes old, so
 * the live tracker, the ETA panel and the crowding badge all have something real
 * to render the moment the seed finishes.
 *
 * Times are walked *backwards* from now rather than forwards from a start time:
 * that keeps the newest check-in inside the staleness window no matter what hour
 * the seed happens to be run at, which is the difference between a demo that
 * shows live ETAs and one that shows "No recent data".
 */
async function seedActiveTrip({ routeId, driverId, legs, random }) {
  const stopsDone = Math.min(3, legs.length - 1);
  const times = [];
  let clock = Date.now() - 3 * 60_000;

  for (let index = stopsDone - 1; index >= 0; index -= 1) {
    times[index] = new Date(clock);
    if (index > 0) {
      const scheduled = legs[index].offsetSeconds - legs[index - 1].offsetSeconds;
      clock -= Math.round(scheduled * congestion(new Date(clock).getHours())) * 1000;
    }
  }

  const startedAt = new Date(times[0].getTime() - 60_000);
  const trip = await queryOne(
    `INSERT INTO trips (route_id, driver_id, status, scheduled_start_at, started_at)
     VALUES ($1, $2, 'active', $3::timestamptz, $3::timestamptz)
     RETURNING id`,
    [routeId, driverId, startedAt.toISOString()],
  );

  for (let index = 0; index < stopsDone; index += 1) {
    await query(
      `INSERT INTO checkins (trip_id, stop_id, seq, occupancy, event, recorded_at)
       VALUES ($1, $2, $3, $4, 'departed', $5::timestamptz)`,
      [
        trip.id,
        legs[index].stopId,
        legs[index].seq,
        occupancyFor(times[index].getHours(), random),
        times[index].toISOString(),
      ],
    );
  }

  return Number(trip.id);
}

async function seedHistory({ users, routes }, log) {
  const random = createRandom();
  const drivers = Object.entries(DRIVER_ROUTES).flatMap(([email, codes]) =>
    codes.map((code) => ({ code, driverId: users.get(email) })),
  );

  let trips = 0;
  for (const route of ROUTES) {
    const routeId = routes.get(route.code);
    const legs = await routeLegs(routeId);
    const crew = drivers.filter((entry) => entry.code === route.code);

    for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo -= 1) {
      for (const [slot, hour] of DEPARTURE_HOURS.entries()) {
        const departAt = new Date();
        departAt.setDate(departAt.getDate() - daysAgo);
        departAt.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);

        const driver = crew[(daysAgo + slot) % crew.length];
        await seedTrip({ routeId, driverId: driver.driverId, legs, departAt, random });
        trips += 1;
      }
    }
  }

  // One bus still running, on the route with the most stops ahead of it.
  const liveRoute = ROUTES[0];
  const liveLegs = await routeLegs(routes.get(liveRoute.code));
  await seedActiveTrip({
    routeId: routes.get(liveRoute.code),
    driverId: users.get('suresh@sptos.local'),
    legs: liveLegs,
    random,
  });

  log(`seeded ${trips} completed trips over ${HISTORY_DAYS} days, plus 1 active trip`);
}

/** Commuter-side data, so the favourites and triage screens are not blank. */
async function seedCommuterData({ users, routes, stops }) {
  const riya = users.get('riya@sptos.local');

  await query(
    `INSERT INTO favourites (user_id, route_id, stop_id) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, route_id, stop_id) DO NOTHING`,
    [riya, routes.get('R1'), stops.get('AUN')],
  );

  await query(
    `INSERT INTO alert_subscriptions (user_id, route_id, stop_id, minutes_before)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, route_id, stop_id) DO NOTHING`,
    [riya, routes.get('R1'), stops.get('BAN'), config.arrivalAlertMinutes],
  );

  await query(
    `INSERT INTO issue_reports (user_id, route_id, stop_id, kind, note, status)
     VALUES ($1, $2, $3, 'delay', $4, 'open')`,
    [riya, routes.get('R2'), stops.get('HAD'), 'Waited 20 minutes past the estimate.'],
  );
}

export async function seed({ reset = false, log = console.log } = {}) {
  await migrate({ log: false });
  if (reset) await resetData(log);

  const catalogue = await seedCatalogue();
  log(`catalogue: ${USERS.length} users, ${STOPS.length} stops, ${ROUTES.length} routes`);

  await seedHistory(catalogue, log);
  await seedCommuterData(catalogue);

  log(`sign in with any of: ${USERS.map((user) => user.email).join(', ')}`);
  log(`password: ${DEV_PASSWORD}`);
  return catalogue;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const reset = process.argv.includes('--reset');
  seed({ reset })
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('[seed] failed:', err);
      await closeDb().catch(() => {});
      process.exit(1);
    });
}
