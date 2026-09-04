/**
 * Sign in, or create a commuter account (PRD FR-S5).
 *
 * Registration here can only ever produce a commuter — the server hard-wires the
 * role — so the form says so plainly rather than offering a role picker that
 * would be rejected. Driver and admin accounts come from the admin screens.
 */
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_HOME } from '@sptos/shared';
import { useAuth } from '../lib/auth.jsx';
import { ErrorNote, Toggle } from '../components/ui.jsx';

const DEMO = [
  { name: 'Riya Sharma', email: 'riya@sptos.local', role: 'Commuter', password: 'sptos1234' },
  { name: 'Suresh Patil', email: 'suresh@sptos.local', role: 'Driver', password: 'sptos1234' },
  { name: 'Krishna Gupta', email: 'krishna@sptos.local', role: 'Administrator', password: 'krishnagg' },
];

export function SignIn() {
  const { user, signIn, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={location.state?.from ?? ROLE_HOME[user.role] ?? '/'} replace />;

  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  const fieldError = error?.fieldErrors ?? {};

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const nextUser =
        mode === 'signin'
          ? await signIn(form.email, form.password)
          : await register({
              name: form.name,
              email: form.email,
              password: form.password,
              ...(form.phone ? { phone: form.phone } : {}),
            });
      navigate(location.state?.from ?? ROLE_HOME[nextUser.role] ?? '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="text-center">
        <h1 className="text-xl font-bold text-slate-900">
          {mode === 'signin' ? 'Sign in' : 'Create an account'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          You can track buses without an account. Signing in adds saved stops,
          arrival alerts and the ability to report a bad update.
        </p>
      </div>

      <div className="flex justify-center">
        <Toggle
          name="Sign in or register"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
          }}
          options={[
            { value: 'signin', label: 'Sign in' },
            { value: 'register', label: 'Register' },
          ]}
        />
      </div>

      <form className="card-pad space-y-3" onSubmit={submit} noValidate>
        {mode === 'register' ? (
          <div>
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input id="name" className="field" value={form.name} onChange={set('name')} required />
            {fieldError.name ? <p className="mt-1 text-xs text-bad">{fieldError.name}</p> : null}
          </div>
        ) : null}

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="field"
            value={form.email}
            onChange={set('email')}
            required
          />
          {fieldError.email ? <p className="mt-1 text-xs text-bad">{fieldError.email}</p> : null}
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className="field"
            value={form.password}
            onChange={set('password')}
            required
          />
          {fieldError.password ? (
            <p className="mt-1 text-xs text-bad">{fieldError.password}</p>
          ) : null}
        </div>

        {mode === 'register' ? (
          <>
            <div>
              <label className="label" htmlFor="phone">
                Phone <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input id="phone" className="field" value={form.phone} onChange={set('phone')} />
            </div>
            <p className="text-xs text-slate-500">
              New accounts are commuter accounts. Driver and administrator access is
              granted by an administrator.
            </p>
          </>
        ) : null}

        <ErrorNote error={error} />

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <div className="card-pad space-y-2 text-xs text-slate-500">
        <p className="font-semibold text-slate-700">Demo accounts (Tap to autofill)</p>
        <div className="space-y-2">
          {DEMO.map((entry) => (
            <button
              key={entry.email}
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand-500 hover:bg-brand-50/50 active:scale-[0.99]"
              onClick={() => {
                setMode('signin');
                setForm({ ...form, email: entry.email, password: entry.password });
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900 text-sm">{entry.name}</div>
                <div className="font-mono text-xs text-slate-500 truncate">{entry.email}</div>
              </div>
              <div className="text-right shrink-0">
                <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{entry.role}</span>
                <div className="font-mono text-[11px] text-slate-400 mt-0.5">pwd: {entry.password}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <p className="text-center text-xs text-slate-400">
        <Link to="/" className="link">
          Continue without signing in
        </Link>
      </p>
    </div>
  );
}

export default SignIn;
