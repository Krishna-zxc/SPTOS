/**
 * One bus arriving at the stop you are standing at (PRD FR-C3, FR-C4, FR-C5).
 *
 * §12 names inaccurate early ETAs as the project's main credibility risk, and
 * the agreed mitigation is presentation: the word "estimate", a range rather
 * than a single number, and a plain sentence about what the estimate is based
 * on. That is why the range and the confidence note are not optional extras
 * here — they are the reason this card is allowed to show a number at all.
 */
import { Link } from 'react-router-dom';
import { useMeta } from '../lib/meta.jsx';
import {
  CONFIDENCE_TEXT,
  ETA_UNAVAILABLE_TEXT,
  etaGate,
  etaText,
  plural,
  rangeText,
  useNow,
} from '../lib/format.js';
import CrowdBadge from './CrowdBadge.jsx';
import { FreshnessBadge, PositionSourceBadge } from './FreshnessBadge.jsx';

const CONFIDENCE_TONE = {
  high: 'bg-good-soft text-good',
  medium: 'bg-warn-soft text-warn',
  low: 'bg-mute-soft text-mute',
};

export function EtaCard({ arrival, showRoute = true }) {
  const { staleAfterSeconds } = useMeta();
  const now = useNow(10_000);
  const { show, reason } = etaGate(arrival, staleAfterSeconds, now);
  const eta = arrival.eta;

  return (
    <article className="card-pad space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {showRoute ? (
            <Link to={`/routes/${arrival.routeId}`} className="flex items-baseline gap-2">
              <span className="rounded-lg bg-brand-700 px-2 py-0.5 text-sm font-bold text-white">
                {arrival.routeCode}
              </span>
              <span className="truncate font-semibold text-slate-800">{arrival.routeName}</span>
            </Link>
          ) : (
            <span className="font-semibold text-slate-800">{arrival.routeName}</span>
          )}
          <p className="mt-1 text-sm text-slate-500">
            {plural(arrival.stopsAway, 'stop')} away
            {arrival.lastCheckin ? ` · last seen at ${arrival.lastCheckin.stopName}` : ''}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {show && eta ? (
            <>
              <p className="text-2xl font-bold leading-none text-slate-900">{etaText(eta)}</p>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                estimated
              </p>
            </>
          ) : (
            <p className="text-sm font-semibold text-warn">No estimate</p>
          )}
        </div>
      </header>

      {show && eta ? (
        <div className="space-y-1.5">
          <p className="text-sm text-slate-600">
            Likely between <span className="font-semibold">{rangeText(eta)}</span> — this is an
            estimate, not a timetabled time.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`pill ${CONFIDENCE_TONE[eta.confidence]}`}>
              {eta.confidence} confidence
            </span>
            <span className="text-xs text-slate-500">
              {CONFIDENCE_TEXT[eta.confidence]}
              {eta.basedOnSamples ? ` · ${plural(eta.basedOnSamples, 'past trip')}` : ''}
            </span>
          </div>
        </div>
      ) : (
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          {ETA_UNAVAILABLE_TEXT[reason] ?? 'No estimate is available for this bus yet.'}
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <CrowdBadge occupancy={arrival.occupancy} />
        <FreshnessBadge state={arrival} />
        <PositionSourceBadge source={arrival.position?.source} />
        <Link
          to={`/trips/${arrival.tripId}`}
          className="ml-auto text-xs font-semibold text-brand-700 hover:underline"
        >
          Trip detail
        </Link>
      </footer>
    </article>
  );
}

/** The compact form used inside a route's trip list. */
export function TripSummary({ trip, children }) {
  const { staleAfterSeconds } = useMeta();
  const now = useNow(10_000);
  const { show, reason } = etaGate(trip, staleAfterSeconds, now);
  const next = trip.etas?.[0];

  return (
    <article className="card-pad space-y-2">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-800">
            {trip.nextStop ? `Next: ${trip.nextStop.stopName}` : 'Completing the route'}
          </p>
          <p className="text-sm text-slate-500">
            {trip.progress.stopsCompleted} of {trip.progress.totalStops} stops · driver{' '}
            {trip.driverName}
          </p>
        </div>
        <div className="text-right">
          {show && next ? (
            <>
              <p className="text-xl font-bold leading-none">{etaText(next)}</p>
              <p className="text-xs text-slate-500">est. {rangeText(next)}</p>
            </>
          ) : (
            <p className="text-sm font-semibold text-warn">No estimate</p>
          )}
        </div>
      </header>

      {!show ? (
        <p className="text-xs text-warn">{ETA_UNAVAILABLE_TEXT[reason]}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <CrowdBadge occupancy={trip.lastCheckin?.occupancy} short />
        <FreshnessBadge state={trip} />
        <PositionSourceBadge source={trip.position?.source} />
      </div>
      {children}
    </article>
  );
}

export default EtaCard;
