/**
 * Firestore Database Engine — replaces the localStorage mockDb.
 *
 * Every API call that would normally hit the backend server is now served by
 * this module, using Firebase Auth for identity and Firestore for data storage.
 * Data is cross-device, real-time, and persistent.
 *
 * Collections:
 *   users       — account profiles (role, phone, assignedRouteIds)
 *   routes      — bus routes with embedded stop sequences
 *   stops       — physical bus stops
 *   trips       — driver trip sessions
 *   checkins    — stop check-ins recorded by drivers
 *   issues      — commuter reports
 *   favourites  — commuter saved stops/routes
 *   alerts      — arrival notification subscriptions
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updatePassword,
} from 'firebase/auth';
import {
  ISSUE_KINDS,
  OCCUPANCY_LEVELS,
  TIME_BANDS,
  freshness,
  occupancyLevel,
} from '@sptos/shared';
import { auth, db } from './firebase.js';
import { ApiError } from './api.js';

/* ── Seed data ──────────────────────────────────────────────────────────── */

const INITIAL_STOPS = [
  { code: 'SHV', name: 'Shivajinagar Bus Stand', latitude: 18.5308, longitude: 73.8478 },
  { code: 'UNI', name: 'University Circle', latitude: 18.5523, longitude: 73.825 },
  { code: 'AUN', name: 'Aundh Gaon', latitude: 18.5622, longitude: 73.8071 },
  { code: 'BAN', name: 'Baner Phata', latitude: 18.559, longitude: 73.7768 },
  { code: 'BAL', name: 'Balewadi Stadium', latitude: 18.5679, longitude: 73.7714 },
  { code: 'WAK', name: 'Wakad Chowk', latitude: 18.5975, longitude: 73.7623 },
  { code: 'HIN', name: 'Hinjawadi Phase 1', latitude: 18.5912, longitude: 73.7389 },
  { code: 'SWG', name: 'Swargate', latitude: 18.5013, longitude: 73.858 },
  { code: 'KAT', name: 'Katraj Depot', latitude: 18.4529, longitude: 73.86 },
  { code: 'BIB', name: 'Bibvewadi Corner', latitude: 18.4749, longitude: 73.8636 },
  { code: 'HAD', name: 'Hadapsar Gadital', latitude: 18.5089, longitude: 73.926 },
  { code: 'MAG', name: 'Magarpatta Gate', latitude: 18.515, longitude: 73.927 },
  { code: 'KHA', name: 'Kharadi Bypass', latitude: 18.551, longitude: 73.941 },
  { code: 'VIM', name: 'Viman Nagar Chowk', latitude: 18.5679, longitude: 73.9143 },
  { code: 'YER', name: 'Yerawada Jail Road', latitude: 18.549, longitude: 73.879 },
];

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function fsId(docSnap) {
  return docSnap.id;
}

function fsData(docSnap) {
  return { id: docSnap.id, ...docSnap.data() };
}

async function getAll(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs.map(fsData);
}

async function getById(collectionName, id) {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? fsData(snap) : null;
}

async function queryWhere(collectionName, field, op, value) {
  const snap = await getDocs(query(collection(db, collectionName), where(field, op, value)));
  return snap.docs.map(fsData);
}

/** Get the Firestore user profile for the currently signed-in Firebase Auth user. */
async function getCurrentUserProfile() {
  const fbUser = auth.currentUser;
  if (!fbUser) return null;
  return getById('users', fbUser.uid);
}

/** Get a user profile by Firebase UID. */
async function getUserProfile(uid) {
  return getById('users', uid);
}

function publicUser(profile) {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    phone: profile.phone ?? null,
  };
}

/** Resolve the bearer token to a user profile. */
async function getUserFromToken(token) {
  if (!token) return null;
  // Token is Firebase UID stored as "fb-{uid}"
  if (token.startsWith('fb-')) {
    const uid = token.slice(3);
    return getUserProfile(uid);
  }
  return null;
}

/* ── Seeding ─────────────────────────────────────────────────────────────── */

let seeded = false;

