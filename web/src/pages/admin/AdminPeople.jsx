/**
 * Accounts and driver assignments (PRD FR-A1, FR-S5).
 *
 * This is the only place a driver or admin account can come into existence —
 * self-registration is hard-wired to `commuter` — so the ability to publish
 * check-ins, which every commuter's screen then trusts, is always granted
 * deliberately by someone who already has it.
 */
import { useEffect, useState } from 'react';
import { ROLES, ROLE_LABELS } from '@sptos/shared';
import api from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useFetch } from '../../lib/useLive.js';
import { plural } from '../../lib/format.js';
import { ErrorNote, Loading, Section } from '../../components/ui.jsx';

const EMPTY = { name: '', email: '', password: '', role: 'driver', phone: '' };

function NewUserForm({ onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.post('/api/admin/users', {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      });
      setDone(created.user);
      setForm(EMPTY);
      await onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const fields = error?.fieldErrors ?? {};

  return (
    <form className="card-pad grid gap-3 sm:grid-cols-3" onSubmit={submit}>
      <div>
        <label className="label" htmlFor="user-name">
          Name
        </label>
        <input
          id="user-name"
          className="field"
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        {fields.name ? <p className="mt-1 text-xs text-bad">{fields.name}</p> : null}
      </div>
      <div>
        <label className="label" htmlFor="user-email">
          Email
        </label>
        <input
          id="user-email"
          type="email"
          className="field"
          required
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />
        {fields.email ? <p className="mt-1 text-xs text-bad">{fields.email}</p> : null}
      </div>
      <div>
        <label className="label" htmlFor="user-role">
          Role
        </label>
        <select
          id="user-role"
          className="field"
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value })}
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="user-password">
          First password
        </label>
        <input
          id="user-password"
          className="field"
          required
          minLength={8}
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
        {fields.password ? <p className="mt-1 text-xs text-bad">{fields.password}</p> : null}
      </div>
      <div>
        <label className="label" htmlFor="user-phone">
          Phone <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input
          id="user-phone"
          className="field"
          value={form.phone}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
        />
      </div>
      <div className="flex items-end">
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </div>
      <div className="space-y-2 sm:col-span-3">
        <ErrorNote error={error} />
        {done ? (
          <p className="rounded-xl bg-good-soft px-3 py-2 text-sm text-good" role="status">
            Created {done.name} as {ROLE_LABELS[done.role]}. Tell them the password you just
            set — it is not shown again, and only you know it.
          </p>
        ) : null}
        <p className="text-xs text-slate-500">
          A driver still needs at least one route assigned before they can start a trip.
        </p>
      </div>
    </form>
  );
}

/** Which routes a driver may start a trip on. Checked again server-side. */
function AssignmentEditor({ user, routes, onSaved }) {
  const [selected, setSelected] = useState(() => new Set(user.routes.map((route) => route.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setSelected(new Set(user.routes.map((route) => route.id)));
  }, [user]);

  const toggle = (routeId) => {
    const next = new Set(selected);
    if (next.has(routeId)) next.delete(routeId);
    else next.add(routeId);
    setSelected(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/users/${user.id}/assignments`, { routeIds: [...selected] });
      await onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-pad space-y-3 border-brand-200 bg-brand-50">
      <p className="text-sm font-semibold text-brand-900">Routes {user.name} may drive</p>
      <div className="flex flex-wrap gap-2">
        {routes.map((route) => (
          <label
            key={route.id}
            className={`pill cursor-pointer ${
              selected.has(route.id) ? 'bg-brand-700 text-white' : 'bg-white text-slate-600'
            } ${route.isActive ? '' : 'opacity-60'}`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={selected.has(route.id)}
              onChange={() => toggle(route.id)}
            />
            {route.code}
            {route.isActive ? '' : ' (retired)'}
          </label>
        ))}
      </div>
      <ErrorNote error={error} />
      <button type="button" className="btn-primary py-1.5 text-xs" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save assignments'}
      </button>
    </div>
  );
}

function PasswordReset({ user, onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/users/${user.id}/password`, { password });
      setDone(true);
      setPassword('');
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card-pad space-y-2" onSubmit={submit}>
      <label className="label" htmlFor={`pw-${user.id}`}>
        New password for {user.name}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`pw-${user.id}`}
          className="field max-w-64"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" className="btn-ghost" disabled={busy}>
          {busy ? 'Setting…' : 'Set password'}
        </button>
      </div>
      <ErrorNote error={error} />
      {done ? <p className="text-xs text-good">Done. Pass it on in person, not by email.</p> : null}
    </form>
  );
}

