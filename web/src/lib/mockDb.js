/**
 * Client-side Database Engine & Mock API Provider.
 *
 * When the app is deployed on static hosting (like Firebase Hosting) without a separate
 * live backend server configured, or when the remote API is unreachable, this in-browser
 * database handles authentication, registration, catalog queries, driver trips, check-ins,
 * alerts, favourites, and admin analytics directly in the browser via localStorage!
 */
import {
  ISSUE_KINDS,
  OCCUPANCY_LEVELS,
  TIME_BANDS,
  freshness,
  occupancyLevel,
} from '@sptos/shared';
import { ApiError } from './api.js';

const STORAGE_KEY = 'sptos_local_db_v1';

const INITIAL_STOPS = [
  { id: 1, code: 'SHV', name: 'Shivajinagar Bus Stand', latitude: 18.5308, longitude: 73.8478 },
  { id: 2, code: 'UNI', name: 'University Circle', latitude: 18.5523, longitude: 73.825 },
  { id: 3, code: 'AUN', name: 'Aundh Gaon', latitude: 18.5622, longitude: 73.8071 },
  { id: 4, code: 'BAN', name: 'Baner Phata', latitude: 18.559, longitude: 73.7768 },
  { id: 5, code: 'BAL', name: 'Balewadi Stadium', latitude: 18.5679, longitude: 73.7714 },
  { id: 6, code: 'WAK', name: 'Wakad Chowk', latitude: 18.5975, longitude: 73.7623 },
  { id: 7, code: 'HIN', name: 'Hinjawadi Phase 1', latitude: 18.5912, longitude: 73.7389 },
  { id: 8, code: 'SWG', name: 'Swargate', latitude: 18.5013, longitude: 73.858 },
  { id: 9, code: 'KAT', name: 'Katraj Depot', latitude: 18.4529, longitude: 73.86 },
  { id: 10, code: 'BIB', name: 'Bibvewadi Corner', latitude: 18.4749, longitude: 73.8636 },
  { id: 11, code: 'HAD', name: 'Hadapsar Gadital', latitude: 18.5089, longitude: 73.926 },
  { id: 12, code: 'MAG', name: 'Magarpatta Gate', latitude: 18.515, longitude: 73.927 },
  { id: 13, code: 'KHA', name: 'Kharadi Bypass', latitude: 18.551, longitude: 73.941 },
  { id: 14, code: 'VIM', name: 'Viman Nagar Chowk', latitude: 18.5679, longitude: 73.9143 },
  { id: 15, code: 'YER', name: 'Yerawada Jail Road', latitude: 18.549, longitude: 73.879 },
];

const INITIAL_ROUTES = [
  {
    id: 1,
    code: 'R1',
    name: 'Shivajinagar — Hinjawadi',
    description: 'IT corridor express via Aundh and Wakad.',
    isActive: true,
    stops: [
      { seq: 1, stopId: 1, scheduledOffsetSeconds: 0 },
      { seq: 2, stopId: 2, scheduledOffsetSeconds: 8 * 60 },
      { seq: 3, stopId: 3, scheduledOffsetSeconds: 16 * 60 },
      { seq: 4, stopId: 4, scheduledOffsetSeconds: 24 * 60 },
      { seq: 5, stopId: 5, scheduledOffsetSeconds: 30 * 60 },
      { seq: 6, stopId: 6, scheduledOffsetSeconds: 42 * 60 },
      { seq: 7, stopId: 7, scheduledOffsetSeconds: 52 * 60 },
    ],
  },
  {
    id: 2,
    code: 'R2',
    name: 'Katraj — Kharadi',
    description: 'Cross-city link through Swargate and Hadapsar.',
    isActive: true,
    stops: [
      { seq: 1, stopId: 9, scheduledOffsetSeconds: 0 },
      { seq: 2, stopId: 10, scheduledOffsetSeconds: 9 * 60 },
      { seq: 3, stopId: 8, scheduledOffsetSeconds: 18 * 60 },
      { seq: 4, stopId: 11, scheduledOffsetSeconds: 31 * 60 },
      { seq: 5, stopId: 12, scheduledOffsetSeconds: 37 * 60 },
      { seq: 6, stopId: 13, scheduledOffsetSeconds: 48 * 60 },
    ],
  },
  {
    id: 3,
    code: 'R3',
    name: 'Swargate — Viman Nagar',
    description: 'Airport road service via Yerawada.',
    isActive: true,
    stops: [
      { seq: 1, stopId: 8, scheduledOffsetSeconds: 0 },
      { seq: 2, stopId: 1, scheduledOffsetSeconds: 11 * 60 },
      { seq: 3, stopId: 15, scheduledOffsetSeconds: 20 * 60 },
      { seq: 4, stopId: 14, scheduledOffsetSeconds: 32 * 60 },
    ],
  },
];

const INITIAL_USERS = [
  {
    id: 1,
    name: 'Krishna Gupta',
    email: 'krishna@sptos.local',
    password: 'krishnagg',
    role: 'admin',
    phone: '+91 90000 00001',
    isActive: true,
    assignedRouteIds: [1, 2, 3],
  },
  {
    id: 2,
    name: 'Suresh Patil',
    email: 'suresh@sptos.local',
    password: 'sptos1234',
    role: 'driver',
    phone: '+91 90000 00002',
    isActive: true,
    assignedRouteIds: [1, 3],
  },
  {
    id: 3,
    name: 'Anil Kamble',
    email: 'anil@sptos.local',
    password: 'sptos1234',
    role: 'driver',
    phone: '+91 90000 00003',
    isActive: true,
    assignedRouteIds: [2, 3],
  },
  {
    id: 4,
    name: 'Riya Sharma',
    email: 'riya@sptos.local',
    password: 'sptos1234',
    role: 'commuter',
    phone: '+91 90000 00004',
    isActive: true,
    assignedRouteIds: [],
  },
];

