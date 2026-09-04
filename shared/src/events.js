/**
 * WebSocket contract (PRD FR-S2).
 *
 * Clients subscribe to rooms rather than polling. A route room carries every
 * trip on that route; a stop room carries only what a commuter waiting at that
 * stop needs. Both are emitted on each driver check-in.
 */
export const SOCKET_EVENTS = {
  // client -> server
  SUBSCRIBE_ROUTE: 'subscribe:route',
  UNSUBSCRIBE_ROUTE: 'unsubscribe:route',
  SUBSCRIBE_STOP: 'subscribe:stop',
  UNSUBSCRIBE_STOP: 'unsubscribe:stop',
  SUBSCRIBE_ADMIN: 'subscribe:admin',

  // server -> client
  ROUTE_UPDATE: 'route:update',
  STOP_UPDATE: 'stop:update',
  TRIP_STARTED: 'trip:started',
  TRIP_ENDED: 'trip:ended',
  ARRIVAL_ALERT: 'arrival:alert',
  ADMIN_ACTIVITY: 'admin:activity',
};

export const routeRoom = (routeId) => `route:${routeId}`;
export const stopRoom = (stopId) => `stop:${stopId}`;
export const userRoom = (userId) => `user:${userId}`;
export const ADMIN_ROOM = 'admin';
