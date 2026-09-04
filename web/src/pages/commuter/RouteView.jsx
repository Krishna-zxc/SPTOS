/**
 * One route, end to end (PRD FR-C2).
 *
 * The map answers "where is my bus"; the stop list answers "when does it get to
 * me". Buses whose last check-in has aged out are still drawn — removing them
 * would suggest the bus vanished — but drawn as stale, with the estimate
 * withheld.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveRoute } from '../../lib/useLive.js';import { clockTime, plural } from '../../lib/format.js';
import RouteMap from '../../components/RouteMap.jsx';
import { TripSummary } from '../../components/EtaCard.jsx';
import IssueReportForm from '../../components/IssueReportForm.jsx';
import { Crumb, EmptyState, ErrorNote, Loading, Section } from '../../components/ui.jsx';

export function RouteView() {
  const { routeId } = useParams();
  const { data, error, loading, connected, reload } = useLiveRoute(routeId);
  const [highlight, setHighlight] = useState(null);

  if (loading && !data) return <Loading label="Loading the route" />;
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;

  const { route, stops, trips } = data;

  return (
    <div className="space-y-5">
      <Crumb to="/">All routes</Crumb>

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-brand-700 px-2.5 py-1 text-base font-bold text-white">
            {route.code}
          </span>
          <h1 className="text-xl font-bold text-slate-900">{route.name}</h1>
        </div>
        {route.description ? (
          <p className="text-sm text-slate-500">{route.description}</p>
        ) : null}
        <p className="text-sm text-slate-500">
          {plural(stops.length, 'stop')} ·{' '}
          {trips.length === 0 ? 'no bus running now' : plural(trips.length, 'bus running')}
          {data.generatedAt ? ` · updated ${clockTime(data.generatedAt)}` : ''}
          {connected ? '' : ' · reconnecting'}
        </p>
      </header>

      <RouteMap stops={stops} trips={trips} highlightStopId={highlight} />

      <Section title="Buses on this route now">
        {trips.length === 0 ? (
          <EmptyState title="Nothing running at the moment">
            This route shows a bus as soon as a driver starts a trip on it.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {trips.map((trip) => (
              <li key={trip.tripId}>
                <TripSummary trip={trip}>
                  <Link
                    to={`/trips/${trip.tripId}`}
                    className="text-xs font-semibold text-brand-700 hover:underline"
                  >
                    Check-in history for this bus
                  </Link>
                </TripSummary>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Stops in order"
        subtitle="Tap a stop for its own arrival board"
      >
        <ol className="card divide-y divide-slate-100">
          {stops.map((stop) => {
            // Which buses are still upstream of this stop, and so relevant to it.
            const inbound = trips.filter((trip) => trip.progress.stopsCompleted < stop.seq).length;
            return (
              <li key={stop.stopId}>
                <Link
                  to={`/stops/${stop.stopId}?routeId=${route.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50"
                  onMouseEnter={() => setHighlight(stop.stopId)}
                  onMouseLeave={() => setHighlight(null)}
                  onFocus={() => setHighlight(stop.stopId)}
                  onBlur={() => setHighlight(null)}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                    {stop.seq}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{stop.name}</span>
                    <span className="block font-mono text-xs text-slate-400">{stop.code}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {inbound === 0 ? '—' : `${inbound} inbound`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section title="Something look wrong?">
        <IssueReportForm routeId={route.id} />
      </Section>
    </div>
  );
}

export default RouteView;
