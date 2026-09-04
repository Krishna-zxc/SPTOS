/**
 * Live data hooks: WebSocket first, REST as the floor.
 *
 * A push socket is the fast path (FR-S2), but corporate wifi and some mobile
 * proxies block WebSockets outright, and the PRD's reliability NFR asks for
 * graceful degradation rather than a broken screen. So every hook also fetches
 * over REST on mount, and keeps polling — slowly — for as long as the socket is
 * *not* connected. Both paths are built by the same service on the server, so
 * they cannot disagree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from './api.js';
import { onConnectionChange, subscribe } from './socket.js';

const POLL_WHILE_DISCONNECTED_MS = 20_000;

function useLiveResource(kind, id, path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [connected, setConnected] = useState(false);
  const latest = useRef(0);

  /** Guards against an earlier request landing after a later one. */
  const accept = useCallback((payload, stamp) => {
    if (stamp < latest.current) return;
    latest.current = stamp;
    setData(payload);
    setError(null);
    setLoading(false);
  }, []);

  const reload = useCallback(async () => {
    if (!id) return;
    const stamp = Date.now();
    try {
      accept(await api.get(path), stamp);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }, [accept, id, path]);

  useEffect(() => onConnectionChange(setConnected), []);

  useEffect(() => {
    if (!id) {
      setData(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    latest.current = 0;
    void reload();
    return subscribe(kind, id, (payload) => accept(payload, Date.now()));
  }, [accept, id, kind, reload]);

  useEffect(() => {
    if (!id || connected) return undefined;
    const timer = setInterval(() => void reload(), POLL_WHILE_DISCONNECTED_MS);
    return () => clearInterval(timer);
  }, [connected, id, reload]);

  return { data, error, loading, connected, reload };
}

export function useLiveRoute(routeId) {
  return useLiveResource('route', routeId, `/api/routes/${routeId}/live`);
}

/**
 * `routeId` narrows the board to one route. The filter is applied here rather
 * than on the server so the stop's socket room stays shared by every commuter
 * standing at it, whichever route they are waiting for.
 */
export function useLiveStop(stopId, routeId = null) {
  const state = useLiveResource('stop', stopId, `/api/stops/${stopId}/live`);

  const data = useMemo(() => {
    if (!state.data || !routeId) return state.data;
    return {
      ...state.data,
      arrivals: state.data.arrivals.filter((arrival) => arrival.routeId === Number(routeId)),
    };
  }, [state.data, routeId]);

  return { ...state, data };
}

/** Every active bus on the network, for the admin map (FR-A4). */
export function useNetworkLive({ intervalMs = 15_000 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      setData(await api.get('/api/admin/live/network'));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, reload]);

  return { data, error, reload };
}

/** One-shot fetch with the loading and error states every screen repeats. */
export function useFetch(path, { params, enabled = true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const key = JSON.stringify(params ?? null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setData(await api.get(path, { params }));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled, ...deps]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
