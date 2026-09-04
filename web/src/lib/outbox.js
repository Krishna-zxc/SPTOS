/**
 * The driver's offline outbox (PRD FR-D6).
 *
 * A conductor taps "departed" as the bus pulls away, which is frequently under a
 * flyover with no signal. The tap must therefore never block on the network:
 *
 *   - every check-in is written to localStorage first, with the timestamp of the
 *     *tap*, not of the eventual upload — otherwise the leg times feeding the
 *     ETA engine would record the moment signal returned;
 *   - each entry carries a `clientUuid` generated on the device, which is what
 *     makes replaying the queue idempotent server-side;
 *   - the queue drains oldest-first through the batch endpoint, and per-entry
 *     outcomes come back, so one unusable entry cannot strand the rest.
 */
import { useEffect, useState } from 'react';
import api from './api.js';

const key = (tripId) => `sptos.outbox.${tripId}`;
const listeners = new Set();

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `sptos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function readQueue(tripId) {
  if (!tripId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key(tripId)) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(tripId, entries) {
  if (entries.length) localStorage.setItem(key(tripId), JSON.stringify(entries));
  else localStorage.removeItem(key(tripId));
  for (const listener of listeners) listener(tripId);
}

/** Records a tap. Returns the queued entry so the UI can advance immediately. */
export function enqueue(tripId, { occupancy, latitude, longitude }) {
  const entry = {
    clientUuid: uuid(),
    occupancy,
    recordedAt: new Date().toISOString(),
    ...(latitude !== undefined && latitude !== null ? { latitude, longitude } : {}),
    state: 'pending',
  };
  writeQueue(tripId, [...readQueue(tripId), entry]);
  return entry;
}

export function removeEntry(tripId, clientUuid) {
  writeQueue(
    tripId,
    readQueue(tripId).filter((entry) => entry.clientUuid !== clientUuid),
  );
}

export function discardRejected(tripId) {
  writeQueue(
    tripId,
    readQueue(tripId).filter((entry) => entry.state !== 'rejected'),
  );
}

export function clearQueue(tripId) {
  writeQueue(tripId, []);
}

let draining = false;

/**
 * Pushes everything pending. Accepted and duplicate entries leave the queue;
 * rejected ones stay, flagged, because they need a human decision — silently
 * dropping a check-in the server refused would hide a real problem.
 *
 * @returns {Promise<null|{accepted:number,duplicates:number,rejected:number,progress:object}>}
 */
export async function drain(tripId) {
  if (draining || !tripId) return null;
  const pending = readQueue(tripId).filter((entry) => entry.state !== 'rejected');
  if (pending.length === 0) return null;

  draining = true;
  try {
    const response = await api.post(`/api/driver/trips/${tripId}/checkins/batch`, {
      checkins: pending.map(({ clientUuid, occupancy, recordedAt, latitude, longitude }) => ({
        clientUuid,
        occupancy,
        recordedAt,
        ...(latitude === undefined ? {} : { latitude, longitude }),
      })),
    });

    const byUuid = new Map(response.results.map((result) => [result.clientUuid, result]));
    const remaining = readQueue(tripId)
      .map((entry) => {
        const result = byUuid.get(entry.clientUuid);
        if (!result) return entry; // queued after this drain started
        if (result.status === 'rejected') {
          return { ...entry, state: 'rejected', reason: result.reason ?? 'The server refused it.' };
        }
        return null; // accepted or already stored — nothing left to send
      })
      .filter(Boolean);

    writeQueue(tripId, remaining);

    return {
      accepted: response.accepted,
      duplicates: response.duplicates,
      rejected: response.rejected,
      progress: response,
    };
  } finally {
    draining = false;
  }
}

/**
 * Queue state for one trip, with automatic draining: on reconnect, on a timer,
 * and whenever the queue changes.
 */
export function useOutbox(tripId, { onDrained } = {}) {
  const [entries, setEntries] = useState(() => readQueue(tripId));
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  useEffect(() => {
    const refresh = (changed) => {
      if (!changed || changed === tripId) setEntries(readQueue(tripId));
    };
    listeners.add(refresh);
    refresh(tripId);
    return () => listeners.delete(refresh);
  }, [tripId]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (!tripId || !online) return undefined;
    let cancelled = false;

    const attempt = async () => {
      if (readQueue(tripId).every((entry) => entry.state === 'rejected')) return;
      setSyncing(true);
      try {
        const result = await drain(tripId);
        if (!cancelled) {
          setSyncError(null);
          if (result) onDrained?.(result);
        }
      } catch (err) {
        if (!cancelled) setSyncError(err);
      } finally {
        if (!cancelled) setSyncing(false);
      }
    };

    void attempt();
    const timer = setInterval(() => void attempt(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, online, entries.length]);

  return {
    entries,
    pending: entries.filter((entry) => entry.state === 'pending'),
    rejected: entries.filter((entry) => entry.state === 'rejected'),
    online,
    syncing,
    syncError,
  };
}
