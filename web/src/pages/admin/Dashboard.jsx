/**
 * The planning dashboard (PRD FR-A2, FR-A3, FR-A6 and the §4 scorecard).
 *
 * Two audiences in one page. The scorecard at the top answers "is the pilot
 * working" — check-in coverage, ETA accuracy, update freshness — which is what
 * §4 says the project is judged on. Everything below answers "what should the
 * operator change" — where demand concentrates and which segments lose time.
 *
 * Sample counts are shown next to every figure on purpose. An MAE computed from
 * nine predictions is not a result, and the dashboard should not let anyone read
 * it as one.
 */
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../../lib/api.js';
import { TIME_BANDS } from '@sptos/shared';
import { useFetch } from '../../lib/useLive.js';
import { durationText, delayText, percent, plural } from '../../lib/format.js';
import { ErrorNote, Loading, Section, Stat } from '../../components/ui.jsx';

const CHART_HEIGHT = 260;

/** Coverage and accuracy read as pass/fail, so they get a colour. */
const coverageTone = (share) =>
  share === null ? 'default' : share >= 0.9 ? 'good' : share >= 0.7 ? 'warn' : 'bad';
const maeTone = (seconds) =>
  seconds === null ? 'default' : seconds <= 180 ? 'good' : seconds <= 300 ? 'warn' : 'bad';

