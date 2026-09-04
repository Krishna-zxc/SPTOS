/**
 * The driver's home screen (PRD FR-D1).
 *
 * A driver opens this at the wheel, so it has exactly one job: get them to the
 * check-in screen in one tap. An unfinished trip therefore outranks everything
 * else on the page — resuming is far more common than starting, because the tab
 * gets closed mid-route all the time.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useFetch } from '../../lib/useLive.js';
import { clockTime, dateTime, percent, plural } from '../../lib/format.js';
import { EmptyState, ErrorNote, Loading, Section } from '../../components/ui.jsx';

const STATUS_TONE = {
  active: 'bg-good-soft text-good',
  completed: 'bg-mute-soft text-mute',
  cancelled: 'bg-bad-soft text-bad',
};

export function DriverHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const active = useFetch('/api/driver/active-trip');
  const assignments = useFetch('/api/driver/assignments');
  const recent = useFetch('/api/driver/trips', { params: { limit: 8 } });

  const [starting, setStarting] = useState(null);
  const [error, setError] = useState(null);

  const start = async (routeId) => {
    setStarting(routeId);
    setError(null);
    try {
      const created = await api.post('/api/driver/trips', { routeId });
      navigate(`/driver/trips/${created.trip.tripId}`);
    } catch (err) {
      setError(err);
      // A 409 means a trip is already open; showing it is more useful than the error.
      await active.reload();
    } finally {
      setStarting(null);
    }
  };

  const running = active.data?.trip ?? null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">Hello {user?.name?.split(' ')[0]}</h1>
        <p className="text-sm text-slate-500">
          Every check-in you send is what commuters at the next stops are reading.
        </p>
      </header>

      <ErrorNote error={error} />

      {active.loading && !active.data ? <Loading label="Checking for an open trip" /> : null}

      {running ? (
        <Section title="Trip in progress">
          <Link
            to={`/driver/trips/${running.tripId}`}
            className="card-pad block border-brand-300 bg-brand-50 hover:border-brand-500"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-lg bg-brand-700 px-2.5 py-1 text-base font-bold text-white">
                {running.routeCode}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-900">
                  {running.routeName}
                </span>
                <span className="block text-xs text-slate-600">
                  Started {clockTime(running.startedAt)} ·{' '}
                  {plural(active.data.checkins.length, 'stop')} checked in
                  {active.data.nextStop ? ` · next ${active.data.nextStop.stopName}` : ''}
                </span>
              </span>
              <span className="btn-primary py-2 text-sm">Continue →</span>
            </div>
          </Link>
        </Section>
      ) : (
        <Section
          title="Start a trip"
          subtitle="Pick the route you are driving now"
        >
          {assignments.loading && !assignments.data ? <Loading /> : null}
          <ErrorNote error={assignments.error} onRetry={assignments.reload} />
          {assignments.data?.routes?.length === 0 ? (
            <EmptyState title="No route assigned to you yet">
              An administrator assigns the routes you may run. Until then there is
              nothing to check in against.
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {assignments.data?.routes?.map((route) => (
                <li key={route.id} className="card-pad flex flex-wrap items-center gap-3">
                  <span className="rounded-lg bg-brand-700 px-2.5 py-1 text-base font-bold text-white">
                    {route.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-800">
                      {route.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {plural(route.stopCount, 'stop')}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn-primary py-2 text-sm"
                    disabled={starting !== null}
                    onClick={() => start(route.id)}
                  >
                    {starting === route.id ? 'Starting…' : 'Start trip'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Your recent trips" subtitle="Check-in coverage is what makes the estimates work">
        {recent.data?.trips?.length === 0 ? (
          <EmptyState title="No trips yet">
            Your first trip will appear here once you start one.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {recent.data?.trips?.map((trip) => {
              const coverage = trip.stopCount ? trip.checkinCount / trip.stopCount : 0;
              return (
                <li key={trip.tripId} className="card-pad flex flex-wrap items-center gap-3">
                  <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-sm font-bold text-slate-700">
                    {trip.routeCode}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800">
                      {dateTime(trip.startedAt)}
                      {trip.endedAt ? ` – ${clockTime(trip.endedAt)}` : ''}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {trip.checkinCount} of {trip.stopCount} stops ({percent(coverage)})
                    </span>
                  </span>
                  <span className={`pill ${STATUS_TONE[trip.status] ?? 'bg-mute-soft text-mute'}`}>
                    {trip.status}
                  </span>
                  <Link to={`/driver/trips/${trip.tripId}`} className="link text-xs">
                    Open
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default DriverHome;
