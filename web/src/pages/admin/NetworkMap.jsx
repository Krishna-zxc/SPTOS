/**
 * Every bus running right now (PRD FR-A4).
 *
 * The operator's version of the commuter map: one panel per route with an active
 * trip, and a table underneath that ranks buses by how stale their data is. That
 * ordering is deliberate — the thing an operator can act on is a driver who has
 * stopped checking in, not a bus that is behaving.
 */
import { useNetworkLive } from '../../lib/useLive.js';
import { useMeta } from '../../lib/meta.jsx';
import { ageState, clockTime, plural, useNow } from '../../lib/format.js';
import RouteMap from '../../components/RouteMap.jsx';
import CrowdBadge from '../../components/CrowdBadge.jsx';
import { FreshnessBadge } from '../../components/FreshnessBadge.jsx';
import { EmptyState, ErrorNote, Loading, Section } from '../../components/ui.jsx';

export function NetworkMap() {
  const { data, error, reload } = useNetworkLive({ intervalMs: 15_000 });
  const { staleAfterSeconds } = useMeta();
  const now = useNow(10_000);

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Loading label="Finding the buses that are running" />;

  // Flattened for the table, and tagged with its route so a marker can be labelled.
  const running = data.routes.flatMap((entry) =>
    entry.trips.map((trip) => ({
      ...trip,
      routeCode: entry.route.code,
      routeName: entry.route.name,
      stale: ageState(trip, staleAfterSeconds, now).isStale,
    })),
  );
  const stale = running.filter((trip) => trip.stale).length;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">Network right now</h1>
        <p className="text-sm text-slate-500">
          {plural(data.activeTrips, 'bus')} on {plural(data.routes.length, 'route')} · refreshed{' '}
          {clockTime(data.generatedAt)}
          {stale ? ` · ${stale} not reporting` : ''}
        </p>
      </header>

      <ErrorNote error={error} onRetry={reload} />

      {data.routes.length === 0 ? (
        <EmptyState title="No trip is active">
          A bus appears here the moment a driver starts a trip. Nothing is drawn from
          a finished one.
        </EmptyState>
      ) : (
        data.routes.map((entry) => (
          <Section
            key={entry.route.id}
            title={`${entry.route.code} — ${entry.route.name}`}
            subtitle={plural(entry.trips.length, 'bus running')}
          >
            <RouteMap
              stops={entry.stops}
              trips={entry.trips.map((trip) => ({ ...trip, routeCode: entry.route.code }))}
            />
          </Section>
        ))
      )}

      {running.length ? (
        <Section
          title="Buses, least fresh first"
          subtitle="A bus near the top has stopped reporting, and its commuters are being told so"
        >
          <div className="card overflow-x-auto">
            <table className="table-plain">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Driver</th>
                  <th>Progress</th>
                  <th>Last check-in</th>
                  <th>Crowding</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {[...running]
                  .sort((a, b) => Number(b.stale) - Number(a.stale))
                  .map((trip) => (
                    <tr key={trip.tripId}>
                      <td className="font-semibold text-slate-800">{trip.routeCode}</td>
                      <td className="text-slate-600">{trip.driverName}</td>
                      <td className="text-slate-600">
                        {trip.progress.stopsCompleted} / {trip.progress.totalStops}
                        {trip.nextStop ? (
                          <span className="block text-xs text-slate-400">
                            next {trip.nextStop.stopName}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-slate-600">
                        {trip.lastCheckin ? clockTime(trip.lastCheckin.recordedAt) : '—'}
                      </td>
                      <td>
                        <CrowdBadge occupancy={trip.lastCheckin?.occupancy} short />
                      </td>
                      <td>
                        <FreshnessBadge state={trip} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

export default NetworkMap;
