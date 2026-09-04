/** Small shared building blocks, so every screen reports states the same way. */
import { Link } from 'react-router-dom';

export function Spinner({ label = 'Loading' }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500" role="status">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700"
      />
      {label}…
    </span>
  );
}

export function Loading({ label }) {
  return (
    <div className="flex justify-center py-10">
      <Spinner label={label} />
    </div>
  );
}

/**
 * An error the user can act on. `error` is an ApiError, so a lost connection is
 * phrased as being offline rather than as a server fault.
 */
export function ErrorNote({ error, onRetry, className = '' }) {
  if (!error) return null;
  const offline = error.offline || !navigator.onLine;
  return (
    <div
      role="alert"
      className={`card flex flex-wrap items-center gap-3 border-red-200 bg-red-50 p-3 text-sm text-red-800 ${className}`}
    >
      <span className="font-semibold">{offline ? 'You are offline.' : 'Something went wrong.'}</span>
      <span className="text-red-700">{error.message}</span>
      {onRetry ? (
        <button type="button" className="btn-ghost ml-auto py-1.5 text-xs" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="font-semibold text-slate-700">{title}</p>
      {children ? <p className="max-w-sm text-sm text-slate-500">{children}</p> : null}
      {action}
    </div>
  );
}

export function Section({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`space-y-3 ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            {title ? <h2 className="text-lg font-bold text-slate-900">{title}</h2> : null}
            {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** One headline number on the admin dashboard. */
export function Stat({ label, value, hint, tone = 'default' }) {
  const tones = {
    default: 'text-slate-900',
    good: 'text-good',
    warn: 'text-warn',
    bad: 'text-bad',
  };
  return (
    <div className="card-pad">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** Shown whenever the browser itself reports no connection. */
export function OfflineBanner({ online, syncing, pending = 0 }) {
  if (online && !pending && !syncing) return null;
  const text = !online
    ? pending
      ? `Offline — ${pending} check-in${pending === 1 ? '' : 's'} saved on this phone`
      : 'Offline — check-ins will be saved and sent when signal returns'
    : syncing
      ? `Syncing ${pending || ''} check-in${pending === 1 ? '' : 's'}…`
      : `${pending} check-in${pending === 1 ? '' : 's'} waiting to send`;

  return (
    <p
      className={`pill w-full justify-center py-2 ${
        online ? 'bg-brand-50 text-brand-900' : 'bg-warn-soft text-warn'
      }`}
      role="status"
    >
      {text}
    </p>
  );
}

export function Crumb({ to, children }) {
  return (
    <Link to={to} className="text-sm font-semibold text-slate-500 hover:text-brand-700">
      ← {children}
    </Link>
  );
}

export function Toggle({ options, value, onChange, name }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-300 bg-white p-1" role="group" aria-label={name}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === option.value ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
