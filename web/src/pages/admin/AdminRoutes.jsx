/**
 * Routes and their stop sequences (PRD FR-A1).
 *
 * The stop sequence *is* the timetable: the driver app derives "next stop" from
 * it, FR-A3 measures delay against the planned offsets, and the ETA engine falls
 * back to them wherever there is no measured history yet. So this screen is
 * deliberately explicit about the offsets rather than hiding them behind a
 * drag-and-drop, and it says out loud that retiring a route keeps its history.
 */
import { useEffect, useMemo, useState } from 'react';
import api from '../../lib/api.js';
import { useFetch } from '../../lib/useLive.js';
import { durationText, plural } from '../../lib/format.js';
import { ErrorNote, Loading, Section } from '../../components/ui.jsx';

/** Adding a route. Kept inline: the pilot has three, not three hundred. */
function NewRouteForm({ onCreated }) {
  const [form, setForm] = useState({ code: '', name: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/routes', {
        code: form.code.trim(),
        name: form.name.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      });
      setForm({ code: '', name: '', description: '' });
      await onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const fields = error?.fieldErrors ?? {};

  return (
    <form className="card-pad grid gap-3 sm:grid-cols-4" onSubmit={submit}>
      <div>
        <label className="label" htmlFor="route-code">
          Code
        </label>
        <input
          id="route-code"
          className="field"
          required
          value={form.code}
          placeholder="12A"
          onChange={(event) => setForm({ ...form, code: event.target.value })}
        />
        {fields.code ? <p className="mt-1 text-xs text-bad">{fields.code}</p> : null}
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="route-name">
          Name
        </label>
        <input
          id="route-name"
          className="field"
          required
          value={form.name}
          placeholder="Station → Civil Lines"
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        {fields.name ? <p className="mt-1 text-xs text-bad">{fields.name}</p> : null}
      </div>
      <div className="flex items-end">
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Adding…' : 'Add route'}
        </button>
      </div>
      <div className="sm:col-span-4">
        <label className="label" htmlFor="route-description">
          Description <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input
          id="route-description"
          className="field"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </div>
      <div className="sm:col-span-4">
        <ErrorNote error={error} />
        <p className="text-xs text-slate-500">
          A new route has no stops yet, so no trip can be started on it until you set
          its sequence below.
        </p>
      </div>
    </form>
  );
}

