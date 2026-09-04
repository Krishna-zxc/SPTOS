/**
 * Find a bus (PRD FR-C1).
 *
 * The first screen answers one question — "which bus, from which stop" — so it
 * searches routes and stops together rather than making the commuter choose a
 * category first. Saved stops (FR-C8) sit above the search box, because a
 * regular traveller's answer is almost always one of two or three stops.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { useFetch } from '../../lib/useLive.js';
import { plural } from '../../lib/format.js';
import { EmptyState, ErrorNote, Loading, Section, Toggle } from '../../components/ui.jsx';

export function Home() {
  const { user } = useAuth();
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('stops');

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const stops = useFetch('/api/stops', { params: { q: query, limit: 25 }, enabled: kind === 'stops' });
  const routes = useFetch('/api/routes', { params: { q: query, limit: 25 }, enabled: kind === 'routes' });
  const favourites = useFetch('/api/favourites', { enabled: Boolean(user) });

  const active = kind === 'stops' ? stops : routes;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h1 className="text-xl font-bold text-slate-900">Where are you catching the bus?</h1>
        <p className="text-sm text-slate-500">
          Live positions come from drivers checking in at each stop. Arrival times are
          estimates, and every one is shown with how recent the underlying report is.
        </p>

        <label className="label" htmlFor="search">
          Search stops and routes
        </label>
        <input
          id="search"
          className="field"
          placeholder={kind === 'stops' ? 'e.g. Station, MG Road, S07' : 'e.g. 12A, Ring Road'}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          autoComplete="off"
        />

        <Toggle
          name="Search kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'stops', label: 'Stops' },
            { value: 'routes', label: 'Routes' },
          ]}
        />
      </section>

      {user && favourites.data?.favourites?.length ? (
        <Section title="Saved stops" subtitle="One tap to the board you check most">
          <ul className="grid gap-2 sm:grid-cols-2">
            {favourites.data.favourites.map((entry) => (
              <li key={entry.id}>
                <Link
                  to={`/stops/${entry.stopId}?routeId=${entry.routeId}`}
                  className="card-pad flex items-center gap-3 hover:border-brand-300"
                >
                  <span className="rounded-lg bg-brand-700 px-2 py-0.5 text-sm font-bold text-white">
                    {entry.routeCode}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-800">
                      {entry.stopName}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{entry.routeName}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section
        title={kind === 'stops' ? 'Stops' : 'Routes'}
        subtitle={query ? `Matching “${query}”` : 'All of them'}
      >
        <ErrorNote error={active.error} onRetry={active.reload} />
        {active.loading && !active.data ? <Loading /> : null}

        {kind === 'stops' && stops.data ? (
          stops.data.stops.length === 0 ? (
            <EmptyState title="No stops match that">
              Try part of the stop name, or its code.
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {stops.data.stops.map((stop) => (
                <li key={stop.id}>
                  <Link to={`/stops/${stop.id}`} className="card-pad block hover:border-brand-300">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-slate-800">{stop.name}</span>
                      <span className="font-mono text-xs text-slate-400">{stop.code}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap gap-1 text-xs">
                      {stop.routes.length === 0 ? (
                        <span className="text-slate-400">No active routes</span>
                      ) : (
                        stop.routes.map((route) => (
                          <span key={route.id} className="pill bg-brand-50 text-brand-800">
                            {route.code}
                          </span>
                        ))
                      )}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {kind === 'routes' && routes.data ? (
          routes.data.routes.length === 0 ? (
            <EmptyState title="No routes match that">Try the route code, like 12A.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {routes.data.routes.map((route) => (
                <li key={route.id}>
                  <Link to={`/routes/${route.id}`} className="card-pad block hover:border-brand-300">
                    <div className="flex items-center gap-3">
                      <span className="rounded-lg bg-brand-700 px-2 py-0.5 text-sm font-bold text-white">
                        {route.code}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-800">
                          {route.name}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {plural(route.stopCount, 'stop')} ·{' '}
                          {route.activeTrips === 0
                            ? 'no bus running now'
                            : plural(route.activeTrips, 'bus running')}
                        </span>
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Section>
    </div>
  );
}

export default Home;
