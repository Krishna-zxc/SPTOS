/**
 * One bus's check-in history.
 *
 * The point of this screen is accountability for the estimate: a commuter who
 * thinks the ETA is wrong can see exactly what it was computed from — which stops
 * were reported, when, and how crowded. That is also the honest answer to "why
 * did the time jump", which on a check-in-based system it sometimes does.
 *
 * Deliberately thin on the driver: a display name, no GPS trail (privacy NFR).
 */
import { Link, useParams } from 'react-router-dom';
import { useFetch } from '../../lib/useLive.js';
import { clockTime, dateTime, durationText, plural } from '../../lib/format.js';
import CrowdBadge from '../../components/CrowdBadge.jsx';
import IssueReportForm from '../../components/IssueReportForm.jsx';
import { Crumb, EmptyState, ErrorNote, Loading, Section } from '../../components/ui.jsx';

const STATUS_TONE = {
  active: 'bg-good-soft text-good',
  completed: 'bg-mute-soft text-mute',
  cancelled: 'bg-bad-soft text-bad',
};

export function TripView() {
  const { tripId } = useParams();
  const { data, error, loading, reload } = useFetch(`/api/trips/${tripId}`);

  if (loading && !data) return <Loading label="Loading the trip" />;
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;

  const { trip, checkins } = data;

  return (
    <div className="space-y-5">
      <Crumb to={`/routes/${trip.routeId}`}>Back to {trip.routeCode}</Crumb>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-brand-700 px-2.5 py-1 text-base font-bold text-white">
            {trip.routeCode}
          </span>
          <h1 className="text-xl font-bold text-slate-900">{trip.routeName}</h1>
          <span className={`pill ${STATUS_TONE[trip.status] ?? 'bg-mute-soft text-mute'}`}>
            {trip.status}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          Driver {trip.driverName} · started {dateTime(trip.startedAt)}
          {trip.endedAt ? ` · ended ${clockTime(trip.endedAt)}` : ''}
        </p>
      </header>

      <Section
        title="Check-ins"
        subtitle={`${plural(checkins.length, 'stop')} reported on this trip`}
      >
        {checkins.length === 0 ? (
          <EmptyState title="No check-in yet">
            The driver has started the trip but has not reported leaving a stop, so
            there is nothing to estimate from.
          </EmptyState>
        ) : (
          <ol className="card divide-y divide-slate-100">
            {checkins.map((checkin, index) => {
              const previous = checkins[index - 1];
              const gap = previous
                ? (new Date(checkin.recordedAt) - new Date(previous.recordedAt)) / 1000
                : null;
              return (
                <li key={`${checkin.seq}-${checkin.recordedAt}`} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800">
                    {checkin.seq}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">
                      {checkin.stopName}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {checkin.event === 'arrived' ? 'Arrived' : 'Departed'} at{' '}
                      {clockTime(checkin.recordedAt)}
                      {gap !== null ? ` · ${durationText(gap)} from the previous stop` : ''}
                    </span>
                  </span>
                  <CrowdBadge occupancy={checkin.occupancy} short className="shrink-0" />
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-xs text-slate-500">
          Travel times between these check-ins are what the route's future estimates
          are averaged from.
        </p>
      </Section>

      <Section title="Something look wrong?">
        <IssueReportForm tripId={trip.tripId} routeId={trip.routeId} />
      </Section>

      <p className="text-xs text-slate-500">
        <Link to={`/routes/${trip.routeId}`} className="link">
          See {trip.routeCode} on the map
        </Link>
      </p>
    </div>
  );
}

export default TripView;