export function AdminRoutes() {
  const routes = useFetch('/api/admin/routes');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const act = async (label, work) => {
    setBusy(label);
    setError(null);
    try {
      await work();
      await routes.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">Routes & stop sequences</h1>
        <p className="text-sm text-slate-500">
          The sequence and its planned offsets are what the driver app, the estimates
          and the punctuality report all read.
        </p>
      </header>

      <ErrorNote error={error} />
      <ErrorNote error={routes.error} onRetry={routes.reload} />
      {routes.loading && !routes.data ? <Loading /> : null}

      <Section title="Routes">
        <div className="card overflow-x-auto">
          <table className="table-plain">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th className="text-right">Stops</th>
                <th className="text-right">Trips</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {routes.data?.routes?.map((route) => (
                <tr key={route.id} className={route.isActive ? '' : 'bg-slate-50'}>
                  <td className="font-semibold text-slate-800">{route.code}</td>
                  <td>
                    <span className="text-slate-700">{route.name}</span>
                    {route.description ? (
                      <span className="block text-xs text-slate-400">{route.description}</span>
                    ) : null}
                  </td>
                  <td className="text-right">{route.stopCount}</td>
                  <td className="text-right">{route.tripCount}</td>
                  <td>
                    <span
                      className={`pill ${
                        route.isActive ? 'bg-good-soft text-good' : 'bg-mute-soft text-mute'
                      }`}
                    >
                      {route.isActive ? 'active' : 'retired'}
                    </span>
                  </td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-1">
                      <button
                        type="button"
                        className="btn-ghost py-1 text-xs"
                        onClick={() => setSelected(selected === route.id ? null : route.id)}
                      >
                        {selected === route.id ? 'Close' : 'Stops'}
                      </button>
                      {route.isActive ? (
                        <button
                          type="button"
                          className="btn-danger py-1 text-xs"
                          disabled={busy === `retire-${route.id}`}
                          onClick={() =>
                            act(`retire-${route.id}`, () =>
                              api.del(`/api/admin/routes/${route.id}`),
                            )
                          }
                        >
                          Retire
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost py-1 text-xs"
                          disabled={busy === `restore-${route.id}`}
                          onClick={() =>
                            act(`restore-${route.id}`, () =>
                              api.patch(`/api/admin/routes/${route.id}`, { isActive: true }),
                            )
                          }
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          Retiring hides a route from commuters and drivers but keeps its trips, because
          those are the history every future estimate is averaged from.
        </p>
      </Section>

      {selected ? <StopSequence routeId={selected} onSaved={routes.reload} /> : null}

      <Section title="Add a route">
        <NewRouteForm onCreated={routes.reload} />
      </Section>
    </div>
  );
}

/**
 * The sequence editor.
 *
 * Offsets are entered in whole minutes from the start of the trip, because that
 * is how a timetable is actually written down. They must increase along the
 * route — a later stop planned earlier than an earlier one would make every delay
 * measurement on that segment meaningless — so that is checked before saving.
 */
function StopSequence({ routeId, onSaved }) {
  const detail = useFetch(`/api/routes/${routeId}`);
  const pool = useFetch('/api/stops', { params: { limit: 100 } });

  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    setRows(
      detail.data.stops.map((stop) => ({
        stopId: stop.stopId,
        code: stop.code,
        name: stop.name,
        minutes: Math.round(stop.scheduledOffsetSeconds / 60),
      })),
    );
    setSaved(false);
  }, [detail.data]);

  const available = useMemo(() => {
    const taken = new Set(rows.map((row) => row.stopId));
    return (pool.data?.stops ?? []).filter((stop) => !taken.has(stop.id));
  }, [pool.data, rows]);

  const move = (index, delta) => {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    setSaved(false);
  };

  const addStop = () => {
    const stop = (pool.data?.stops ?? []).find((entry) => entry.id === Number(adding));
    if (!stop) return;
    const previous = rows.at(-1)?.minutes ?? 0;
    setRows([
      ...rows,
      { stopId: stop.id, code: stop.code, name: stop.name, minutes: previous + 5 },
    ]);
    setAdding('');
    setSaved(false);
  };

  const outOfOrder = rows.some((row, index) => index > 0 && row.minutes <= rows[index - 1].minutes);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/routes/${routeId}/stops`, {
        stops: rows.map((row) => ({
          stopId: row.stopId,
          scheduledOffsetSeconds: Math.max(0, Math.round(row.minutes * 60)),
        })),
      });
      setSaved(true);
      await Promise.all([detail.reload(), onSaved()]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!detail.data) return <Loading label="Loading the sequence" />;

  return (
    <Section
      title={`Stop sequence — ${detail.data.route.code}`}
      subtitle="Offsets are minutes from the start of the trip. The first stop is 0 by definition."
    >
      <ErrorNote error={error} />
      {saved ? (
        <p className="rounded-xl bg-good-soft px-3 py-2 text-sm text-good" role="status">
          Saved. {plural(rows.length, 'stop')} on this route.
        </p>
      ) : null}

      <ol className="card divide-y divide-slate-100">
        {rows.map((row, index) => (
          <li key={row.stopId} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-slate-800">{row.name}</span>
              <span className="block font-mono text-xs text-slate-400">{row.code}</span>
            </span>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <span className="sr-only">Planned offset for {row.name}</span>
              <input
                type="number"
                min={0}
                max={1440}
                className="field w-20 py-1 text-right"
                value={row.minutes}
                disabled={index === 0}
                onChange={(event) => {
                  const next = [...rows];
                  next[index] = { ...row, minutes: Number(event.target.value) };
                  setRows(next);
                  setSaved(false);
                }}
              />
              min
            </label>
            <div className="flex gap-1">
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                aria-label={`Move ${row.name} earlier`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                aria-label={`Move ${row.name} later`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn-danger px-2 py-1 text-xs"
                onClick={() => {
                  setRows(rows.filter((entry) => entry.stopId !== row.stopId));
                  setSaved(false);
                }}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>

      <div className="card-pad flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="add-stop">
            Add a stop to the end
          </label>
          <select
            id="add-stop"
            className="field"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
          >
            <option value="">Choose a stop…</option>
            {available.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {stop.name} ({stop.code})
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-ghost" disabled={!adding} onClick={addStop}>
          Add
        </button>
      </div>

      {rows.length < 2 ? (
        <p className="text-xs text-warn">A route needs at least two stops before it can be saved.</p>
      ) : null}
      {outOfOrder ? (
        <p className="text-xs text-warn">
          Each offset has to be later than the one before it, otherwise delay on that
          segment cannot be measured.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || rows.length < 2 || outOfOrder}
          onClick={save}
        >
          {busy ? 'Saving…' : 'Save sequence'}
        </button>
        <span className="text-xs text-slate-500">
          Whole journey planned at {durationText((rows.at(-1)?.minutes ?? 0) * 60)}. Saving is
          refused while a bus is mid-route on this route.
        </span>
      </div>
    </Section>
  );
}

export default AdminRoutes;
