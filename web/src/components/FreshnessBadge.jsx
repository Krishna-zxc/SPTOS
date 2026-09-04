/**
 * The freshness indicator (PRD FR-C5, NFR: Transparency).
 *
 * Every live status on every screen carries one of these, and they all come from
 * this component so no screen can invent its own cutoff or quietly omit it. A
 * stale reading is drawn in warning colour and leads with "No recent data" —
 * never a bare age, which could be mistaken for a live one.
 */
import { useMeta } from '../lib/meta.jsx';
import { ageState, useNow } from '../lib/format.js';

export function FreshnessBadge({ state, className = '', showDot = true }) {
  const { staleAfterSeconds } = useMeta();
  const now = useNow(10_000);
  const fresh = ageState(state, staleAfterSeconds, now);

  const tone = !fresh.hasData
    ? 'bg-mute-soft text-mute'
    : fresh.isStale
      ? 'bg-warn-soft text-warn'
      : 'bg-good-soft text-good';

  return (
    <span
      className={`pill ${tone} ${className} transition-colors duration-300`}
      title={
        fresh.updatedAt
          ? `Last driver check-in at ${new Date(fresh.updatedAt).toLocaleTimeString()}`
          : 'No driver check-in has been received for this bus yet'
      }
    >
      {showDot ? (
        <span
          aria-hidden="true"
          // The ring only beats while the data is fresh: a still dot is the
          // stale state, so the missing movement is itself the signal.
          className={`size-1.5 rounded-full ${
            !fresh.hasData
              ? 'bg-mute'
              : fresh.isStale
                ? 'bg-warn'
                : 'live-dot bg-good text-good'
          }`}
        />
      ) : null}
      {fresh.label}
    </span>
  );
}

/** How the position on the map was derived — never implies unearned precision. */
const POSITION_TEXT = {
  gps: { label: 'Driver GPS', hint: 'The driver’s phone is sharing its location for this trip.' },
  projected: {
    label: 'Estimated position',
    hint: 'Projected along the route from the last check-in — not a measured position.',
  },
  checkin: {
    label: 'At last check-in',
    hint: 'Drawn at the last stop the driver checked in from.',
  },
  route_start: {
    label: 'At the start',
    hint: 'The trip has started but no stop has been checked in yet.',
  },
};

export function PositionSourceBadge({ source, className = '' }) {
  const entry = POSITION_TEXT[source];
  if (!entry) return null;
  return (
    <span className={`pill bg-slate-100 text-slate-600 ${className}`} title={entry.hint}>
      {entry.label}
    </span>
  );
}

export default FreshnessBadge;
