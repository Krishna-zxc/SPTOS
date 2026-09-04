/**
 * Saved stops, arrival alerts and reports made (PRD FR-C8, FR-C6, FR-C7).
 *
 * The alerts section states the delivery limit up front. Background push needs
 * FCM/Web Push credentials the pilot does not have (§13), so an alert reaches the
 * commuter while the app is open — claiming otherwise would be the one failure
 * mode that loses trust permanently.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api.js';
import { useFetch } from '../../lib/useLive.js';
import { dateTime } from '../../lib/format.js';
import { EmptyState, ErrorNote, Loading, Section } from '../../components/ui.jsx';

const ISSUE_TONE = {
  open: 'bg-warn-soft text-warn',
  acknowledged: 'bg-brand-50 text-brand-800',
  resolved: 'bg-good-soft text-good',
  dismissed: 'bg-mute-soft text-mute',
};

/** Asks for system-notification permission, which only a gesture may do. */
function NotificationPrompt() {
  const supported = typeof Notification !== 'undefined';
  const [state, setState] = useState(supported ? Notification.permission : 'unsupported');

  if (!supported) {
    return (
      <p className="text-xs text-slate-500">
        This browser cannot show system notifications, so alerts appear in the app
        while it is open.
      </p>
    );
  }

  if (state === 'granted') {
    return (
      <p className="text-xs text-good">
        System notifications are on. They arrive while SPTOS is open in a tab.
      </p>
    );
  }

  if (state === 'denied') {
    return (
      <p className="text-xs text-slate-500">
        Notifications are blocked for this site, so alerts will only appear on screen
        while the app is open.
      </p>
    );
  }

  return (
    <button
      type="button"
      className="btn-ghost py-1.5 text-xs"
      onClick={() => Notification.requestPermission().then(setState)}
    >
      Allow system notifications
    </button>
  );
}

export function Saved() {
  const favourites = useFetch('/api/favourites');
  const alerts = useFetch('/api/alerts');
  const issues = useFetch('/api/issues/mine');
  const [error, setError] = useState(null);

  const remove = async (path, refresh) => {
    setError(null);
    try {
      await api.del(path);
      await refresh();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Saved & alerts</h1>
      <ErrorNote error={error} />

      <Section title="Saved stops" subtitle="Straight to the board you check most">
        {favourites.loading && !favourites.data ? <Loading /> : null}
        {favourites.data?.favourites?.length === 0 ? (
          <EmptyState title="Nothing saved yet">
            Open a stop, pick the route you wait for, and tap “Save this stop”.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {favourites.data?.favourites?.map((entry) => (
              <li key={entry.id} className="card-pad flex items-center gap-3">
                <span className="rounded-lg bg-brand-700 px-2 py-0.5 text-sm font-bold text-white">
                  {entry.routeCode}
                </span>
                <Link
                  to={`/stops/${entry.stopId}?routeId=${entry.routeId}`}
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate font-semibold text-slate-800">
                    {entry.stopName}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{entry.routeName}</span>
                </Link>
                <button
                  type="button"
                  className="btn-ghost py-1 text-xs"
                  onClick={() => remove(`/api/favourites/${entry.id}`, favourites.reload)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Arrival alerts" subtitle="Told when your bus is close">
        <div className="card-pad space-y-2 border-brand-200 bg-brand-50">
          <p className="text-sm text-brand-900">
            Alerts are delivered to this app while it is open. The pilot does not run
            background push, so closing every tab stops them arriving.
          </p>
          <NotificationPrompt />
        </div>

        {alerts.data?.alerts?.length === 0 ? (
          <EmptyState title="No alerts set">
            On a stop's page, tap “Alert me before arrival”.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {alerts.data?.alerts?.map((entry) => (
              <li key={entry.id} className="card-pad flex items-center gap-3">
                <span className="rounded-lg bg-brand-700 px-2 py-0.5 text-sm font-bold text-white">
                  {entry.routeCode}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-800">
                    {entry.stopName}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {entry.minutesBefore} min before arrival
                    {entry.notifiedAt ? ` · last sent ${dateTime(entry.notifiedAt)}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-ghost py-1 text-xs"
                  onClick={() => remove(`/api/alerts/${entry.id}`, alerts.reload)}
                >
                  Turn off
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Reports you sent" subtitle="And what happened to them">
        {issues.data?.issues?.length === 0 ? (
          <EmptyState title="No reports yet">
            If a position or crowd level looks wrong, say so from the stop or trip
            page — it is the only way the system learns it was wrong.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {issues.data?.issues?.map((entry) => (
              <li key={entry.id} className="card-pad flex flex-wrap items-center gap-2">
                <span className={`pill ${ISSUE_TONE[entry.status]}`}>{entry.status}</span>
                <span className="min-w-0 flex-1 text-sm text-slate-700">
                  {entry.routeCode ? `${entry.routeCode} · ` : ''}
                  {entry.stopName ?? 'General'}
                  {entry.note ? ` — “${entry.note}”` : ''}
                </span>
                <span className="text-xs text-slate-400">{dateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default Saved;