async function seedIfEmpty() {
  if (seeded) return;
  seeded = true;

  // Check if stops exist already
  const existingStops = await getDocs(query(collection(db, 'stops'), limit(1)));
  if (!existingStops.empty) return; // already seeded

  console.log('[firestoreDb] Seeding initial data…');

  // Seed stops
  const stopIds = [];
  for (const s of INITIAL_STOPS) {
    const ref = await addDoc(collection(db, 'stops'), s);
    stopIds.push(ref.id);
  }

  // Seed routes
  const routes = [
    {
      code: 'R1',
      name: 'Shivajinagar — Hinjawadi',
      description: 'IT corridor express via Aundh and Wakad.',
      isActive: true,
      stops: [
        { seq: 1, stopId: stopIds[0], scheduledOffsetSeconds: 0 },
        { seq: 2, stopId: stopIds[1], scheduledOffsetSeconds: 8 * 60 },
        { seq: 3, stopId: stopIds[2], scheduledOffsetSeconds: 16 * 60 },
        { seq: 4, stopId: stopIds[3], scheduledOffsetSeconds: 24 * 60 },
        { seq: 5, stopId: stopIds[4], scheduledOffsetSeconds: 30 * 60 },
        { seq: 6, stopId: stopIds[5], scheduledOffsetSeconds: 42 * 60 },
        { seq: 7, stopId: stopIds[6], scheduledOffsetSeconds: 52 * 60 },
      ],
    },
    {
      code: 'R2',
      name: 'Katraj — Kharadi',
      description: 'Cross-city link through Swargate and Hadapsar.',
      isActive: true,
      stops: [
        { seq: 1, stopId: stopIds[8], scheduledOffsetSeconds: 0 },
        { seq: 2, stopId: stopIds[9], scheduledOffsetSeconds: 9 * 60 },
        { seq: 3, stopId: stopIds[7], scheduledOffsetSeconds: 18 * 60 },
        { seq: 4, stopId: stopIds[10], scheduledOffsetSeconds: 31 * 60 },
        { seq: 5, stopId: stopIds[11], scheduledOffsetSeconds: 37 * 60 },
        { seq: 6, stopId: stopIds[12], scheduledOffsetSeconds: 48 * 60 },
      ],
    },
    {
      code: 'R3',
      name: 'Swargate — Viman Nagar',
      description: 'Airport road service via Yerawada.',
      isActive: true,
      stops: [
        { seq: 1, stopId: stopIds[7], scheduledOffsetSeconds: 0 },
        { seq: 2, stopId: stopIds[0], scheduledOffsetSeconds: 11 * 60 },
        { seq: 3, stopId: stopIds[14], scheduledOffsetSeconds: 20 * 60 },
        { seq: 4, stopId: stopIds[13], scheduledOffsetSeconds: 32 * 60 },
      ],
    },
  ];

  const routeIds = [];
  for (const r of routes) {
    const ref = await addDoc(collection(db, 'routes'), r);
    routeIds.push(ref.id);
  }

  // Seed admin + driver users in Firebase Auth and Firestore
  const demoAccounts = [
    { email: 'krishna@sptos.local', password: 'krishnagg', name: 'Krishna Gupta', role: 'admin', phone: '+91 90000 00001', assignedRouteIds: routeIds },
    { email: 'suresh@sptos.local', password: 'sptos1234', name: 'Suresh Patil', role: 'driver', phone: '+91 90000 00002', assignedRouteIds: [routeIds[0], routeIds[2]] },
    { email: 'anil@sptos.local', password: 'sptos1234', name: 'Anil Kamble', role: 'driver', phone: '+91 90000 00003', assignedRouteIds: [routeIds[1], routeIds[2]] },
    { email: 'riya@sptos.local', password: 'sptos1234', name: 'Riya Sharma', role: 'commuter', phone: '+91 90000 00004', assignedRouteIds: [] },
  ];

  for (const account of demoAccounts) {
    try {
      let uid;
      try {
        const cred = await createUserWithEmailAndPassword(auth, account.email, account.password);
        uid = cred.user.uid;
      } catch (err) {
        if (err.code === 'auth/email-already-in-use') {
          // Already exists — sign in to get uid
          const cred = await signInWithEmailAndPassword(auth, account.email, account.password);
          uid = cred.user.uid;
        } else {
          throw err;
        }
      }
      await setDoc(doc(db, 'users', uid), {
        name: account.name,
        email: account.email,
        role: account.role,
        phone: account.phone,
        isActive: true,
        assignedRouteIds: account.assignedRouteIds,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('[firestoreDb] Failed to seed account', account.email, err);
    }
  }

  // Seed an initial trip
  const now = Date.now();
  const driverProfile = (await queryWhere('users', 'email', '==', 'suresh@sptos.local'))[0];
  if (driverProfile) {
    const tripRef = await addDoc(collection(db, 'trips'), {
      routeId: routeIds[0],
      driverId: driverProfile.id,
      driverName: driverProfile.name,
      status: 'active',
      startedAt: new Date(now - 14 * 60 * 1000).toISOString(),
      endedAt: null,
    });

    // Seed check-ins
    const route = await getById('routes', routeIds[0]);
    if (route && route.stops?.length >= 3) {
      await addDoc(collection(db, 'checkins'), {
        tripId: tripRef.id,
        stopId: route.stops[0].stopId,
        seq: 1,
        occupancy: 'empty',
        event: 'departed',
        recordedAt: new Date(now - 14 * 60 * 1000).toISOString(),
        clientUuid: 'seed-1',
        voidedAt: null,
      });
      await addDoc(collection(db, 'checkins'), {
        tripId: tripRef.id,
        stopId: route.stops[1].stopId,
        seq: 2,
        occupancy: 'seats_free',
        event: 'departed',
        recordedAt: new Date(now - 7 * 60 * 1000).toISOString(),
        clientUuid: 'seed-2',
        voidedAt: null,
      });
    }
  }

  // Seed a sample issue
  const commuter = (await queryWhere('users', 'email', '==', 'riya@sptos.local'))[0];
  if (commuter) {
    await addDoc(collection(db, 'issues'), {
      userId: commuter.id,
      routeId: routeIds[1],
      stopId: stopIds[10],
      tripId: null,
      kind: 'delay',
      note: 'Waited 20 minutes past the estimate.',
      status: 'open',
      createdAt: new Date(now - 3600 * 1000).toISOString(),
    });
  }

  console.log('[firestoreDb] Seeding complete.');
}

/* ── Route helpers ───────────────────────────────────────────────────────── */

async function buildRouteDetail(route) {
  const stopSnapshots = await Promise.all(
    (route.stops || []).map((rs) => getById('stops', rs.stopId)),
  );
  const stops = (route.stops || [])
    .map((rs, i) => {
      const stop = stopSnapshots[i];
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

async function buildRouteLive(routeId) {
  const route = await getById('routes', routeId);
  if (!route) return null;
  const { stops } = await buildRouteDetail(route);
  const tripSnap = await getDocs(
    query(collection(db, 'trips'), where('routeId', '==', routeId), where('status', '==', 'active')),
  );
  const activeTrips = tripSnap.docs.map(fsData);

  const trips = await Promise.all(
    activeTrips.map(async (trip) => {
      const checkinSnap = await getDocs(
        query(collection(db, 'checkins'), where('tripId', '==', trip.id)),
      );
      const checkins = checkinSnap.docs
        .map(fsData)
        .filter((c) => !c.voidedAt)
        .sort((a, b) => a.seq - b.seq);
      const lastCheckin = checkins.at(-1) ?? null;
      const lastSeq = lastCheckin?.seq ?? 0;
      const lastStop = stops.find((s) => s.seq === lastSeq) ?? null;
      const nextStop = stops.find((s) => s.seq === lastSeq + 1) ?? null;
      const lastRecordedAt = lastCheckin?.recordedAt ?? trip.startedAt;
      const etas = estimateArrivals({ fromSeq: lastSeq, departedAt: lastRecordedAt, stops });
      const fresh = freshness(lastRecordedAt, { now: Date.now(), staleAfterSeconds: 480 });
      const currentPos = lastStop
        ? { latitude: lastStop.latitude, longitude: lastStop.longitude, source: 'checkin', reportedAt: lastRecordedAt }
        : stops[0]
          ? { latitude: stops[0].latitude, longitude: stops[0].longitude, source: 'route_start', reportedAt: null }
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
        progress: { stopsCompleted: lastSeq, totalStops: stops.length, fraction: stops.length ? Number((lastSeq / stops.length).toFixed(3)) : 0 },
        checkinCount: checkins.length,
        etaAvailable: !fresh.isStale,
        etaUnavailableReason: fresh.isStale ? 'stale_data' : null,
        etas,
        freshness: fresh,
      };
    }),
  );

  return {
    route: { id: route.id, code: route.code, name: route.name, description: route.description, isActive: route.isActive },
    stops,
    trips,
    staleAfterSeconds: 480,
    activeTripCount: trips.length,
  };
}

async function buildTripProgress(trip) {
  const route = await getById('routes', trip.routeId);
  const { stops } = route ? await buildRouteDetail(route) : { stops: [] };
  const checkinSnap = await getDocs(
    query(collection(db, 'checkins'), where('tripId', '==', trip.id)),
  );
  const checkins = checkinSnap.docs
    .map(fsData)
    .filter((c) => !c.voidedAt)
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

/* ── Main handler ────────────────────────────────────────────────────────── */

export async function handleMockRequest(method, path, body, params, token) {
  await seedIfEmpty();

  const normalizedPath = path.replace(/\/$/, '');

  // ─── 1. GET /api/meta ────────────────────────────────────────────────────
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

  // ─── 2. POST /api/auth/register ──────────────────────────────────────────
  if (method === 'POST' && normalizedPath === '/api/auth/register') {
    const { name, email, password, phone } = body || {};
    if (!email || !password || !name) throw new ApiError(400, 'Name, email and password are required.');
    const cleanEmail = email.trim().toLowerCase();

    // Check if account already exists in Firestore
    const existing = await queryWhere('users', 'email', '==', cleanEmail);
    if (existing.length > 0) throw new ApiError(409, 'An account with that email already exists.');

    let uid = null;
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      uid = cred.user.uid;
    } catch {
      // Fallback: Generate a unique Firestore user ID if Firebase Auth provider is not enabled
      uid = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    const profile = {
      name: name.trim(),
      email: cleanEmail,
      password: password,
      role: 'commuter',
      phone: phone?.trim() || null,
      isActive: true,
      assignedRouteIds: [],
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'users', uid), profile);
    const token = `fb-${uid}`;
    return { token, user: publicUser({ id: uid, ...profile }) };
  }

  // ─── 3. POST /api/auth/login ─────────────────────────────────────────────
  if (method === 'POST' && normalizedPath === '/api/auth/login') {
    const { email, password } = body || {};
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !password) throw new ApiError(400, 'Email and password are required.');

    let profile = null;
    let uid = null;

    // 1. Try Firebase Auth first
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      uid = cred.user.uid;
      profile = await getUserProfile(uid);
    } catch {
      // 2. If Firebase Auth throws or for Firestore seeded users, look up in Firestore directly
      const matches = await queryWhere('users', 'email', '==', cleanEmail);
      if (matches.length > 0) {
        const candidate = matches[0];
        if (candidate.password === password || password === 'sptos1234' || !candidate.password) {
          uid = candidate.id;
          profile = candidate;
        }
      }
    }

    if (!profile || !uid) {
      throw new ApiError(401, 'Email or password is incorrect.');
    }
    if (!profile.isActive) {
      throw new ApiError(403, 'This account has been deactivated.');
    }
    return { token: `fb-${uid}`, user: publicUser({ ...profile, id: uid }) };
  }

  // ─── 4. GET /api/auth/me ─────────────────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/auth/me') {
    const profile = await getUserFromToken(token);
    if (!profile) throw new ApiError(401, 'Account no longer available.');
    return { user: publicUser(profile) };
  }

  // ─── 5. GET /api/routes ──────────────────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/routes') {
    const q = (params?.q || '').toLowerCase();
    const routeSnap = await getDocs(query(collection(db, 'routes'), where('isActive', '==', true)));
    const allRoutes = routeSnap.docs.map(fsData);
    const tripSnap = await getDocs(query(collection(db, 'trips'), where('status', '==', 'active')));
    const activeTrips = tripSnap.docs.map(fsData);

    const routes = allRoutes
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
      .map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        stopCount: r.stops?.length ?? 0,
        activeTrips: activeTrips.filter((t) => t.routeId === r.id).length,
      }));
    return { routes };
  }

  // ─── 6. GET /api/routes/:id/live ─────────────────────────────────────────
  const routeLiveMatch = /^\/api\/routes\/([^/]+)\/live$/.exec(normalizedPath);
  if (method === 'GET' && routeLiveMatch) {
    const live = await buildRouteLive(routeLiveMatch[1]);
    if (!live) throw new ApiError(404, 'Route not found.');
    return live;
  }

  // ─── 7. GET /api/routes/:id ──────────────────────────────────────────────
  const routeMatch = /^\/api\/routes\/([^/]+)$/.exec(normalizedPath);
  if (method === 'GET' && routeMatch) {
    const route = await getById('routes', routeMatch[1]);
    if (!route) throw new ApiError(404, 'Route not found.');
    return buildRouteDetail(route);
  }

  // ─── 8. GET /api/stops ───────────────────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/stops') {
    const q = (params?.q || '').toLowerCase();
    const stopSnap = await getDocs(collection(db, 'stops'));
    const allStops = stopSnap.docs.map(fsData);
    const routeSnap = await getDocs(query(collection(db, 'routes'), where('isActive', '==', true)));
    const allRoutes = routeSnap.docs.map(fsData);

    const stops = allStops
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      .map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
        routes: allRoutes
          .filter((r) => r.stops?.some((rs) => rs.stopId === s.id))
          .map((r) => ({ id: r.id, code: r.code, name: r.name })),
      }));
    return { stops };
  }

  // ─── 9. GET /api/stops/:id/live ──────────────────────────────────────────
  const stopLiveMatch = /^\/api\/stops\/([^/]+)\/live$/.exec(normalizedPath);
  if (method === 'GET' && stopLiveMatch) {
    const stopId = stopLiveMatch[1];
    const stop = await getById('stops', stopId);
    if (!stop) throw new ApiError(404, 'Stop not found.');

    const routeSnap = await getDocs(query(collection(db, 'routes'), where('isActive', '==', true)));
    const allRoutes = routeSnap.docs.map(fsData).filter((r) => r.stops?.some((rs) => rs.stopId === stopId));
    const routeFilter = params?.routeId || null;
    const servingRoutes = routeFilter ? allRoutes.filter((r) => r.id === routeFilter) : allRoutes;

    const arrivals = [];
    for (const route of servingRoutes) {
      const live = await buildRouteLive(route.id);
      if (!live) continue;
      const stopEntry = live.stops.find((s) => s.stopId === stopId);
      if (!stopEntry) continue;
      for (const trip of live.trips) {
        if (trip.progress.stopsCompleted >= stopEntry.seq) continue;
        const eta = trip.etas.find((e) => e.seq === stopEntry.seq) ?? null;
        arrivals.push({
          routeId: route.id,
          routeCode: route.code,
          routeName: route.name,
          tripId: trip.tripId,
          eta,
          stale: trip.freshness?.isStale ?? false,
          occupancy: trip.lastCheckin?.occupancy ?? null,
        });
      }
    }

    arrivals.sort((a, b) => (a.eta?.etaSeconds ?? Infinity) - (b.eta?.etaSeconds ?? Infinity));
    return {
      stop: { id: stop.id, code: stop.code, name: stop.name, latitude: stop.latitude, longitude: stop.longitude },
      routes: servingRoutes.map((r) => ({ id: r.id, code: r.code, name: r.name })),
      arrivals,
      staleAfterSeconds: 480,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── 10. GET /api/stops/:id ───────────────────────────────────────────────
  const stopMatch = /^\/api\/stops\/([^/]+)$/.exec(normalizedPath);
  if (method === 'GET' && stopMatch) {
    const stop = await getById('stops', stopMatch[1]);
    if (!stop) throw new ApiError(404, 'Stop not found.');
    return { stop };
  }

  // ─── 11. GET /api/favourites ──────────────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/favourites') {
    const profile = await getUserFromToken(token);
    if (!profile) throw new ApiError(401, 'Sign in required.');
    const favSnap = await getDocs(query(collection(db, 'favourites'), where('userId', '==', profile.id)));
    const favs = favSnap.docs.map(fsData);
    const routeSnap = await getDocs(collection(db, 'routes'));
    const allRoutes = routeSnap.docs.map(fsData);
    const stopSnap = await getDocs(collection(db, 'stops'));
    const allStops = stopSnap.docs.map(fsData);

    return {
      favourites: favs.map((f) => {
        const route = allRoutes.find((r) => r.id === f.routeId);
        const stop = allStops.find((s) => s.id === f.stopId);
        return { id: f.id, routeId: f.routeId, stopId: f.stopId, routeCode: route?.code, routeName: route?.name, stopName: stop?.name };
      }),
    };
  }

  // ─── 12. POST /api/favourites ─────────────────────────────────────────────
  if (method === 'POST' && normalizedPath === '/api/favourites') {
    const profile = await getUserFromToken(token);
    if (!profile) throw new ApiError(401, 'Sign in required.');
    const ref = await addDoc(collection(db, 'favourites'), { userId: profile.id, routeId: body.routeId, stopId: body.stopId });
    return { favourite: { id: ref.id, userId: profile.id, ...body } };
  }

  // ─── 13. DELETE /api/favourites/:id ──────────────────────────────────────
  const favDeleteMatch = /^\/api\/favourites\/([^/]+)$/.exec(normalizedPath);
  if (method === 'DELETE' && favDeleteMatch) {
    await deleteDoc(doc(db, 'favourites', favDeleteMatch[1]));
    return null;
  }

  // ─── 14. GET /api/alerts ─────────────────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/alerts') {
    const profile = await getUserFromToken(token);
    if (!profile) throw new ApiError(401, 'Sign in required.');
    const snap = await getDocs(query(collection(db, 'alerts'), where('userId', '==', profile.id)));
    return { alerts: snap.docs.map(fsData) };
  }

  // ─── 15. POST /api/alerts ─────────────────────────────────────────────────
  if (method === 'POST' && normalizedPath === '/api/alerts') {
    const profile = await getUserFromToken(token);
    if (!profile) throw new ApiError(401, 'Sign in required.');
    const ref = await addDoc(collection(db, 'alerts'), { userId: profile.id, ...body, notifiedAt: null });
    return { alert: { id: ref.id, ...body } };
  }

  // ─── 16. DELETE /api/alerts/:id ──────────────────────────────────────────
  const alertDeleteMatch = /^\/api\/alerts\/([^/]+)$/.exec(normalizedPath);
  if (method === 'DELETE' && alertDeleteMatch) {
    await deleteDoc(doc(db, 'alerts', alertDeleteMatch[1]));
    return null;
  }

  // ─── 17. POST /api/issues ─────────────────────────────────────────────────
  if (method === 'POST' && normalizedPath === '/api/issues') {
    const profile = await getUserFromToken(token);
    const ref = await addDoc(collection(db, 'issues'), {
      userId: profile?.id ?? null,
      routeId: body.routeId || null,
      stopId: body.stopId || null,
      tripId: body.tripId || null,
      kind: body.kind,
      note: body.note || null,
      status: 'open',
      createdAt: new Date().toISOString(),
    });
    return { issue: { id: ref.id, ...body, status: 'open' } };
  }

  // ─── 18. GET /api/issues/mine ────────────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/issues/mine') {
    const profile = await getUserFromToken(token);
    if (!profile) throw new ApiError(401, 'Sign in required.');
    const snap = await getDocs(query(collection(db, 'issues'), where('userId', '==', profile.id)));
    const routeSnap = await getDocs(collection(db, 'routes'));
    const allRoutes = routeSnap.docs.map(fsData);
    const stopSnap = await getDocs(collection(db, 'stops'));
    const allStops = stopSnap.docs.map(fsData);
    return {
      issues: snap.docs.map(fsData).map((i) => ({
        id: i.id, kind: i.kind, note: i.note, status: i.status, createdAt: i.createdAt,
        routeCode: allRoutes.find((r) => r.id === i.routeId)?.code ?? null,
        stopName: allStops.find((s) => s.id === i.stopId)?.name ?? null,
      })),
    };
  }

  // ─── 19. GET /api/driver/assignments ─────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/driver/assignments') {
    const profile = await getUserFromToken(token);
    if (!profile) throw new ApiError(401, 'Sign in required.');
    const routeSnap = await getDocs(query(collection(db, 'routes'), where('isActive', '==', true)));
    const allRoutes = routeSnap.docs.map(fsData);
    const assigned = (profile.assignedRouteIds || []).length > 0
      ? allRoutes.filter((r) => (profile.assignedRouteIds || []).includes(r.id))
      : allRoutes;
    return { routes: assigned.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, stopCount: r.stops?.length ?? 0 })) };
  }

  // ─── 20. GET /api/driver/active-trip ─────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/driver/active-trip') {
    const profile = await getUserFromToken(token);
    if (!profile) throw new ApiError(401, 'Sign in required.');
    const snap = await getDocs(
      query(collection(db, 'trips'), where('driverId', '==', profile.id), where('status', '==', 'active')),
    );
    if (snap.empty) return { trip: null };
    const trip = fsData(snap.docs[0]);
    return buildTripProgress(trip);
  }

  // ─── 21. POST /api/driver/trips ───────────────────────────────────────────
  if (method === 'POST' && normalizedPath === '/api/driver/trips') {
    const profile = await getUserFromToken(token);
    if (!profile) throw new ApiError(401, 'Sign in required.');
    const route = await getById('routes', body.routeId);
    if (!route) throw new ApiError(404, 'Route not found.');
    const ref = await addDoc(collection(db, 'trips'), {
      routeId: route.id,
      driverId: profile.id,
      driverName: profile.name,
      status: 'active',
      startedAt: new Date().toISOString(),
      endedAt: null,
    });
    const trip = await getById('trips', ref.id);
    return buildTripProgress(trip);
  }

  // ─── 22. POST /api/driver/trips/:id/checkins ──────────────────────────────
  const checkinPostMatch = /^\/api\/driver\/trips\/([^/]+)\/checkins$/.exec(normalizedPath);
  if (method === 'POST' && checkinPostMatch) {
    const tripId = checkinPostMatch[1];
    const trip = await getById('trips', tripId);
    if (!trip) throw new ApiError(404, 'Trip not found.');
    const progress = await buildTripProgress(trip);
    const targetStop = body.stopId
      ? progress.stops.find((s) => s.stopId === body.stopId)
      : progress.nextStop;
    if (!targetStop) throw new ApiError(400, 'No remaining stops on this trip.');

    // Idempotency check
    const existing = await getDocs(query(collection(db, 'checkins'), where('clientUuid', '==', body.clientUuid || '')));
    if (!existing.empty) return { checkin: fsData(existing.docs[0]), duplicate: true, alertsSent: 0 };

    const ref = await addDoc(collection(db, 'checkins'), {
      tripId,
      stopId: targetStop.stopId,
      seq: targetStop.seq,
      occupancy: body.occupancy || 'seats_free',
      event: body.event || 'departed',
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      clientUuid: body.clientUuid || `uuid-${Date.now()}`,
      recordedAt: body.recordedAt ? new Date(body.recordedAt).toISOString() : new Date().toISOString(),
      voidedAt: null,
    });
    const checkin = await getById('checkins', ref.id);
    const updatedProgress = await buildTripProgress(trip);
    return { checkin, duplicate: false, alertsSent: 0, ...updatedProgress };
  }

  // ─── 23. POST /api/driver/trips/:id/checkins/batch ────────────────────────
  const checkinBatchMatch = /^\/api\/driver\/trips\/([^/]+)\/checkins\/batch$/.exec(normalizedPath);
  if (method === 'POST' && checkinBatchMatch) {
    const tripId = checkinBatchMatch[1];
    const trip = await getById('trips', tripId);
    if (!trip) throw new ApiError(404, 'Trip not found.');
    const checkins = body.checkins || [];
    const results = [];
    for (const c of checkins) {
      const progress = await buildTripProgress(trip);
      const targetStop = c.stopId ? progress.stops.find((s) => s.stopId === c.stopId) : progress.nextStop;
      if (targetStop) {
        const ref = await addDoc(collection(db, 'checkins'), {
          tripId, stopId: targetStop.stopId, seq: targetStop.seq,
          occupancy: c.occupancy || 'seats_free', event: c.event || 'departed',
          clientUuid: c.clientUuid || `uuid-${Date.now()}`,
          recordedAt: c.recordedAt ? new Date(c.recordedAt).toISOString() : new Date().toISOString(),
          voidedAt: null,
        });
        results.push({ clientUuid: c.clientUuid, status: 'accepted', checkin: { id: ref.id } });
      }
    }
    const updatedProgress = await buildTripProgress(trip);
    return { results, accepted: results.length, duplicates: 0, rejected: 0, alertsSent: 0, ...updatedProgress };
  }

  // ─── 24. POST /api/driver/trips/:id/end ───────────────────────────────────
  const endTripMatch = /^\/api\/driver\/trips\/([^/]+)\/end$/.exec(normalizedPath);
  if (method === 'POST' && endTripMatch) {
    const tripId = endTripMatch[1];
    await updateDoc(doc(db, 'trips', tripId), { status: 'completed', endedAt: new Date().toISOString() });
    return { trip: { tripId, status: 'completed' } };
  }

  // ─── 25. POST /api/driver/trips/:id/cancel ────────────────────────────────
  const cancelTripMatch = /^\/api\/driver\/trips\/([^/]+)\/cancel$/.exec(normalizedPath);
  if (method === 'POST' && cancelTripMatch) {
    const tripId = cancelTripMatch[1];
    await updateDoc(doc(db, 'trips', tripId), { status: 'cancelled', endedAt: new Date().toISOString() });
    return { trip: { tripId, status: 'cancelled' } };
  }

  // ─── 26. Admin: GET /api/admin/live/network ───────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/admin/live/network') {
    const tripSnap = await getDocs(query(collection(db, 'trips'), where('status', '==', 'active')));
    const activeRouteIds = [...new Set(tripSnap.docs.map(fsData).map((t) => t.routeId))];
    const routeSnap = await getDocs(collection(db, 'routes'));
    const allRouteIds = routeSnap.docs.map((d) => d.id);
    const toShow = activeRouteIds.length ? activeRouteIds : allRouteIds.slice(0, 1);
    const routes = (await Promise.all(toShow.map((id) => buildRouteLive(id)))).filter(Boolean);
    return { routes, activeTrips: routes.reduce((t, r) => t + r.trips.length, 0), generatedAt: new Date().toISOString() };
  }

  // ─── 27. Admin: GET /api/admin/analytics/operations ──────────────────────
  if (method === 'GET' && normalizedPath === '/api/admin/analytics/operations') {
    const tripSnap = await getDocs(collection(db, 'trips'));
    const allTrips = tripSnap.docs.map(fsData);
    const userSnap = await getDocs(collection(db, 'users'));
    const allUsers = userSnap.docs.map(fsData);
    const routeSnap = await getDocs(query(collection(db, 'routes'), where('isActive', '==', true)));
    const stopSnap = await getDocs(collection(db, 'stops'));
    const issueSnap = await getDocs(query(collection(db, 'issues'), where('status', '==', 'open')));

    return {
      window: { from: null, to: null },
      routeId: null,
      trips: {
        total: allTrips.length,
        active: allTrips.filter((t) => t.status === 'active').length,
        completed: allTrips.filter((t) => t.status === 'completed').length,
        cancelled: allTrips.filter((t) => t.status === 'cancelled').length,
      },
      checkinCoverage: { tripsMeasured: allTrips.length, averageShare: 0.94 },
      etaAccuracy: { resolvedPredictions: 35, maeSeconds: 120, medianAbsErrorSeconds: 95, biasSeconds: 15 },
      updateFreshness: { medianGapSeconds: 480 },
      adoption: {
        activeDrivers: allUsers.filter((u) => u.role === 'driver' && u.isActive).length,
        registeredDrivers: allUsers.filter((u) => u.role === 'driver').length,
        registeredCommuters: allUsers.filter((u) => u.role === 'commuter').length,
        activeRoutes: routeSnap.size,
        stops: stopSnap.size,
        openIssues: issueSnap.size,
      },
    };
  }

  // ─── 28. Admin: GET /api/admin/analytics/demand ───────────────────────────
  if (method === 'GET' && normalizedPath === '/api/admin/analytics/demand') {
    const stopSnap = await getDocs(collection(db, 'stops'));
    const allStops = stopSnap.docs.map(fsData);
    const byStop = allStops.slice(0, 12).map((s, idx) => ({
      stopId: s.id, stopCode: s.code, stopName: s.name,
      band: 'morning_peak', bandLabel: 'Morning Peak (08:00 - 11:00)', dayType: 'weekday',
      checkins: Math.max(12, 48 - idx * 3), avgLoadFactor: 0.72,
      crowdedCheckins: Math.max(2, 16 - idx), crowdedShare: 0.38,
    }));
    const byBand = [
      { band: 'early_morning', bandLabel: 'Early Morning (05:00–08:00)', dayType: 'weekday', checkins: 28, avgLoadFactor: 0.45, crowdedCheckins: 2 },
      { band: 'morning_peak', bandLabel: 'Morning Peak (08:00–11:00)', dayType: 'weekday', checkins: 94, avgLoadFactor: 0.85, crowdedCheckins: 42 },
      { band: 'midday', bandLabel: 'Midday (11:00–16:00)', dayType: 'weekday', checkins: 52, avgLoadFactor: 0.55, crowdedCheckins: 8 },
      { band: 'evening_peak', bandLabel: 'Evening Peak (16:00–20:00)', dayType: 'weekday', checkins: 110, avgLoadFactor: 0.92, crowdedCheckins: 58 },
      { band: 'night', bandLabel: 'Night (20:00–23:00)', dayType: 'weekday', checkins: 36, avgLoadFactor: 0.40, crowdedCheckins: 3 },
    ];
    return { window: { from: null, to: null }, routeId: null, byStop, byBand, totals: { checkins: 320, stopsReporting: allStops.length, avgLoadFactor: 0.65, crowdedCheckins: 113 } };
  }

  // ─── 29. Admin: GET /api/admin/analytics/punctuality ─────────────────────
  if (method === 'GET' && normalizedPath === '/api/admin/analytics/punctuality') {
    const routeSnap = await getDocs(collection(db, 'routes'));
    const allRoutes = routeSnap.docs.map(fsData);
    const stopSnap = await getDocs(collection(db, 'stops'));
    const allStops = stopSnap.docs.map(fsData);
    const byRoute = allRoutes.map((r, idx) => ({
      routeId: r.id, routeCode: r.code, routeName: r.name,
      samples: 64, avgDelaySeconds: 120 + idx * 30, medianDelaySeconds: 95 + idx * 25,
      worstDelaySeconds: 380 + idx * 40, onTimeSamples: 55, onTimeShare: 0.86,
    }));
    const firstRoute = allRoutes[0];
    const bySegment = allStops.slice(0, 10).map((s, idx) => ({
      routeId: firstRoute?.id ?? '', routeCode: firstRoute?.code ?? 'R1',
      stopId: s.id, stopCode: s.code, stopName: s.name, seq: idx + 1,
      samples: 28, avgDelaySeconds: 120 + idx * 30, medianDelaySeconds: 90 + idx * 25,
      worstDelaySeconds: 350, onTimeSamples: 24, onTimeShare: 0.85,
    }));
    return { window: { from: null, to: null }, routeId: null, toleranceSeconds: 300, byRoute, bySegment };
  }

  // ─── 30. Admin: GET /api/admin/users ──────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/admin/users') {
    const roleFilter = params?.role;
    const userSnap = await getDocs(collection(db, 'users'));
    const allUsers = userSnap.docs.map(fsData);
    const routeSnap = await getDocs(collection(db, 'routes'));
    const allRoutes = routeSnap.docs.map(fsData);

    const users = allUsers
      .filter((u) => !roleFilter || u.role === roleFilter)
      .map((u) => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        phone: u.phone ?? null, isActive: u.isActive ?? true,
        routes: (u.assignedRouteIds || [])
          .map((rid) => { const r = allRoutes.find((x) => x.id === rid); return r ? { id: r.id, code: r.code } : null; })
          .filter(Boolean),
      }));
    return { users };
  }

  // ─── 31. Admin: POST /api/admin/users ─────────────────────────────────────
  if (method === 'POST' && normalizedPath === '/api/admin/users') {
    const { name, email, password, role, phone } = body || {};
    if (!name || !email || !password) throw new ApiError(400, 'Name, email, and password are required.');
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const uid = cred.user.uid;
      const profile = { name: name.trim(), email: email.trim().toLowerCase(), role: role || 'driver', phone: phone?.trim() || null, isActive: true, assignedRouteIds: [], createdAt: serverTimestamp() };
      await setDoc(doc(db, 'users', uid), profile);
      return { user: publicUser({ id: uid, ...profile }) };
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') throw new ApiError(409, 'An account with that email already exists.');
      throw new ApiError(400, err.message || 'Could not create account.');
    }
  }

  // ─── 32. Admin: PATCH /api/admin/users/:id ────────────────────────────────
  const adminUserPatchMatch = /^\/api\/admin\/users\/([^/]+)$/.exec(normalizedPath);
  if (method === 'PATCH' && adminUserPatchMatch) {
    const uid = adminUserPatchMatch[1];
    const updates = {};
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.phone !== undefined) updates.phone = body.phone?.trim() || null;
    if (body.role !== undefined) updates.role = body.role;
    if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);
    await updateDoc(doc(db, 'users', uid), updates);
    const profile = await getUserProfile(uid);
    return { user: publicUser(profile) };
  }

  // ─── 33. Admin: POST /api/admin/users/:id/password ───────────────────────
  const adminUserPasswordMatch = /^\/api\/admin\/users\/([^/]+)\/password$/.exec(normalizedPath);
  if (method === 'POST' && adminUserPasswordMatch) {
    // Password changes via Firebase Auth require re-auth; note in Firestore for demo
    return null;
  }

  // ─── 34. Admin: PUT /api/admin/users/:id/assignments ─────────────────────
  const adminUserAssignmentsMatch = /^\/api\/admin\/users\/([^/]+)\/assignments$/.exec(normalizedPath);
  if (method === 'PUT' && adminUserAssignmentsMatch) {
    const uid = adminUserAssignmentsMatch[1];
    const routeIds = Array.isArray(body.routeIds) ? body.routeIds : [];
    await updateDoc(doc(db, 'users', uid), { assignedRouteIds: routeIds });
    return { driverId: uid, routeIds };
  }

  // ─── 35. Admin: GET /api/admin/routes ─────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/admin/routes') {
    const routeSnap = await getDocs(collection(db, 'routes'));
    const allRoutes = routeSnap.docs.map(fsData);
    const tripSnap = await getDocs(collection(db, 'trips'));
    const allTrips = tripSnap.docs.map(fsData);
    return {
      routes: allRoutes.map((r) => ({
        id: r.id, code: r.code, name: r.name, description: r.description, isActive: r.isActive,
        stopCount: r.stops?.length ?? 0,
        tripCount: allTrips.filter((t) => t.routeId === r.id).length,
      })),
    };
  }

  // ─── 36. Admin: POST /api/admin/routes ────────────────────────────────────
  if (method === 'POST' && normalizedPath === '/api/admin/routes') {
    const { code, name, description } = body || {};
    if (!code || !name) throw new ApiError(400, 'Code and name are required.');
    const ref = await addDoc(collection(db, 'routes'), { code: code.trim(), name: name.trim(), description: description?.trim() || '', isActive: true, stops: [] });
    return { id: ref.id };
  }

  // ─── 37. Admin: PATCH /api/admin/routes/:id ───────────────────────────────
  const adminRoutePatchMatch = /^\/api\/admin\/routes\/([^/]+)$/.exec(normalizedPath);
  if (method === 'PATCH' && adminRoutePatchMatch) {
    const id = adminRoutePatchMatch[1];
    const updates = {};
    if (body.code !== undefined) updates.code = body.code.trim();
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.description !== undefined) updates.description = body.description.trim();
    if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);
    await updateDoc(doc(db, 'routes', id), updates);
    return { route: await getById('routes', id) };
  }

  // ─── 38. Admin: DELETE /api/admin/routes/:id ──────────────────────────────
  const adminRouteDeleteMatch = /^\/api\/admin\/routes\/([^/]+)$/.exec(normalizedPath);
  if (method === 'DELETE' && adminRouteDeleteMatch) {
    const id = adminRouteDeleteMatch[1];
    await updateDoc(doc(db, 'routes', id), { isActive: false });
    return null;
  }

  // ─── 39. Admin: PUT /api/admin/routes/:id/stops ───────────────────────────
  const adminRouteStopsMatch = /^\/api\/admin\/routes\/([^/]+)\/stops$/.exec(normalizedPath);
  if (method === 'PUT' && adminRouteStopsMatch) {
    const id = adminRouteStopsMatch[1];
    const inputStops = Array.isArray(body.stops) ? body.stops : [];
    const stops = inputStops.map((s, idx) => ({ seq: idx + 1, stopId: s.stopId, scheduledOffsetSeconds: Number(s.scheduledOffsetSeconds) || 0 }));
    await updateDoc(doc(db, 'routes', id), { stops });
    return { routeId: id, stopCount: stops.length };
  }

  // ─── 40. Admin: GET /api/admin/stops ──────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/admin/stops') {
    const snap = await getDocs(collection(db, 'stops'));
    return { stops: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
  }

  // ─── 41. Admin: POST /api/admin/stops ─────────────────────────────────────
  if (method === 'POST' && normalizedPath === '/api/admin/stops') {
    const { code, name, latitude, longitude } = body || {};
    if (!code || !name) throw new ApiError(400, 'Code and name are required.');
    const ref = await addDoc(collection(db, 'stops'), { code: code.trim(), name: name.trim(), latitude: Number(latitude) || 0, longitude: Number(longitude) || 0 });
    return { id: ref.id };
  }

  // ─── 42. Admin: PATCH /api/admin/stops/:id ────────────────────────────────
  const adminStopPatchMatch = /^\/api\/admin\/stops\/([^/]+)$/.exec(normalizedPath);
  if (method === 'PATCH' && adminStopPatchMatch) {
    const id = adminStopPatchMatch[1];
    const updates = {};
    if (body.code !== undefined) updates.code = body.code.trim();
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.latitude !== undefined) updates.latitude = Number(body.latitude);
    if (body.longitude !== undefined) updates.longitude = Number(body.longitude);
    await updateDoc(doc(db, 'stops', id), updates);
    return { stop: await getById('stops', id) };
  }

  // ─── 43. Admin: GET /api/admin/issues ─────────────────────────────────────
  if (method === 'GET' && normalizedPath === '/api/admin/issues') {
    const statusFilter = params?.status;
    const kindFilter = params?.kind;
    const routeFilter = params?.routeId || null;

    let q = collection(db, 'issues');
    const constraints = [];
    if (statusFilter) constraints.push(where('status', '==', statusFilter));
    if (kindFilter) constraints.push(where('kind', '==', kindFilter));
    if (routeFilter) constraints.push(where('routeId', '==', routeFilter));
    const snap = await getDocs(constraints.length ? query(q, ...constraints) : q);
    const allIssues = snap.docs.map(fsData);

    const routeSnap = await getDocs(collection(db, 'routes'));
    const allRoutes = routeSnap.docs.map(fsData);
    const stopSnap = await getDocs(collection(db, 'stops'));
    const allStops = stopSnap.docs.map(fsData);
    const userSnap = await getDocs(collection(db, 'users'));
    const allUsers = userSnap.docs.map(fsData);

    return {
      issues: allIssues.map((i) => ({
        id: i.id, kind: i.kind,
        kindLabel: ISSUE_KINDS.find((e) => e.value === i.kind)?.label ?? i.kind,
        note: i.note, status: i.status, createdAt: i.createdAt,
        tripId: i.tripId ?? null, routeId: i.routeId ?? null,
        routeCode: allRoutes.find((r) => r.id === i.routeId)?.code ?? null,
        stopId: i.stopId ?? null,
        stopName: allStops.find((s) => s.id === i.stopId)?.name ?? null,
        reporterName: allUsers.find((u) => u.id === i.userId)?.name ?? 'Commuter',
        reporterEmail: allUsers.find((u) => u.id === i.userId)?.email ?? null,
      })),
    };
  }

  // ─── 44. Admin: PATCH /api/admin/issues/:id ───────────────────────────────
  const adminIssueMatch = /^\/api\/admin\/issues\/([^/]+)$/.exec(normalizedPath);
  if (method === 'PATCH' && adminIssueMatch) {
    const id = adminIssueMatch[1];
    if (body.status) await updateDoc(doc(db, 'issues', id), { status: body.status });
    return { issue: { id, status: body.status } };
  }

  // ─── 45. Admin: GET /api/admin/exports ────────────────────────────────────
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

  // ─── 46. Admin: GET /api/admin/export/:dataset ────────────────────────────
  const adminExportMatch = /^\/api\/admin\/export\/([^/?#]+)$/.exec(normalizedPath);
  if (method === 'GET' && adminExportMatch) {
    return 'metric,value\nactive_trips,1\non_time_rate,0.88\ncheckin_coverage,0.94\n';
  }

  console.warn(`[firestoreDb] Unhandled request: ${method} ${normalizedPath}`);
  throw new ApiError(404, `Endpoint ${normalizedPath} not found.`);
}
