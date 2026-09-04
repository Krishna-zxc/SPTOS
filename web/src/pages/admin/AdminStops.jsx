/**
 * Stops (PRD FR-A1).
 *
 * Coordinates are the one field here with a visible failure mode: a mistyped
 * digit puts a bus in the sea, and because positions between check-ins are
 * interpolated between stop coordinates, it distorts the map for the whole
 * route. So each row links out to the exact point on OpenStreetMap — checking is
 * cheaper than debugging it later from a commuter's screenshot.
 */
import { useState } from 'react';
import api from '../../lib/api.js';
import { useFetch } from '../../lib/useLive.js';
import { plural } from '../../lib/format.js';
import { ErrorNote, Loading, Section } from '../../components/ui.jsx';

const EMPTY = { code: '', name: '', latitude: '', longitude: '' };

function StopForm({ initial = EMPTY, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        code: form.code.trim(),
        name: form.name.trim(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      });
      if (!onCancel) setForm(EMPTY);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const fields = error?.fieldErrors ?? {};

  return (
    <form className="card-pad grid gap-3 sm:grid-cols-5" onSubmit={submit}>
      <div>
        <label className="label" htmlFor={`stop-code-${initial.code}`}>
          Code
        </label>
        <input
          id={`stop-code-${initial.code}`}
          className="field"
          required
          value={form.code}
          placeholder="STN-01"
          onChange={(event) => setForm({ ...form, code: event.target.value })}
        />
        {fields.code ? <p className="mt-1 text-xs text-bad">{fields.code}</p> : null}
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`stop-name-${initial.code}`}>
          Name
        </label>
        <input
          id={`stop-name-${initial.code}`}
          className="field"
          required
          value={form.name}
          placeholder="Railway Station"
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        {fields.name ? <p className="mt-1 text-xs text-bad">{fields.name}</p> : null}
      </div>
      <div>
        <label className="label" htmlFor={`stop-lat-${initial.code}`}>
          Latitude
        </label>
        <input
          id={`stop-lat-${initial.code}`}
          className="field"
          required
          type="number"
          step="0.000001"
          value={form.latitude}
          onChange={(event) => setForm({ ...form, latitude: event.target.value })}
        />
        {fields.latitude ? <p className="mt-1 text-xs text-bad">{fields.latitude}</p> : null}
      </div>
      <div>
        <label className="label" htmlFor={`stop-lng-${initial.code}`}>
          Longitude
        </label>
        <input
          id={`stop-lng-${initial.code}`}
          className="field"
          required
          type="number"
          step="0.000001"
          value={form.longitude}
          onChange={(event) => setForm({ ...form, longitude: event.target.value })}
        />
        {fields.longitude ? <p className="mt-1 text-xs text-bad">{fields.longitude}</p> : null}
      </div>
      <div className="flex gap-2 sm:col-span-5">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
        <ErrorNote error={error} className="w-full" />
      </div>
    </form>
  );
}

export function AdminStops() {
  const stops = useFetch('/api/stops', { params: { limit: 100 } });
  const [editing, setEditing] = useState(null);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">Stops</h1>
        <p className="text-sm text-slate-500">
          {stops.data ? plural(stops.data.stops.length, 'stop') : 'Loading'} · a stop can serve
          several routes, and is only removed from a route by editing that route's sequence.
        </p>
      </header>

      <ErrorNote error={stops.error} onRetry={stops.reload} />
      {stops.loading && !stops.data ? <Loading /> : null}

      <Section title="All stops">
        <div className="card overflow-x-auto">
          <table className="table-plain">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Routes</th>
                <th>Coordinates</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stops.data?.stops?.map((stop) => (
                <tr key={stop.id}>
                  <td className="font-mono text-xs text-slate-500">{stop.code}</td>
                  <td className="font-medium text-slate-800">{stop.name}</td>
                  <td>
                    {stop.routes.length === 0 ? (
                      <span className="text-xs text-slate-400">on no active route</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {stop.routes.map((route) => (
                          <span key={route.id} className="pill bg-brand-50 text-brand-800">
                            {route.code}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap font-mono text-xs text-slate-500">
                    <a
                      className="link"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://www.openstreetmap.org/?mlat=${stop.latitude}&mlon=${stop.longitude}#map=17/${stop.latitude}/${stop.longitude}`}
                    >
                      {stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}
                    </a>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-ghost py-1 text-xs"
                      onClick={() => setEditing(editing === stop.id ? null : stop.id)}
                    >
                      {editing === stop.id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editing
          ? (() => {
              const stop = stops.data.stops.find((entry) => entry.id === editing);
              if (!stop) return null;
              return (
                <StopForm
                  key={stop.id}
                  initial={{
                    code: stop.code,
                    name: stop.name,
                    latitude: String(stop.latitude),
                    longitude: String(stop.longitude),
                  }}
                  submitLabel="Save changes"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (body) => {
                    await api.patch(`/api/admin/stops/${stop.id}`, body);
                    setEditing(null);
                    await stops.reload();
                  }}
                />
              );
            })()
          : null}
      </Section>

      <Section
        title="Add a stop"
        subtitle="Then add it to a route's sequence — a stop on no route is invisible to commuters"
      >
        <StopForm
          submitLabel="Add stop"
          onSubmit={async (body) => {
            await api.post('/api/admin/stops', body);
            await stops.reload();
          }}
        />
      </Section>
    </div>
  );
}

export default AdminStops;
