/**
 * Near-real-time transport (PRD FR-S2).
 *
 * Commuters subscribe to a route room or a stop room instead of polling; a
 * driver check-in fans out to both. Broadcast payloads are produced by
 * live.service, so a socket update and a REST fetch return the same shape.
 */
import { Server } from 'socket.io';
import {
  SOCKET_EVENTS,
  routeRoom,
  stopRoom,
  userRoom,
  ADMIN_ROOM,
} from '@sptos/shared';
import config from '../config.js';
import { verifyToken } from '../middleware/auth.js';
import { getRouteLive, getStopLive } from './live.service.js';

let io = null;

const asId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    // Route and stop data is public, so a token is optional here; it is only
    // required for the private admin and per-user rooms below.
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        socket.data.user = verifyToken(token);
        socket.join(userRoom(socket.data.user.id));
      } catch {
        socket.data.user = null;
      }
    }

    socket.on(SOCKET_EVENTS.SUBSCRIBE_ROUTE, async (rawId, ack) => {
      const routeId = asId(rawId);
      if (!routeId) return ack?.({ error: 'Invalid route id.' });
      socket.join(routeRoom(routeId));
      ack?.(await getRouteLive(routeId));
    });

    socket.on(SOCKET_EVENTS.UNSUBSCRIBE_ROUTE, (rawId) => {
      const routeId = asId(rawId);
      if (routeId) socket.leave(routeRoom(routeId));
    });
    socket.on(SOCKET_EVENTS.SUBSCRIBE_STOP, async (rawId, ack) => {
      const stopId = asId(rawId);
      if (!stopId) return ack?.({ error: 'Invalid stop id.' });
      socket.join(stopRoom(stopId));
      ack?.(await getStopLive(stopId));
    });

    socket.on(SOCKET_EVENTS.UNSUBSCRIBE_STOP, (rawId) => {
      const stopId = asId(rawId);
      if (stopId) socket.leave(stopRoom(stopId));
    });

    socket.on(SOCKET_EVENTS.SUBSCRIBE_ADMIN, (ack) => {
      if (socket.data.user?.role !== 'admin') return ack?.({ error: 'Admin role required.' });
      socket.join(ADMIN_ROOM);
      return ack?.({ ok: true });
    });
    socket.on('disconnect', () => {
      socket.data.user = null;
    });
  });

  return io;
}

/** Rooms with at least one subscriber — avoids computing unwanted payloads. */
function hasListeners(room) {
  return Boolean(io?.sockets.adapter.rooms.get(room)?.size);
}

/**
 * Pushes the new state of a route to everyone watching it, and to the rooms of
 * the individual stops on that route that currently have subscribers.
 *
 * Callers that have already built the live state (the check-in path does) pass
 * it in as `live` so it is not computed twice.
 */
export async function broadcastRouteUpdate(routeId, { meta = {}, live = null } = {}) {
  if (!io) return;

  const state = live ?? (await getRouteLive(routeId));
  if (!state) return;

  if (hasListeners(routeRoom(routeId))) {
    io.to(routeRoom(routeId)).emit(SOCKET_EVENTS.ROUTE_UPDATE, { ...state, ...meta });
  }

  if (hasListeners(ADMIN_ROOM)) {
    io.to(ADMIN_ROOM).emit(SOCKET_EVENTS.ADMIN_ACTIVITY, {
      routeId,
      route: state.route,
      activeTrips: state.trips.length,
      ...meta,
    });
  }

  await Promise.all(
    state.stops
      .filter((stop) => hasListeners(stopRoom(stop.stopId)))
      .map(async (stop) => {
        const payload = await getStopLive(stop.stopId);
        if (payload) io.to(stopRoom(stop.stopId)).emit(SOCKET_EVENTS.STOP_UPDATE, payload);
      }),
  );
}

export function emitTripLifecycle(event, payload) {
  if (!io) return;
  io.to(routeRoom(payload.routeId)).emit(event, payload);
  if (hasListeners(ADMIN_ROOM)) io.to(ADMIN_ROOM).emit(event, payload);
}

/** Delivers an arrival alert to one commuter (FR-S4). */
export function emitArrivalAlert(userId, payload) {
  io?.to(userRoom(userId)).emit(SOCKET_EVENTS.ARRIVAL_ALERT, payload);
}

export function getIo() {
  return io;
}

export async function closeRealtime() {
  if (io) {
    await io.close();
    io = null;
  }
}