function createInitialDb() {
  const now = Date.now();
  return {
    users: [...INITIAL_USERS],
    stops: [...INITIAL_STOPS],
    routes: [...INITIAL_ROUTES],
    trips: [
      {
        id: 101,
        routeId: 1,
        driverId: 2,
        driverName: 'Suresh Patil',
        status: 'active',
        startedAt: new Date(now - 14 * 60 * 1000).toISOString(),
        endedAt: null,
      },
    ],
    checkins: [
      {
        id: 1,
        tripId: 101,
        stopId: 1,
        seq: 1,
        occupancy: 'empty',
        event: 'departed',
        recordedAt: new Date(now - 14 * 60 * 1000).toISOString(),
        clientUuid: 'init-1',
      },
      {
        id: 2,
        tripId: 101,
        stopId: 2,
        seq: 2,
        occupancy: 'seats_free',
        event: 'departed',
        recordedAt: new Date(now - 7 * 60 * 1000).toISOString(),
        clientUuid: 'init-2',
      },
      {
        id: 3,
        tripId: 101,
        stopId: 3,
        seq: 3,
        occupancy: 'seats_free',
        event: 'departed',
        recordedAt: new Date(now - 2 * 60 * 1000).toISOString(),
        clientUuid: 'init-3',
      },
    ],
    favourites: [
      { id: 1, userId: 4, routeId: 1, stopId: 3 },
      { id: 2, userId: 4, routeId: 1, stopId: 4 },
    ],
    alerts: [
      { id: 1, userId: 4, routeId: 1, stopId: 4, minutesBefore: 5, notifiedAt: null, tripId: 101 },
    ],
    issues: [
      {
        id: 1,
        userId: 4,
        routeId: 2,
        stopId: 11,
        tripId: null,
        kind: 'delay',
        note: 'Waited 20 minutes past the estimate.',
        status: 'open',
        createdAt: new Date(now - 3600 * 1000).toISOString(),
      },
    ],
  };
}

function loadDb() {
  try {
    let db;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      db = createInitialDb();
    } else {
      db = JSON.parse(raw);
    }
    if (!Array.isArray(db.users)) db.users = [];
    for (const initUser of INITIAL_USERS) {
      const existing = db.users.find((u) => u.email.toLowerCase() === initUser.email.toLowerCase());
      if (!existing) {
        db.users.push({ ...initUser });
      } else {
        existing.password = initUser.password;
        existing.role = initUser.role;
        existing.isActive = true;
        if (!existing.assignedRouteIds) existing.assignedRouteIds = initUser.assignedRouteIds || [];
      }
    }
    if (!Array.isArray(db.stops) || db.stops.length === 0) db.stops = [...INITIAL_STOPS];
    if (!Array.isArray(db.routes) || db.routes.length === 0) db.routes = [...INITIAL_ROUTES];
    if (!Array.isArray(db.trips)) db.trips = [];
    if (!Array.isArray(db.checkins)) db.checkins = [];
    if (!Array.isArray(db.issues)) db.issues = [];
    if (!Array.isArray(db.favourites)) db.favourites = [];
    if (!Array.isArray(db.alerts)) db.alerts = [];

    // Ensure at least one active trip exists for live demonstration
    if (!db.trips.some((t) => t.status === 'active')) {
      const initial = createInitialDb();
      db.trips.push(...initial.trips);
      db.checkins.push(...initial.checkins);
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {}
    return db;
  } catch {
    const initial = createInitialDb();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    } catch {}
    return initial;
  }
}

function saveDb(db) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (err) {
    console.error('Failed to save to local DB', err);
  }
}

function getUserFromToken(db, token) {
  if (!token) return null;
  const match = /^mock-token-(\d+)$/.exec(token);
  if (match) {
    const id = Number(match[1]);
    return db.users.find((u) => u.id === id && u.isActive) ?? null;
  }
  return db.users.find((u) => u.role === 'admin') ?? db.users[0] ?? null;
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone ?? null,
  };
}

