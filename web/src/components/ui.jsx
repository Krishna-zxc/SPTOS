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

/**
 * A block standing in for a value that has not arrived.
 *
 * Preferred over a spinner wherever the shape of the answer is already known,
 * because it keeps the layout from jumping when the data lands — a spinner that
 * is replaced by three rows of table moves everything under it twice.
 */
export function Skeleton({ className = '', rounded = 'rounded-lg' }) {
  return <span aria-hidden="true" className={`skeleton block ${rounded} ${className}`} />;
}

/**
 * The generic wait.
 *
 * `rows` draws that many card-shaped placeholders instead of a spinner; pass 0
 * for the spinner, which is right when what is loading is a single value rather
 * than a list.
 */
export function Loading({ label, rows = 0 }) {
  if (rows > 0) {
    return (
      <div className="space-y-2" role="status" aria-label={label ?? 'Loading'}>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="card-pad space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="animate-pop flex justify-center py-10">
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
      className={`card animate-drop flex flex-wrap items-center gap-3 border-red-200 bg-red-50 p-3 text-sm text-red-800 ${className}`}
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
    <div className="card animate-pop flex flex-col items-center gap-2 px-6 py-10 text-center">
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

/**
 * One headline number on the admin dashboard.
 *
 * The tone is carried by a left edge rather than by colouring the whole card, so
 * a grid of six of them still scans as one row of numbers — and a bad metric is
 * still findable at a glance without the page turning into a traffic light.
 */
export function Stat({ label, value, hint, tone = 'default' }) {
  const tones = {
    default: { text: 'text-slate-900', edge: 'before:bg-slate-200' },
    good: { text: 'text-good', edge: 'before:bg-good' },
    warn: { text: 'text-warn', edge: 'before:bg-warn' },
    bad: { text: 'text-bad', edge: 'before:bg-bad' },
  };
  const { text, edge } = tones[tone] ?? tones.default;

  return (
    <div
      className={`card-pad relative overflow-hidden before:absolute before:inset-y-0 before:left-0
        before:w-1 before:origin-top before:animate-grow-y ${edge}`}
    >
      <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wide text-slate-500 line-clamp-1">{label}</p>
      <p className={`animate-drop mt-1 text-xl sm:text-2xl font-bold tabular-nums ${text}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] sm:text-xs text-slate-500 line-clamp-2 leading-relaxed">{hint}</p> : null}
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
      className={`pill animate-drop w-full justify-center py-2 text-xs sm:text-sm text-center ${
        online ? 'bg-brand-50 text-brand-900' : 'bg-warn-soft text-warn'
      }`}
      role="status"
    >
      {syncing ? (
        <span
          aria-hidden="true"
          className="size-3 animate-spin rounded-full border-2 border-brand-200 border-t-brand-700 mr-1.5"
        />
      ) : null}
      {text}
    </p>
  );
}

export function Crumb({ to, children }) {
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-1.5 py-1 text-sm font-semibold text-slate-500 transition-colors hover:text-brand-700 min-h-[36px]"
    >
      <span
        aria-hidden="true"
        className="transition-transform duration-200 group-hover:-translate-x-0.5 text-base"
      >
        ←
      </span>
      {children}
    </Link>
  );
}

/**
 * A segmented control.
 *
 * The selection is a single absolutely-positioned thumb that slides, rather than
 * a background colour swapping between buttons: the movement is what tells you
 * which way you just went, which matters most on the driver screen where the
 * options ("GPS on/off") are read at a glance.
 */
export function Toggle({ options, value, onChange, name }) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div
      className="relative inline-flex max-w-full rounded-xl border border-slate-300 bg-white p-1"
      role="group"
      aria-label={name}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-lg bg-brand-700 shadow-sm transition-transform duration-300 ease-out-soft"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`relative z-10 flex-1 min-w-[72px] rounded-lg px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors duration-200 text-center ${
            value === option.value ? 'text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