function ExportMenu({ params }) {
  const { data } = useFetch('/api/admin/exports');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const run = async (key) => {
    setBusy(key);
    setError(null);
    try {
      await api.download(`/api/admin/export/${key}`, params);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {data?.datasets?.map((dataset) => (
          <button
            key={dataset.key}
            type="button"
            className="btn-ghost py-1.5 text-xs"
            disabled={busy !== null}
            onClick={() => run(dataset.key)}
          >
            {busy === dataset.key ? 'Preparing…' : `⤓ ${dataset.key}.csv`}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

export function Dashboard() {
  const [routeId, setRouteId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = {
    ...(routeId ? { routeId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const routes = useFetch('/api/admin/routes');
  const ops = useFetch('/api/admin/analytics/operations', { params });
  const demand = useFetch('/api/admin/analytics/demand', { params });
  const punctuality = useFetch('/api/admin/analytics/punctuality', { params });

  const summary = ops.data;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">Operations dashboard</h1>
        <p className="text-sm text-slate-500">
          Everything here is computed from driver check-ins. Thin numbers mean thin
          check-in coverage, not a quiet period.
        </p>
      </header>

      <div className="card-pad grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="filter-route">
            Route
          </label>
          <select
            id="filter-route"
            className="field"
            value={routeId}
            onChange={(event) => setRouteId(event.target.value)}
          >
            <option value="">All routes</option>
            {routes.data?.routes?.map((route) => (
              <option key={route.id} value={route.id}>
                {route.code} — {route.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="filter-from">
            From
          </label>
          <input
            id="filter-from"
            type="date"
            className="field"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="filter-to">
            To
          </label>
          <input
            id="filter-to"
            type="date"
            className="field"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <p className="text-xs text-slate-500 sm:col-span-3">
          {from || to ? 'Custom window.' : 'Showing the last 30 days.'}
        </p>
      </div>

      <ErrorNote error={ops.error} onRetry={ops.reload} />
      {ops.loading && !summary ? <Loading label="Crunching the pilot metrics" /> : null}

      {summary ? (
        <Section
          title="Pilot scorecard"
          subtitle="The four measures §4 of the PRD asks the pilot to report"
        >
          <div className="grid gap-2.5 sm:gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Check-in coverage"
              value={percent(summary.checkinCoverage.averageShare)}
              tone={coverageTone(summary.checkinCoverage.averageShare)}
              hint={`Avg share · ${plural(
                summary.checkinCoverage.tripsMeasured,
                'trip',
              )}`}
            />
            <Stat
              label="ETA accuracy (MAE)"
              value={
                summary.etaAccuracy.maeSeconds === null
                  ? '—'
                  : durationText(summary.etaAccuracy.maeSeconds)
              }
              tone={maeTone(summary.etaAccuracy.maeSeconds)}
              hint={
                summary.etaAccuracy.resolvedPredictions === 0
                  ? 'No prediction resolved yet'
                  : `${plural(summary.etaAccuracy.resolvedPredictions, 'prediction')} · bias ${delayText(summary.etaAccuracy.biasSeconds)}`
              }
            />
            <Stat
              label="Update freshness"
              value={
                summary.updateFreshness.medianGapSeconds === null
                  ? '—'
                  : durationText(summary.updateFreshness.medianGapSeconds)
              }
              hint="Median gap between check-ins"
            />
            <Stat
              label="Adoption"
              value={`${summary.adoption.activeDrivers}/${summary.adoption.registeredDrivers}`}
              hint={`Drivers · ${plural(summary.adoption.activeRoutes, 'route')} · ${plural(summary.adoption.registeredCommuters, 'commuter')}`}
            />
          </div>

          <div className="grid gap-2.5 sm:gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="Trips" value={summary.trips.total} hint="Started in window" />
            <Stat label="Completed" value={summary.trips.completed} tone="good" />
            <Stat
              label="Cancelled"
              value={summary.trips.cancelled}
              tone={summary.trips.cancelled ? 'warn' : 'default'}
              hint="Excluded from ETA"
            />
            <Stat
              label="Open reports"
              value={summary.adoption.openIssues}
              tone={summary.adoption.openIssues ? 'warn' : 'good'}
              hint="Flags on triage"
            />
          </div>
        </Section>
      ) : null}

      <Section
        title="Demand by time band"
        subtitle="Check-ins are the boarding proxy; the line is average load factor"
      >
        <ErrorNote error={demand.error} onRetry={demand.reload} />
        {demand.data?.byBand?.length === 0 ? (
          <p className="card-pad text-sm text-slate-500">
            No check-ins in this window, so there is nothing to aggregate.
          </p>
        ) : (
          <div className="card p-2 sm:p-3 overflow-hidden">
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={bandSeries(demand.data?.byBand)} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="bandLabel" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(value, key) =>
                    key === 'crowded' ? [value, 'Crowded check-ins'] : [value, 'Check-ins']
                  }
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="checkins" name="Check-ins" fill="#0f766e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="crowded" name="Standing or full" fill="#b45309" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section title="Busiest stops" subtitle="Where extra capacity would actually be felt">
        {demand.data?.byStop?.length ? (
          <div className="card overflow-x-auto">
            <table className="table-plain">
              <thead>
                <tr>
                  <th>Stop</th>
                  <th>Band</th>
                  <th>Day</th>
                  <th className="text-right">Check-ins</th>
                  <th className="text-right">Avg load</th>
                  <th className="text-right">Crowded</th>
                </tr>
              </thead>
              <tbody>
                {demand.data.byStop.slice(0, 12).map((row) => (
                  <tr key={`${row.stopId}-${row.band}-${row.dayType}`}>
                    <td>
                      <span className="font-medium text-slate-800">{row.stopName}</span>
                      <span className="ml-2 font-mono text-xs text-slate-400">{row.stopCode}</span>
                    </td>
                    <td className="text-slate-600">{row.bandLabel}</td>
                    <td className="text-slate-600">{row.dayType}</td>
                    <td className="text-right font-semibold">{row.checkins}</td>
                    <td className="text-right">{percent(row.avgLoadFactor)}</td>
                    <td className="text-right">{percent(row.crowdedShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Section
        title="Punctuality by route"
        subtitle="Delay is measured against each stop's planned offset from the trip's own start, so a late departure is not counted twice"
      >
        <ErrorNote error={punctuality.error} onRetry={punctuality.reload} />
        {punctuality.data?.byRoute?.length ? (
          <div className="card overflow-x-auto">
            <table className="table-plain">
              <thead>
                <tr>
                  <th>Route</th>
                  <th className="text-right">Observations</th>
                  <th className="text-right">Median</th>
                  <th className="text-right">Average</th>
                  <th className="text-right">Worst</th>
                  <th className="text-right">On time</th>
                </tr>
              </thead>
              <tbody>
                {punctuality.data.byRoute.map((row) => (
                  <tr key={row.routeId}>
                    <td>
                      <span className="font-semibold text-slate-800">{row.routeCode}</span>
                      <span className="ml-2 text-xs text-slate-500">{row.routeName}</span>
                    </td>
                    <td className="text-right">{row.samples}</td>
                    <td className="text-right">{delayText(row.medianDelaySeconds)}</td>
                    <td className="text-right">{delayText(row.avgDelaySeconds)}</td>
                    <td className="text-right">{delayText(row.worstDelaySeconds)}</td>
                    <td className="text-right font-semibold">{percent(row.onTimeShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-slate-500">
              “On time” means within {durationText(punctuality.data.toleranceSeconds)} of the plan.
            </p>
          </div>
        ) : (
          <p className="card-pad text-sm text-slate-500">
            No stop on any route has both a planned offset and a check-in in this window
            yet, so punctuality cannot be measured.
          </p>
        )}
      </Section>

      {punctuality.data?.bySegment?.length ? (
        <Section
          title="Where time is lost"
          subtitle="The ten stops arriving furthest from plan — these are the candidates for a schedule change"
        >
          <div className="card p-2 sm:p-3 overflow-hidden">
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart
                data={punctuality.data.bySegment.slice(0, 10).map((row) => ({
                  label: `${row.routeCode} · ${row.stopName}`,
                  minutes: Math.round(((row.medianDelaySeconds ?? 0) / 60) * 10) / 10,
                }))}
                layout="vertical"
                margin={{ top: 5, left: -10, right: 15, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} unit="m" />
                <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(value) => [`${value} min`, 'Median delay']} />
                <Bar dataKey="minutes" radius={[0, 4, 4, 0]}>
                  {punctuality.data.bySegment.slice(0, 10).map((row) => (
                    <Cell
                      key={`${row.routeId}-${row.stopId}`}
                      fill={(row.medianDelaySeconds ?? 0) > 300 ? '#b91c1c' : '#b45309'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      ) : null}

      <Section
        title="Export"
        subtitle="Same window and route filter as above (FR-A6). Opens in any spreadsheet."
      >
        <ExportMenu params={params} />
      </Section>
    </div>
  );
}

/**
 * Recharts wants one row per x value, so weekday/weekend are summed here — and
 * the bands are put back in clock order, which is how a planner reads a day.
 */
function bandSeries(byBand = []) {
  const merged = new Map();
  for (const row of byBand) {
    const entry = merged.get(row.band) ?? {
      band: row.band,
      bandLabel: row.bandLabel,
      checkins: 0,
      crowded: 0,
    };
    entry.checkins += row.checkins;
    entry.crowded += row.crowdedCheckins;
    merged.set(row.band, entry);
  }
  return TIME_BANDS.map((band) => merged.get(band.key)).filter(Boolean);
}

export default Dashboard;