function buildRouteDetail(db, route) {
  const stops = route.stops
    .map((rs) => {
      const stop = db.stops.find((s) => s.id === rs.stopId);
      if (!stop) return null;
      return {
        seq: rs.seq,
        stopId: stop.id,
        code: stop.code,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
        scheduledOffsetSeconds: rs.scheduledOffsetSeconds,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.seq - b.seq);

  return {
    route: {
      id: route.id,
      code: route.code,
      name: route.name,
      description: route.description,
      isActive: route.isActive,
    },
    stops,
  };
}

function buildTripProgress(db, trip) {
  const route = db.routes.find((r) => r.id === trip.routeId);
  const routeDetail = route ? buildRouteDetail(db, route) : { stops: [] };
  const stops = routeDetail.stops;
  const checkins = db.checkins
    .filter((c) => c.tripId === trip.id && !c.voidedAt)
    .sort((a, b) => a.seq - b.seq);

  const lastSeq = checkins.reduce((max, c) => Math.max(max, c.seq), 0);
  const nextStop = stops.find((s) => s.seq === lastSeq + 1) ?? null;

  return {
    trip: {
      tripId: trip.id,
      routeId: trip.routeId,
      routeCode: route?.code ?? 'R?',
      routeName: route?.name ?? 'Unknown',
      driverName: trip.driverName,
      status: trip.status,
      startedAt: trip.startedAt,
      lastOccupancy: checkins.at(-1)?.occupancy ?? null,
    },
    stops,
    checkins,
    nextStop,
    stopsRemaining: Math.max(0, stops.length - lastSeq),
    isComplete: stops.length > 0 && lastSeq >= stops.length,
  };
}

function estimateArrivals({ fromSeq, departedAt, stops }) {
  const now = Date.now();
  const depTime = departedAt ? new Date(departedAt).getTime() : now;
  const remaining = stops.filter((s) => s.seq > fromSeq);

  let cumulativeSeconds = 0;
  const fromStop = stops.find((s) => s.seq === fromSeq);
  const baseOffset = fromStop ? fromStop.scheduledOffsetSeconds : 0;

  return remaining.map((s) => {
    const legOffset = s.scheduledOffsetSeconds - baseOffset;
    cumulativeSeconds = Math.max(cumulativeSeconds + 120, legOffset);
    const etaMs = depTime + cumulativeSeconds * 1000;
    const diffSeconds = Math.round((etaMs - now) / 1000);

    return {
      stopId: s.stopId,
      stopName: s.name,
      seq: s.seq,
      etaAt: new Date(etaMs).toISOString(),
      etaSeconds: Math.max(30, diffSeconds),
      confidence: diffSeconds < 600 ? 'high' : 'medium',
      isOverdue: diffSeconds < 0,
      rangeSeconds: 120,
    };
  });
}

function buildRouteLive(db, routeId) {
  const route = db.routes.find((r) => r.id === routeId);
  if (!route) return null;

  const { stops } = buildRouteDetail(db, route);
  const activeTrips = db.trips.filter((t) => t.routeId === routeId && t.status === 'active');

  const trips = activeTrips.map((trip) => {
    const checkins = db.checkins
      .filter((c) => c.tripId === trip.id && !c.voidedAt)
      .sort((a, b) => a.seq - b.seq);
    const lastCheckin = checkins.at(-1) ?? null;
    const lastSeq = lastCheckin?.seq ?? 0;
    const lastStop = stops.find((s) => s.seq === lastSeq) ?? null;
    const nextStop = stops.find((s) => s.seq === lastSeq + 1) ?? null;
    const lastRecordedAt = lastCheckin?.recordedAt ?? trip.startedAt;

    const etas = estimateArrivals({
      fromSeq: lastSeq,
      departedAt: lastRecordedAt,
      stops,
    });

    const fresh = freshness(lastRecordedAt, { now: Date.now(), staleAfterSeconds: 480 });

    const currentPos = lastStop
      ? {
          latitude: lastStop.latitude,
          longitude: lastStop.longitude,
          source: 'checkin',
          reportedAt: lastRecordedAt,
        }
      : stops[0]
        ? {
            latitude: stops[0].latitude,
            longitude: stops[0].longitude,
            source: 'route_start',
            reportedAt: null,
          }
        : null;

    return {
      tripId: trip.id,
      routeId: trip.routeId,
      driverName: trip.driverName,
      status: trip.status,
      startedAt: trip.startedAt,
      lastCheckin: lastStop
        ? {
            stopId: lastStop.stopId,
            stopName: lastStop.name,
            seq: lastSeq,
            occupancy: lastCheckin?.occupancy ?? 'empty',
            occupancyLabel: occupancyLevel(lastCheckin?.occupancy ?? 'empty')?.label ?? null,
            recordedAt: lastRecordedAt,
          }
        : null,
      nextStop: nextStop ? { stopId: nextStop.stopId, stopName: nextStop.name, seq: nextStop.seq } : null,
      position: currentPos,
      progress: {
        stopsCompleted: lastSeq,
        totalStops: stops.length,
        fraction: stops.length ? Number((lastSeq / stops.length).toFixed(3)) : 0,
      },
      checkinCount: checkins.length,
      etaAvailable: !fresh.isStale,
      etaUnavailableReason: fresh.isStale ? 'stale_data' : null,
      etas,
      freshness: fresh,
    };
  });

  return {
    route: {
      id: route.id,
      code: route.code,
      name: route.name,
      description: route.description,
      isActive: route.isActive,
    },
    stops,
    trips,
    staleAfterSeconds: 480,
    activeTripCount: trips.length,
  };
}

export async function handleMockRequest(method, path, body, params, token) {
  const db = loadDb();
  const normalizedPath = path.replace(/\/$/, '');

  // 1. GET /api/meta
  if (method === 'GET' && normalizedPath === '/api/meta') {
    return {
      occupancyLevels: OCCUPANCY_LEVELS,
      timeBands: TIME_BANDS,
      issueKinds: ISSUE_KINDS,
      staleAfterSeconds: 480,
      arrivalAlertMinutes: 5,
      minCheckinsForEta: 1,
    };
  }

  // 2. POST /api/auth/register
  if (method === 'POST' && normalizedPath === '/api/auth/register') {
    const { name, email, password, phone } = body || {};
    if (!email || !password || !name) {
      throw new ApiError(400, 'Name, email and password are required.');
    }
    const cleanEmail = email.trim().toLowerCase();
    const existing = db.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      throw new ApiError(409, 'An account with that email already exists.');
    }
    const newUser = {
      id: Date.now(),
      name: name.trim(),
      email: cleanEmail,
      password: password,
      role: 'commuter',
      phone: phone?.trim() || null,
      isActive: true,
      assignedRouteIds: [],
    };
    db.users.push(newUser);
    saveDb(db);
    const mockToken = `mock-token-${newUser.id}`;
    return { token: mockToken, user: publicUser(newUser) };
  }

  // 3. POST /api/auth/login
  if (method === 'POST' && normalizedPath === '/api/auth/login') {
    const { email, password } = body || {};
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user || user.password !== password) {
      throw new ApiError(401, 'Email or password is incorrect.');
    }
    if (!user.isActive) {
      throw new ApiError(403, 'This account has been deactivated.');
    }
    const mockToken = `mock-token-${user.id}`;
    return { token: mockToken, user: publicUser(user) };
  }

  // 4. GET /api/auth/me
  if (method === 'GET' && normalizedPath === '/api/auth/me') {
    const user = getUserFromToken(db, token);
    if (!user) throw new ApiError(401, 'Account no longer available.');
    return { user: publicUser(user) };
  }

  // 5. GET /api/routes
  if (method === 'GET' && normalizedPath === '/api/routes') {
    const q = (params?.q || '').toLowerCase();
    const routes = db.routes
      .filter((r) => r.isActive)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
      .map((r) => {
        const activeTrips = db.trips.filter((t) => t.routeId === r.id && t.status === 'active').length;
        return {
          id: r.id,
          code: r.code,
          name: r.name,
          description: r.description,
          stopCount: r.stops.length,
          activeTrips,
        };
      });
    return { routes };
  }

  // 6. GET /api/routes/:id/live
  const routeLiveMatch = /^\/api\/routes\/(\d+)\/live$/.exec(normalizedPath);
  if (method === 'GET' && routeLiveMatch) {
    const routeId = Number(routeLiveMatch[1]);
    const live = buildRouteLive(db, routeId);
    if (!live) throw new ApiError(404, 'Route not found.');
    return live;
  }

  // 7. GET /api/routes/:id
  const routeMatch = /^\/api\/routes\/(\d+)$/.exec(normalizedPath);
  if (method === 'GET' && routeMatch) {
    const routeId = Number(routeMatch[1]);
    const route = db.routes.find((r) => r.id === routeId);
    if (!route) throw new ApiError(404, 'Route not found.');
    return buildRouteDetail(db, route);
  }

  // 8. GET /api/stops
  if (method === 'GET' && normalizedPath === '/api/stops') {
    const q = (params?.q || '').toLowerCase();
    const stops = db.stops
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      .map((s) => {
        const routesServing = db.routes
          .filter((r) => r.isActive && r.stops.some((rs) => rs.stopId === s.id))
          .map((r) => ({ id: r.id, code: r.code, name: r.name }));
        return {
          id: s.id,
          code: s.code,
          name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          routes: routesServing,
        };
      });
    return { stops };
  }

  // 9. GET /api/stops/:id/live
  const stopLiveMatch = /^\/api\/stops\/(\d+)\/live$/.exec(normalizedPath);
  if (method === 'GET' && stopLiveMatch) {
    const stopId = Number(stopLiveMatch[1]);
    const stop = db.stops.find((s) => s.id === stopId);
    if (!stop) throw new ApiError(404, 'Stop not found.');

    const routeFilter = params?.routeId ? Number(params.routeId) : null;
    const servingRoutes = db.routes.filter(
      (r) => r.isActive && r.stops.some((rs) => rs.stopId === stopId) && (!routeFilter || r.id === routeFilter),
    );

    const arrivals = [];
    for (const r of servingRoutes) {
      const live = buildRouteLive(db, r.id);
      for (const trip of live.trips) {
        const eta = trip.etas.find((e) => e.stopId === stopId);
        if (eta) {
          arrivals.push({
            tripId: trip.tripId,
            routeId: r.id,
            routeCode: r.code,
            routeName: r.name,
            etaAt: eta.etaAt,
            etaSeconds: eta.etaSeconds,
            confidence: eta.confidence,
            isOverdue: eta.isOverdue,
            rangeSeconds: eta.rangeSeconds,
            occupancy: trip.lastCheckin?.occupancy ?? 'empty',
            occupancyLabel: trip.lastCheckin?.occupancyLabel ?? null,
            freshness: trip.freshness,
          });
        }
      }
    }

    return {
      stop: {
        id: stop.id,
        code: stop.code,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
      },
      arrivals,
      staleAfterSeconds: 480,
    };
  }

  // 10. GET /api/favourites
  if (method === 'GET' && normalizedPath === '/api/favourites') {
    const user = getUserFromToken(db, token);
    const userId = user?.id ?? 4;
    const favs = db.favourites
      .filter((f) => f.userId === userId)
      .map((f) => {
        const route = db.routes.find((r) => r.id === f.routeId);
        const stop = db.stops.find((s) => s.id === f.stopId);
        return {
          id: f.id,
          routeId: f.routeId,
          routeCode: route?.code ?? 'R?',
          routeName: route?.name ?? 'Unknown',
          stopId: f.stopId,
          stopCode: stop?.code ?? 'S?',
          stopName: stop?.name ?? 'Unknown',
        };
      });
    return { favourites: favs };
  }

  // 11. POST /api/favourites
  if (method === 'POST' && normalizedPath === '/api/favourites') {
    const user = getUserFromToken(db, token);
    const userId = user?.id ?? 4;
    const { routeId, stopId } = body;
    const existing = db.favourites.find(
      (f) => f.userId === userId && f.routeId === routeId && f.stopId === stopId,
    );
    if (existing) return { id: existing.id };
    const newFav = { id: Date.now(), userId, routeId, stopId };
    db.favourites.push(newFav);
    saveDb(db);
    return { id: newFav.id };
  }

  // 12. DELETE /api/favourites/:id
  const favDelMatch = /^\/api\/favourites\/(\d+)$/.exec(normalizedPath);
  if (method === 'DELETE' && favDelMatch) {
    const id = Number(favDelMatch[1]);
    db.favourites = db.favourites.filter((f) => f.id !== id);
    saveDb(db);
    return null;
  }

  // 13. GET /api/alerts
  if (method === 'GET' && normalizedPath === '/api/alerts') {
    const user = getUserFromToken(db, token);
    const userId = user?.id ?? 4;
    const alerts = db.alerts
      .filter((a) => a.userId === userId)
      .map((a) => {
        const route = db.routes.find((r) => r.id === a.routeId);
        const stop = db.stops.find((s) => s.id === a.stopId);
        return {
          id: a.id,
          routeId: a.routeId,
          routeCode: route?.code ?? 'R?',
          routeName: route?.name ?? 'Unknown',
          stopId: a.stopId,
          stopCode: stop?.code ?? 'S?',
          stopName: stop?.name ?? 'Unknown',
          minutesBefore: a.minutesBefore,
          notifiedAt: a.notifiedAt,
          tripId: a.tripId,
        };
      });
    return { alerts, defaultMinutesBefore: 5 };
  }

  // 14. POST /api/alerts
  if (method === 'POST' && normalizedPath === '/api/alerts') {
    const user = getUserFromToken(db, token);
    const userId = user?.id ?? 4;
    const { routeId, stopId, minutesBefore } = body;
    let alert = db.alerts.find(
      (a) => a.userId === userId && a.routeId === routeId && a.stopId === stopId,
    );
    if (alert) {
      alert.minutesBefore = minutesBefore || 5;
    } else {
      alert = { id: Date.now(), userId, routeId, stopId, minutesBefore: minutesBefore || 5 };
      db.alerts.push(alert);
    }
    saveDb(db);
    const route = db.routes.find((r) => r.id === alert.routeId);
    const stop = db.stops.find((s) => s.id === alert.stopId);
    return {
      alert: {
        id: alert.id,
        routeId: alert.routeId,
        routeCode: route?.code ?? 'R?',
        routeName: route?.name ?? 'Unknown',
        stopId: alert.stopId,
        stopName: stop?.name ?? 'Unknown',
        minutesBefore: alert.minutesBefore,
        notifiedAt: null,
        tripId: null,
      },
    };
  }

  // 15. DELETE /api/alerts/:id
  const alertDelMatch = /^\/api\/alerts\/(\d+)$/.exec(normalizedPath);
  if (method === 'DELETE' && alertDelMatch) {
    const id = Number(alertDelMatch[1]);
    db.alerts = db.alerts.filter((a) => a.id !== id);
    saveDb(db);
    return null;
  }

  // 16. POST /api/issues
  if (method === 'POST' && normalizedPath === '/api/issues') {
    const user = getUserFromToken(db, token);
    const newIssue = {
      id: Date.now(),
      userId: user?.id ?? 4,
      kind: body.kind,
      routeId: body.routeId || null,
      stopId: body.stopId || null,
      tripId: body.tripId || null,
      note: body.note || null,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    db.issues.push(newIssue);
    saveDb(db);
    return { issue: newIssue };
  }

  // 17. GET /api/issues/mine
  if (method === 'GET' && normalizedPath === '/api/issues/mine') {
    const user = getUserFromToken(db, token);
    const userId = user?.id ?? 4;
    const issues = db.issues
      .filter((i) => i.userId === userId)
      .map((i) => {
        const route = db.routes.find((r) => r.id === i.routeId);
        const stop = db.stops.find((s) => s.id === i.stopId);
        return {
          id: i.id,
          kind: i.kind,
          note: i.note,
          status: i.status,
          createdAt: i.createdAt,
          routeCode: route?.code ?? null,
          stopName: stop?.name ?? null,
        };
      });
    return { issues };
  }

  // 18. Driver routes: GET /api/driver/assignments
  if (method === 'GET' && normalizedPath === '/api/driver/assignments') {
    const user = getUserFromToken(db, token);
    const routes = db.routes
      .filter((r) => r.isActive)
      .map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        stopCount: r.stops.length,
      }));
    return { routes };
  }

  // 19. Driver: GET /api/driver/active-trip
  if (method === 'GET' && normalizedPath === '/api/driver/active-trip') {
    const user = getUserFromToken(db, token);
    const trip = db.trips.find(
      (t) => (t.driverId === user?.id || user?.role === 'admin') && t.status === 'active',
    );
    if (!trip) return { trip: null };
    return buildTripProgress(db, trip);
  }

  // 20. Driver: POST /api/driver/trips
  if (method === 'POST' && normalizedPath === '/api/driver/trips') {
    const user = getUserFromToken(db, token);
    const route = db.routes.find((r) => r.id === body.routeId);
    if (!route) throw new ApiError(404, 'Route not found.');
    const newTrip = {
      id: Date.now(),
      routeId: route.id,
      driverId: user?.id ?? 2,
      driverName: user?.name ?? 'Driver',
      status: 'active',
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    db.trips.push(newTrip);
    saveDb(db);
    return buildTripProgress(db, newTrip);
  }

  // 21. Driver: POST /api/driver/trips/:id/checkins
  const checkinPostMatch = /^\/api\/driver\/trips\/(\d+)\/checkins$/.exec(normalizedPath);
  if (method === 'POST' && checkinPostMatch) {
    const tripId = Number(checkinPostMatch[1]);
    const trip = db.trips.find((t) => t.id === tripId);
    if (!trip) throw new ApiError(404, 'Trip not found.');
    const route = db.routes.find((r) => r.id === trip.routeId);
    const progress = buildTripProgress(db, trip);
    const targetStop = body.stopId
      ? progress.stops.find((s) => s.stopId === body.stopId)
      : progress.nextStop;

    if (!targetStop) throw new ApiError(400, 'No remaining stops on this trip.');

    const newCheckin = {
      id: Date.now(),
      tripId: trip.id,
      stopId: targetStop.stopId,
      seq: targetStop.seq,
      occupancy: body.occupancy || 'seats_free',
      event: body.event || 'departed',
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      clientUuid: body.clientUuid || `uuid-${Date.now()}`,
      recordedAt: body.recordedAt ? new Date(body.recordedAt).toISOString() : new Date().toISOString(),
    };
    db.checkins.push(newCheckin);
    saveDb(db);

    return {
      checkin: newCheckin,
      duplicate: false,
      alertsSent: 0,
      ...buildTripProgress(db, trip),
    };
  }

  // 22. Driver: POST /api/driver/trips/:id/checkins/batch
  const checkinBatchMatch = /^\/api\/driver\/trips\/(\d+)\/checkins\/batch$/.exec(normalizedPath);
  if (method === 'POST' && checkinBatchMatch) {
    const tripId = Number(checkinBatchMatch[1]);
    const trip = db.trips.find((t) => t.id === tripId);
    if (!trip) throw new ApiError(404, 'Trip not found.');
    const checkins = body.checkins || [];
    const results = [];
    for (const c of checkins) {
      const progress = buildTripProgress(db, trip);
      const targetStop = c.stopId
        ? progress.stops.find((s) => s.stopId === c.stopId)
        : progress.nextStop;
      if (targetStop) {
        const item = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          tripId: trip.id,
          stopId: targetStop.stopId,
          seq: targetStop.seq,
          occupancy: c.occupancy || 'seats_free',
          event: c.event || 'departed',
          clientUuid: c.clientUuid || `uuid-${Date.now()}`,
          recordedAt: c.recordedAt ? new Date(c.recordedAt).toISOString() : new Date().toISOString(),
        };
        db.checkins.push(item);
        results.push({ clientUuid: c.clientUuid, status: 'accepted', checkin: item });
      }
    }
    saveDb(db);
    return {
      results,
      accepted: results.length,
      duplicates: 0,
      rejected: 0,
      alertsSent: 0,
      ...buildTripProgress(db, trip),
    };
  }

  // 23. Driver: End trip /api/driver/trips/:id/end
  const endTripMatch = /^\/api\/driver\/trips\/(\d+)\/end$/.exec(normalizedPath);
  if (method === 'POST' && endTripMatch) {
    const tripId = Number(endTripMatch[1]);
    const trip = db.trips.find((t) => t.id === tripId);
    if (trip) {
      trip.status = 'completed';
      trip.endedAt = new Date().toISOString();
      saveDb(db);
    }
    return { trip: { tripId, status: 'completed' } };
  }

  // 24. Driver: Cancel trip /api/driver/trips/:id/cancel
  const cancelTripMatch = /^\/api\/driver\/trips\/(\d+)\/cancel$/.exec(normalizedPath);
  if (method === 'POST' && cancelTripMatch) {
    const tripId = Number(cancelTripMatch[1]);
    const trip = db.trips.find((t) => t.id === tripId);
    if (trip) {
      trip.status = 'cancelled';
      trip.endedAt = new Date().toISOString();
      saveDb(db);
    }
    return { trip: { tripId, status: 'cancelled' } };
  }

  // 25. Admin: GET /api/admin/live/network
  if (method === 'GET' && normalizedPath === '/api/admin/live/network') {
    const activeTrips = db.trips.filter((t) => t.status === 'active');
    const activeRouteIds = [...new Set(activeTrips.map((t) => t.routeId))];
    const routesToDisplay = activeRouteIds.length ? activeRouteIds : db.routes.slice(0, 1).map((r) => r.id);
    const routes = routesToDisplay.map((rid) => buildRouteLive(db, rid)).filter(Boolean);
    return {
      routes,
      activeTrips: routes.reduce((total, r) => total + r.trips.length, 0),
      generatedAt: new Date().toISOString(),
    };
  }

  // 26. Admin: GET /api/admin/analytics/operations
  if (method === 'GET' && normalizedPath === '/api/admin/analytics/operations') {
    const totalTrips = db.trips.length;
    const completedTrips = db.trips.filter((t) => t.status === 'completed').length;
    const activeTrips = db.trips.filter((t) => t.status === 'active').length;
    const cancelledTrips = db.trips.filter((t) => t.status === 'cancelled').length;

    return {
      window: { from: null, to: null },
      routeId: params?.routeId ? Number(params.routeId) : null,
      trips: {
        total: totalTrips || 12,
        active: activeTrips,
        completed: completedTrips || 11,
        cancelled: cancelledTrips,
      },
      checkinCoverage: {
        tripsMeasured: 48,
        averageShare: 0.94,
      },
      etaAccuracy: {
        resolvedPredictions: 35,
        maeSeconds: 120,
        medianAbsErrorSeconds: 95,
        biasSeconds: 15,
      },
      updateFreshness: {
        medianGapSeconds: 480,
      },
      adoption: {
        activeDrivers: db.users.filter((u) => u.role === 'driver' && u.isActive).length,
        registeredDrivers: db.users.filter((u) => u.role === 'driver').length,
        registeredCommuters: db.users.filter((u) => u.role === 'commuter').length,
        activeRoutes: db.routes.filter((r) => r.isActive).length,
        stops: db.stops.length,
        openIssues: db.issues.filter((i) => i.status === 'open').length,
      },
    };
  }

  // 27. Admin: GET /api/admin/analytics/demand
  if (method === 'GET' && normalizedPath === '/api/admin/analytics/demand') {
    const byStop = db.stops.slice(0, 12).map((s, idx) => ({
      stopId: s.id,
      stopCode: s.code,
      stopName: s.name,
      band: 'morning_peak',
      bandLabel: 'Morning Peak (08:00 - 11:00)',
      dayType: 'weekday',
      checkins: Math.max(12, 48 - idx * 3),
      avgLoadFactor: 0.72,
      crowdedCheckins: Math.max(2, 16 - idx),
      crowdedShare: 0.38,
    }));

    const byBand = [
      { band: 'early_morning', bandLabel: 'Early Morning (05:00 - 08:00)', dayType: 'weekday', checkins: 28, avgLoadFactor: 0.45, crowdedCheckins: 2 },
      { band: 'morning_peak', bandLabel: 'Morning Peak (08:00 - 11:00)', dayType: 'weekday', checkins: 94, avgLoadFactor: 0.85, crowdedCheckins: 42 },
      { band: 'midday', bandLabel: 'Midday (11:00 - 16:00)', dayType: 'weekday', checkins: 52, avgLoadFactor: 0.55, crowdedCheckins: 8 },
      { band: 'evening_peak', bandLabel: 'Evening Peak (16:00 - 20:00)', dayType: 'weekday', checkins: 110, avgLoadFactor: 0.92, crowdedCheckins: 58 },
      { band: 'night', bandLabel: 'Night (20:00 - 23:00)', dayType: 'weekday', checkins: 36, avgLoadFactor: 0.40, crowdedCheckins: 3 },
    ];

    return {
      window: { from: null, to: null },
      routeId: params?.routeId ? Number(params.routeId) : null,
      byStop,
      byBand,
      totals: {
        checkins: 320,
        stopsReporting: db.stops.length,
        avgLoadFactor: 0.65,
        crowdedCheckins: 113,
      },
    };
  }

  // 28. Admin: GET /api/admin/analytics/punctuality
  if (method === 'GET' && normalizedPath === '/api/admin/analytics/punctuality') {
    const byRoute = db.routes.map((r, idx) => ({
      routeId: r.id,
      routeCode: r.code,
      routeName: r.name,
      samples: 64,
      avgDelaySeconds: 120 + idx * 30,
      medianDelaySeconds: 95 + idx * 25,
      worstDelaySeconds: 380 + idx * 40,
      onTimeSamples: 55,
      onTimeShare: 0.86,
    }));

    const bySegment = db.stops.slice(0, 10).map((s, idx) => ({
      routeId: 1,
      routeCode: 'R1',
      stopId: s.id,
      stopCode: s.code,
      stopName: s.name,
      seq: idx + 1,
      samples: 28,
      avgDelaySeconds: 120 + idx * 30,
      medianDelaySeconds: 90 + idx * 25,
      worstDelaySeconds: 350,
      onTimeSamples: 24,
      onTimeShare: 0.85,
    }));

    return {
      window: { from: null, to: null },
      routeId: params?.routeId ? Number(params.routeId) : null,
      toleranceSeconds: 300,
      byRoute,
      bySegment,
    };
  }

  // 29. Admin: GET /api/admin/users
  if (method === 'GET' && normalizedPath === '/api/admin/users') {
    const roleFilter = params?.role;
    const users = db.users
      .filter((u) => !roleFilter || u.role === roleFilter)
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        phone: u.phone ?? null,
        isActive: u.isActive,
        routes: (u.assignedRouteIds || [])
          .map((rid) => {
            const r = db.routes.find((route) => route.id === rid);
            return r ? { id: r.id, code: r.code } : null;
          })
          .filter(Boolean),
      }));
    return { users };
  }

  // 30. Admin: POST /api/admin/users
  if (method === 'POST' && normalizedPath === '/api/admin/users') {
    const { name, email, password, role, phone } = body || {};
    if (!name || !email || !password) throw new ApiError(400, 'Name, email, and password are required.');
    const cleanEmail = email.trim().toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      throw new ApiError(409, 'An account with that email already exists.');
    }
    const newUser = {
      id: Date.now(),
      name: name.trim(),
      email: cleanEmail,
      password: password,
      role: role || 'driver',
      phone: phone?.trim() || null,
      isActive: true,
      assignedRouteIds: [],
    };
    db.users.push(newUser);
    saveDb(db);
    return { user: publicUser(newUser) };
  }

  // 31. Admin: PATCH /api/admin/users/:id
  const adminUserPatchMatch = /^\/api\/admin\/users\/(\d+)$/.exec(normalizedPath);
  if (method === 'PATCH' && adminUserPatchMatch) {
    const id = Number(adminUserPatchMatch[1]);
    const user = db.users.find((u) => u.id === id);
    if (!user) throw new ApiError(404, 'User not found.');
    if (body.name !== undefined) user.name = body.name.trim();
    if (body.phone !== undefined) user.phone = body.phone?.trim() || null;
    if (body.role !== undefined) user.role = body.role;
    if (body.isActive !== undefined) user.isActive = Boolean(body.isActive);
    saveDb(db);
    return { user: publicUser(user) };
  }

  // 32. Admin: POST /api/admin/users/:id/password
  const adminUserPasswordMatch = /^\/api\/admin\/users\/(\d+)\/password$/.exec(normalizedPath);
  if (method === 'POST' && adminUserPasswordMatch) {
    const id = Number(adminUserPasswordMatch[1]);
    const user = db.users.find((u) => u.id === id);
    if (!user) throw new ApiError(404, 'User not found.');
    if (body.password) user.password = body.password;
    saveDb(db);
    return null;
  }

  // 33. Admin: PUT /api/admin/users/:id/assignments
  const adminUserAssignmentsMatch = /^\/api\/admin\/users\/(\d+)\/assignments$/.exec(normalizedPath);
  if (method === 'PUT' && adminUserAssignmentsMatch) {
    const id = Number(adminUserAssignmentsMatch[1]);
    const user = db.users.find((u) => u.id === id);
    if (!user) throw new ApiError(404, 'User not found.');
    user.assignedRouteIds = Array.isArray(body.routeIds) ? body.routeIds : [];
    saveDb(db);
    return { driverId: id, routeIds: user.assignedRouteIds };
  }

  // 34. Admin: GET /api/admin/routes
  if (method === 'GET' && normalizedPath === '/api/admin/routes') {
    return {
      routes: db.routes.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        isActive: r.isActive,
        stopCount: r.stops?.length ?? 0,
        tripCount: db.trips.filter((t) => t.routeId === r.id).length,
      })),
    };
  }

  // 35. Admin: POST /api/admin/routes
  if (method === 'POST' && normalizedPath === '/api/admin/routes') {
    const { code, name, description } = body || {};
    if (!code || !name) throw new ApiError(400, 'Code and name are required.');
    const newRoute = {
      id: Date.now(),
      code: code.trim(),
      name: name.trim(),
      description: description?.trim() || '',
      isActive: true,
      stops: [],
    };
    db.routes.push(newRoute);
    saveDb(db);
    return { id: newRoute.id, route: newRoute };
  }

  // 36. Admin: PATCH /api/admin/routes/:id
  const adminRoutePatchMatch = /^\/api\/admin\/routes\/(\d+)$/.exec(normalizedPath);
  if (method === 'PATCH' && adminRoutePatchMatch) {
    const id = Number(adminRoutePatchMatch[1]);
    const route = db.routes.find((r) => r.id === id);
    if (!route) throw new ApiError(404, 'Route not found.');
    if (body.code !== undefined) route.code = body.code.trim();
    if (body.name !== undefined) route.name = body.name.trim();
    if (body.description !== undefined) route.description = body.description.trim();
    if (body.isActive !== undefined) route.isActive = Boolean(body.isActive);
    saveDb(db);
    return { route };
  }

  // 37. Admin: DELETE /api/admin/routes/:id
  const adminRouteDeleteMatch = /^\/api\/admin\/routes\/(\d+)$/.exec(normalizedPath);
  if (method === 'DELETE' && adminRouteDeleteMatch) {
    const id = Number(adminRouteDeleteMatch[1]);
    const route = db.routes.find((r) => r.id === id);
    if (route) {
      route.isActive = false;
      saveDb(db);
    }
    return { route };
  }

  // 38. Admin: PUT /api/admin/routes/:id/stops
  const adminRouteStopsMatch = /^\/api\/admin\/routes\/(\d+)\/stops$/.exec(normalizedPath);
  if (method === 'PUT' && adminRouteStopsMatch) {
    const id = Number(adminRouteStopsMatch[1]);
    const route = db.routes.find((r) => r.id === id);
    if (!route) throw new ApiError(404, 'Route not found.');
    const inputStops = Array.isArray(body.stops) ? body.stops : [];
    route.stops = inputStops.map((s, idx) => ({
      seq: idx + 1,
      stopId: Number(s.stopId),
      scheduledOffsetSeconds: Number(s.scheduledOffsetSeconds) || 0,
    }));
    saveDb(db);
    return { routeId: id, stopCount: route.stops.length };
  }

  // 39. Admin: GET /api/admin/stops
  if (method === 'GET' && normalizedPath === '/api/admin/stops') {
    return {
      stops: db.stops.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
    };
  }

  // 40. Admin: POST /api/admin/stops
  if (method === 'POST' && normalizedPath === '/api/admin/stops') {
    const { code, name, latitude, longitude } = body || {};
    if (!code || !name) throw new ApiError(400, 'Code and name are required.');
    const newStop = {
      id: Date.now(),
      code: code.trim(),
      name: name.trim(),
      latitude: Number(latitude) || 0,
      longitude: Number(longitude) || 0,
    };
    db.stops.push(newStop);
    saveDb(db);
    return { id: newStop.id, stop: newStop };
  }

  // 41. Admin: PATCH /api/admin/stops/:id
  const adminStopPatchMatch = /^\/api\/admin\/stops\/(\d+)$/.exec(normalizedPath);
  if (method === 'PATCH' && adminStopPatchMatch) {
    const id = Number(adminStopPatchMatch[1]);
    const stop = db.stops.find((s) => s.id === id);
    if (!stop) throw new ApiError(404, 'Stop not found.');
    if (body.code !== undefined) stop.code = body.code.trim();
    if (body.name !== undefined) stop.name = body.name.trim();
    if (body.latitude !== undefined) stop.latitude = Number(body.latitude);
    if (body.longitude !== undefined) stop.longitude = Number(body.longitude);
    saveDb(db);
    return { stop };
  }

  // 42. Admin: GET /api/admin/issues
  if (method === 'GET' && normalizedPath === '/api/admin/issues') {
    const statusFilter = params?.status;
    const kindFilter = params?.kind;
    const routeFilter = params?.routeId ? Number(params.routeId) : null;
    const issues = db.issues
      .filter((i) => !statusFilter || i.status === statusFilter)
      .filter((i) => !kindFilter || i.kind === kindFilter)
      .filter((i) => !routeFilter || i.routeId === routeFilter)
      .map((i) => {
        const route = db.routes.find((r) => r.id === i.routeId);
        const stop = db.stops.find((s) => s.id === i.stopId);
        const reporter = db.users.find((u) => u.id === i.userId);
        return {
          id: i.id,
          kind: i.kind,
          kindLabel: ISSUE_KINDS.find((entry) => entry.value === i.kind)?.label ?? i.kind,
          note: i.note,
          status: i.status,
          createdAt: i.createdAt,
          tripId: i.tripId ?? null,
          routeId: i.routeId ?? null,
          routeCode: route?.code ?? null,
          stopId: i.stopId ?? null,
          stopName: stop?.name ?? null,
          reporterName: reporter?.name ?? 'Commuter',
          reporterEmail: reporter?.email ?? 'commuter@sptos.local',
        };
      });
    return { issues };
  }

  // 43. Admin: PATCH /api/admin/issues/:id
  const adminIssueMatch = /^\/api\/admin\/issues\/(\d+)$/.exec(normalizedPath);
  if (method === 'PATCH' && adminIssueMatch) {
    const id = Number(adminIssueMatch[1]);
    const issue = db.issues.find((i) => i.id === id);
    if (issue && body.status) {
      issue.status = body.status;
      saveDb(db);
    }
    return { issue: { id, status: issue?.status ?? body.status } };
  }

  // 44. Admin: GET /api/admin/exports
  if (method === 'GET' && normalizedPath === '/api/admin/exports') {
    return {
      datasets: [
        { key: 'demand-by-stop', label: 'Demand by Stop' },
        { key: 'demand-by-band', label: 'Demand by Time Band' },
        { key: 'punctuality-by-route', label: 'Punctuality by Route' },
        { key: 'punctuality-by-segment', label: 'Chronically Delayed Segments' },
      ],
    };
  }

  // 45. Admin: GET /api/admin/export/:dataset
  const adminExportMatch = /^\/api\/admin\/export\/([^/?#]+)$/.exec(normalizedPath);
  if (method === 'GET' && adminExportMatch) {
    return 'metric,value\nactive_trips,1\non_time_rate,0.88\ncheckin_coverage,0.94\n';
  }

  // Fallback 404
  console.warn(`[mockDb] Unhandled mock API request: ${method} ${normalizedPath}`);
  throw new ApiError(404, `Endpoint ${normalizedPath} not found in client database.`);
}
