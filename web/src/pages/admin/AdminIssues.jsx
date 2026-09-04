/**
 * Triage of commuter reports (PRD FR-A5).
 *
 * With no hardware on the bus, a commuter saying "that is not where it is" is
 * the only correction signal the system gets. Reports are therefore not a
 * complaints inbox — they are the accuracy feedback loop, so the queue leads with
 * what is still open and every row carries a link straight to the thing being
 * complained about.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ISSUE_KINDS, ISSUE_STATUSES } from '@sptos/shared';
import api from '../../lib/api.js';
import { useFetch } from '../../lib/useLive.js';
import { dateTime, plural } from '../../lib/format.js';
import { EmptyState, ErrorNote, Loading, Section } from '../../components/ui.jsx';

const STATUS_TONE = {
  open: 'bg-warn-soft text-warn',
  acknowledged: 'bg-brand-50 text-brand-800',
  resolved: 'bg-good-soft text-good',
  dismissed: 'bg-mute-soft text-mute',
};

/** What each status means here, so two admins triage the same way. */
const STATUS_HINT = {
  open: 'Nobody has looked at it yet.',
  acknowledged: 'Seen and believed — the underlying problem is being dealt with.',
  resolved: 'The data or the route was corrected.',
  dismissed: 'Checked and the information was in fact right.',
};

export function AdminIssues() {
  const [status, setStatus] = useState('open');
  const [kind, setKind] = useState('');
  const [routeId, setRouteId] = useState('');

  const routes = useFetch('/api/admin/routes');
  const issues = useFetch('/api/admin/issues', {
    params: {
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
      ...(routeId ? { routeId } : {}),
      limit: 100,
    },
  });

  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const setIssueStatus = async (id, next) => {
    setBusy(id);
    setError(null);
    try {
      await api.patch(`/api/admin/issues/${id}`, { status: next });
      await issues.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">Commuter reports</h1>
        <p className="text-sm text-slate-500">
          The only signal that says an estimate was wrong. Working through these is what
          keeps the numbers on the dashboard honest.
        </p>
      </header>

      <div className="card-pad grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="issue-status">
            Status
          </label>
          <select
            id="issue-status"
            className="field"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Any status</option>
            {ISSUE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="issue-kind-filter">
            Kind
          </label>
          <select
            id="issue-kind-filter"
            className="field"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="">Any kind</option>
            {ISSUE_KINDS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="issue-route-filter">
            Route
          </label>
          <select
            id="issue-route-filter"
            className="field"
            value={routeId}
            onChange={(event) => setRouteId(event.target.value)}
          >
            <option value="">All routes</option>
            {routes.data?.routes?.map((route) => (
              <option key={route.id} value={route.id}>
                {route.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ErrorNote error={error} />
      <ErrorNote error={issues.error} onRetry={issues.reload} />
      {issues.loading && !issues.data ? <Loading label="Loading the queue" /> : null}

      <Section
        title={issues.data ? plural(issues.data.issues.length, 'report') : 'Reports'}
        subtitle="Open first, newest first"
      >
        {issues.data?.issues?.length === 0 ? (
          <EmptyState title="Nothing in this filter">
            {status === 'open'
              ? 'No open report — either the information is holding up, or nobody is telling you when it does not.'
              : 'Try a wider filter.'}
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {issues.data?.issues?.map((issue) => (
              <li key={issue.id} className="card-pad space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`pill ${STATUS_TONE[issue.status]}`} title={STATUS_HINT[issue.status]}>
                    {issue.status}
                  </span>
                  <span className="font-semibold text-slate-800">{issue.kindLabel}</span>
                  {issue.routeCode ? (
                    <Link to={`/routes/${issue.routeId}`} className="pill bg-brand-50 text-brand-800">
                      {issue.routeCode}
                    </Link>
                  ) : null}
                  {issue.stopName ? (
                    <Link to={`/stops/${issue.stopId}`} className="link text-xs">
                      {issue.stopName}
                    </Link>
                  ) : null}
                  {issue.tripId ? (
                    <Link to={`/trips/${issue.tripId}`} className="link text-xs">
                      trip #{issue.tripId}
                    </Link>
                  ) : null}
                  <span className="ml-auto text-xs text-slate-400">{dateTime(issue.createdAt)}</span>
                </div>

                {issue.note ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    “{issue.note}”
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">
                    {issue.reporterName} · {issue.reporterEmail}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-1">
                    {ISSUE_STATUSES.filter((value) => value !== issue.status).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="btn-ghost py-1 text-xs"
                        title={STATUS_HINT[value]}
                        disabled={busy === issue.id}
                        onClick={() => setIssueStatus(issue.id, value)}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default AdminIssues;
