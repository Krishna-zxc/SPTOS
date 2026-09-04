/**
 * The board at one stop (PRD FR-C3, FR-C4, FR-C5 — plus C6, C7, C8).
 *
 * This is the screen the product is judged on: someone standing at a pole in the
 * sun, deciding whether to wait. So it leads with the arrivals, and every one of
 * them carries its own freshness and an explicit range. When there is nothing to
 * show it says which of the two reasons applies — no bus running, or no recent
 * report — because those call for different decisions from the person waiting.
 */
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import api from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useMeta } from '../../lib/meta.jsx';
import { useFetch, useLiveStop } from '../../lib/useLive.js';
import { clockTime, plural } from '../../lib/format.js';
import EtaCard from '../../components/EtaCard.jsx';
import IssueReportForm from '../../components/IssueReportForm.jsx';
import { Crumb, EmptyState, ErrorNote, Loading, Section } from '../../components/ui.jsx';

export function StopView() {
  const { stopId } = useParams();
  const [params, setParams] = useSearchParams();
  const routeFilter = params.get('routeId');
  const { user } = useAuth();
  const { arrivalAlertMinutes } = useMeta();

  const { data, error, loading, connected, reload } = useLiveStop(stopId, routeFilter);
  const favourites = useFetch('/api/favourites', { enabled: Boolean(user) });
  const alerts = useFetch('/api/alerts', { enabled: Boolean(user) });

  const [pending, setPending] = useState(null);
  const [actionError, setActionError] = useState(null);

  /** The route an alert or a favourite would attach to. */
  const targetRouteId = useMemo(() => {
    if (routeFilter) return Number(routeFilter);
    return data?.routes?.length === 1 ? data.routes[0].id : null;
  }, [routeFilter, data]);

  const favourite = favourites.data?.favourites?.find(
    (entry) => entry.stopId === Number(stopId) && entry.routeId === targetRouteId,
  );
  const alert = alerts.data?.alerts?.find(
    (entry) => entry.stopId === Number(stopId) && entry.routeId === targetRouteId,
  );

  const run = async (label, work, refresh) => {
    setPending(label);
    setActionError(null);
    try {
      await work();
      await refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setPending(null);
    }
  };

  if (loading && !data) return <Loading label="Loading the stop" />;
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;

  const { stop, routes, arrivals } = data;

  return (
    <div className="space-y-5">
      <Crumb to="/">All stops</Crumb>

      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">{stop.name}</h1>
          <span className="font-mono text-xs text-slate-400">{stop.code}</span>
        </div>
        <p className="text-sm text-slate-500">
          {routes.length === 0
            ? 'No active route serves this stop.'
            : `Served by ${plural(routes.length, 'route')}`}
          {data.generatedAt ? ` · updated ${clockTime(data.generatedAt)}` : ''}
          {connected ? '' : ' · reconnecting'}
        </p>

        {routes.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className={`pill ${routeFilter ? 'bg-slate-100 text-slate-600' : 'bg-brand-700 text-white'}`}
              onClick={() => {
                params.delete('routeId');
                setParams(params, { replace: true });
              }}
            >
              All routes
            </button>
            {routes.map((route) => (
              <button
                key={route.id}
                type="button"
                className={`pill ${
                  Number(routeFilter) === route.id
                    ? 'bg-brand-700 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
                onClick={() => {
                  params.set('routeId', String(route.id));
                  setParams(params, { replace: true });
                }}
              >
                {route.code}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      {user && targetRouteId ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost py-1.5 text-xs"
            disabled={pending === 'favourite'}
            onClick={() =>
              run(
                'favourite',
                () =>
                  favourite
                    ? api.del(`/api/favourites/${favourite.id}`)
                    : api.post('/api/favourites', { routeId: targetRouteId, stopId: Number(stopId) }),
                favourites.reload,
              )
            }
          >
            {favourite ? '★ Saved' : '☆ Save this stop'}
          </button>

          <button
            type="button"
            className="btn-ghost py-1.5 text-xs"
            disabled={pending === 'alert'}
            onClick={() =>
              run(
                'alert',
                () =>
                  alert
                    ? api.del(`/api/alerts/${alert.id}`)
                    : api.post('/api/alerts', {
                        routeId: targetRouteId,
                        stopId: Number(stopId),
                        minutesBefore: arrivalAlertMinutes,
                      }),
                alerts.reload,
              )
            }
          >
            {alert
              ? `🔔 Alerting ${alert.minutesBefore} min ahead — turn off`
              : `🔔 Alert me ${arrivalAlertMinutes} min before arrival`}
          </button>

          {alert ? (
            <span className="text-xs text-slate-500">
              Alerts arrive while this app is open — background push is not enabled in
              the pilot.
            </span>
          ) : null}
        </div>
      ) : null}

      {user && !targetRouteId && routes.length > 1 ? (
        <p className="text-xs text-slate-500">
          Pick a single route above to save this stop or set an arrival alert.
        </p>
      ) : null}

      <ErrorNote error={actionError} />

      <Section
        title="Next buses"
        subtitle="Estimated from driver check-ins — not a timetable"
        action={
          <button type="button" className="btn-ghost py-1.5 text-xs" onClick={reload}>
            Refresh
          </button>
        }
      >
        {arrivals.length === 0 ? (
          <EmptyState title="No bus is on its way to this stop right now">
            A bus appears here once its driver starts the trip and checks in. Nothing
            is shown from an earlier trip, because that would not tell you when the
            next one arrives.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {arrivals.map((arrival) => (
              <li key={`${arrival.tripId}-${arrival.routeId}`}>
                <EtaCard arrival={arrival} showRoute={!routeFilter} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Something look wrong?">
        <IssueReportForm stopId={stopId} routeId={targetRouteId} />
      </Section>

      {routes.length > 0 ? (
        <p className="text-xs text-slate-500">
          Whole route on a map:{' '}
          {routes.map((route, index) => (
            <span key={route.id}>
              {index > 0 ? ', ' : ''}
              <Link to={`/routes/${route.id}`} className="link">
                {route.code}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

export default StopView;
