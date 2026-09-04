/**
 * Server-supplied vocabulary (`GET /api/meta`).
 *
 * The occupancy buckets, time bands and the staleness cutoff are configurable on
 * the server, and PRD §15.2 leaves two of them explicitly open. Reading them at
 * runtime means changing `STALE_AFTER_SECONDS` does not need a client release —
 * and the shared constants are the offline fallback, so the app still renders
 * sensible labels with no network.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import {
  DEFAULT_STALE_AFTER_SECONDS,
  ISSUE_KINDS,
  OCCUPANCY_LEVELS,
  TIME_BANDS,
} from '@sptos/shared';
import api from './api.js';

const FALLBACK = {
  occupancyLevels: OCCUPANCY_LEVELS,
  timeBands: TIME_BANDS,
  issueKinds: ISSUE_KINDS,
  staleAfterSeconds: DEFAULT_STALE_AFTER_SECONDS,
  arrivalAlertMinutes: 5,
  minCheckinsForEta: 1,
};

const MetaContext = createContext(FALLBACK);

export function MetaProvider({ children }) {
  const [meta, setMeta] = useState(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/meta')
      .then((data) => {
        if (!cancelled) setMeta({ ...FALLBACK, ...data });
      })
      .catch(() => {
        /* Fallback already in place. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <MetaContext.Provider value={meta}>{children}</MetaContext.Provider>;
}

export const useMeta = () => useContext(MetaContext);
