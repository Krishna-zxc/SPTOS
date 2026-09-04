/**
 * Flagging a bad update (PRD FR-C7).
 *
 * With no sensors on the vehicle, a commuter noticing "that bus is not where you
 * say it is" is the only correction signal the system has. So the form is one
 * dropdown and an optional sentence, and the confirmation says what happens next
 * — a report that vanishes into nothing does not get sent twice.
 */
import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useMeta } from '../lib/meta.jsx';
import api from '../lib/api.js';
import { ErrorNote } from './ui.jsx';

export function IssueReportForm({ routeId = null, stopId = null, tripId = null }) {
  const { user } = useAuth();
  const { issueKinds } = useMeta();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(issueKinds[0]?.value ?? 'other');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  if (!user) {
    return (
      <p className="text-xs text-slate-500">
        <a href="/signin" className="link">
          Sign in
        </a>{' '}
        to report a wrong position or a delay.
      </p>
    );
  }

  if (sent) {
    return (
      <p className="rounded-xl bg-good-soft px-3 py-2 text-sm text-good" role="status">
        Thanks — an administrator will see this in the reports queue.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setOpen(true)}>
        Report a problem with this information
      </button>
    );
  }

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/issues', {
        kind,
        ...(routeId ? { routeId: Number(routeId) } : {}),
        ...(stopId ? { stopId: Number(stopId) } : {}),
        ...(tripId ? { tripId: Number(tripId) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-2 rounded-xl bg-slate-50 p-3" onSubmit={submit}>
      <div>
        <label className="label" htmlFor="issue-kind">
          What looks wrong?
        </label>
        <select
          id="issue-kind"
          className="field"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          {issueKinds.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="issue-note">
          Anything to add? <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id="issue-note"
          className="field"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. the bus went past ten minutes ago"
        />
      </div>

      <ErrorNote error={error} />

      <div className="flex gap-2">
        <button type="submit" className="btn-primary py-1.5 text-xs" disabled={busy}>
          {busy ? 'Sending…' : 'Send report'}
        </button>
        <button
          type="button"
          className="btn-ghost py-1.5 text-xs"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default IssueReportForm;