export function AdminPeople() {
  const { user: me } = useAuth();
  const users = useFetch('/api/admin/users');
  const routes = useFetch('/api/admin/routes');
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const act = async (label, work) => {
    setBusy(label);
    setError(null);
    try {
      await work();
      await users.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const open = (id, kind) =>
    setPanel(panel?.id === id && panel?.kind === kind ? null : { id, kind });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">People</h1>
        <p className="text-sm text-slate-500">
          {users.data ? plural(users.data.users.length, 'account') : 'Loading'} · roles decide what
          each person can see and publish.
        </p>
      </header>

      <ErrorNote error={error} />
      <ErrorNote error={users.error} onRetry={users.reload} />
      {users.loading && !users.data ? <Loading /> : null}

      <Section title="Accounts">
        <div className="card overflow-x-auto">
          <table className="table-plain">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Routes</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data?.users?.map((entry) => {
                const isMe = entry.id === me?.id;
                return (
                  <tr key={entry.id} className={entry.isActive ? '' : 'bg-slate-50'}>
                    <td>
                      <span className="font-medium text-slate-800">
                        {entry.name}
                        {isMe ? <span className="ml-2 text-xs text-slate-400">(you)</span> : null}
                      </span>
                      <span className="block text-xs text-slate-500">{entry.email}</span>
                    </td>
                    <td>
                      <select
                        className="field w-auto py-1 text-xs"
                        value={entry.role}
                        disabled={isMe || busy === `role-${entry.id}`}
                        onChange={(event) =>
                          act(`role-${entry.id}`, () =>
                            api.patch(`/api/admin/users/${entry.id}`, {
                              role: event.target.value,
                            }),
                          )
                        }
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {entry.role !== 'driver' ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : entry.routes.length === 0 ? (
                        <span className="pill bg-warn-soft text-warn">none yet</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {entry.routes.map((route) => (
                            <span key={route.id} className="pill bg-brand-50 text-brand-800">
                              {route.code}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`pill ${
                          entry.isActive ? 'bg-good-soft text-good' : 'bg-mute-soft text-mute'
                        }`}
                      >
                        {entry.isActive ? 'active' : 'disabled'}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-1">
                        {entry.role === 'driver' ? (
                          <button
                            type="button"
                            className="btn-ghost py-1 text-xs"
                            onClick={() => open(entry.id, 'routes')}
                          >
                            Routes
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-ghost py-1 text-xs"
                          onClick={() => open(entry.id, 'password')}
                        >
                          Password
                        </button>
                        <button
                          type="button"
                          className={entry.isActive ? 'btn-danger py-1 text-xs' : 'btn-ghost py-1 text-xs'}
                          disabled={isMe || busy === `active-${entry.id}`}
                          title={isMe ? 'You cannot disable your own account.' : undefined}
                          onClick={() =>
                            act(`active-${entry.id}`, () =>
                              api.patch(`/api/admin/users/${entry.id}`, {
                                isActive: !entry.isActive,
                              }),
                            )
                          }
                        >
                          {entry.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {panel
          ? (() => {
              const entry = users.data?.users?.find((row) => row.id === panel.id);
              if (!entry) return null;
              if (panel.kind === 'routes') {
                return (
                  <AssignmentEditor
                    key={`routes-${entry.id}`}
                    user={entry}
                    routes={routes.data?.routes ?? []}
                    onSaved={async () => {
                      await users.reload();
                      setPanel(null);
                    }}
                  />
                );
              }
              return <PasswordReset key={`pw-${entry.id}`} user={entry} />;
            })()
          : null}
      </Section>

      <Section
        title="Add an account"
        subtitle="Drivers and administrators can only be created here (FR-S5)"
      >
        <NewUserForm onCreated={users.reload} />
      </Section>
    </div>
  );
}

export default AdminPeople;
