/**
 * Update freshness (PRD FR-C5, NFR: Transparency, NFR: Reliability).
 *
 * The system must never present stale data as if it were live. Every
 * commuter-facing status therefore carries the age of the underlying check-in
 * and an explicit stale flag, and the UI shows one from this single source of
 * truth rather than each screen inventing its own cutoff.
 */
export const DEFAULT_STALE_AFTER_SECONDS = 480;

export const NO_DATA_LABEL = 'No recent data';

/** Age of `timestamp` in whole seconds, or null when there is no timestamp. */
export function ageSeconds(timestamp, now = Date.now()) {
  if (!timestamp) return null;
  const then = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.round((new Date(now).getTime() - then) / 1000));
}

export function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return NO_DATA_LABEL;
  if (seconds < 20) return 'Just now';
  if (seconds < 60) return 'Under a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

/**
 * @returns {{hasData: boolean, ageSeconds: number|null, isStale: boolean,
 *            label: string, updatedAt: string|null}}
 */
export function freshness(timestamp, options = {}) {
  const { now = Date.now(), staleAfterSeconds = DEFAULT_STALE_AFTER_SECONDS } = options;
  const age = ageSeconds(timestamp, now);
  const hasData = age !== null;
  const isStale = !hasData || age > staleAfterSeconds;

  return {
    hasData,
    ageSeconds: age,
    isStale,
    label: !hasData
      ? NO_DATA_LABEL
      : isStale
        ? `${NO_DATA_LABEL} · last seen ${formatAge(age)}`
        : formatAge(age),
    updatedAt: hasData ? new Date(timestamp).toISOString() : null,
  };
}
