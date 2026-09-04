/**
 * The check-in screen (PRD FR-D2 … FR-D6).
 *
 * The whole system's data comes from this one page, pressed by someone holding a
 * steering wheel. So the design constraint is brutal: a check-in is *one* tap.
 * The stop is derived server-side, and the crowd-level button doubles as the
 * confirm — tapping "Seats free" both reports occupancy and logs the departure.
 *
 * The tap never waits for the network (FR-D6). It writes to the outbox with the
 * timestamp of the tap and returns; the queue drains in the background. That is
 * why the "next stop" shown here is projected from server state *plus* whatever
 * is still queued locally — otherwise a driver in a dead zone would be asked to
 * confirm the same stop repeatedly.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { OCCUPANCY_LEVELS, occupancyLabel } from '@sptos/shared';
import api from '../../lib/api.js';
import { useFetch } from '../../lib/useLive.js';
import { discardRejected, enqueue, useOutbox } from '../../lib/outbox.js';
import { clockTime, plural } from '../../lib/format.js';
import {
  Crumb,
  ErrorNote,
  Loading,
  OfflineBanner,
  Section,
  Toggle,
} from '../../components/ui.jsx';

/** GPS is a refinement, not a requirement — one fix every 20s is plenty. */
const POSITION_MIN_GAP_MS = 20_000;

const TAP_TONE = {
  good: 'bg-good-soft text-good hover:bg-good-soft/70',
  warn: 'bg-warn-soft text-warn hover:bg-warn-soft/70',
  bad: 'bg-bad-soft text-bad hover:bg-bad-soft/70',
};

/**
 * Optional phone GPS (FR-D4). Sharpens the map between stops; the check-in is
 * still the source of truth. Runs only while the trip is active, per the privacy
 * NFR — the watch is torn down the moment this unmounts.
 */
function useDriverGps(tripId, enabled) {
  const [state, setState] = useState({ fix: null, error: null });
  const lastSent = useRef(0);
  const latest = useRef(null);

  useEffect(() => {
    if (!enabled || !tripId || !navigator.geolocation) return undefined;

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const fix = {
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
          accuracy: Math.round(position.coords.accuracy ?? 0),
          at: new Date().toISOString(),
        };
        latest.current = fix;
        setState({ fix, error: null });

        const now = Date.now();
        if (now - lastSent.current < POSITION_MIN_GAP_MS) return;
        lastSent.current = now;
        api
          .post(`/api/driver/trips/${tripId}/positions`, {
            latitude: fix.latitude,
            longitude: fix.longitude,
          })
          // A dropped breadcrumb is not worth interrupting the driver over.
          .catch(() => {});
      },
      (error) => setState((prev) => ({ ...prev, error: error.message })),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );

    return () => navigator.geolocation.clearWatch(watch);
  }, [enabled, tripId]);

  return { ...state, latest };
}

export function DriverTrip() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useFetch(`/api/driver/trips/${tripId}`);

  const [gpsOn, setGpsOn] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmClose, setConfirmClose] = useState(null);

  const gps = useDriverGps(tripId, gpsOn && data?.trip?.status === 'active');
  const outbox = useOutbox(tripId, { onDrained: reload });

  const tap = useCallback(
    (occupancy) => {
      setActionError(null);
      const fix = gps.latest.current;
      enqueue(tripId, {
        occupancy,
        ...(fix ? { latitude: fix.latitude, longitude: fix.longitude } : {}),
      });
    },
    [tripId, gps.latest],
  );

  const closeTrip = async (kind) => {
    setBusy(kind);
    setActionError(null);
    try {
      await api.post(`/api/driver/trips/${tripId}/${kind}`);
      navigate('/driver');
    } catch (err) {
      setActionError(err);
      setBusy(null);
    }
  };

  const correct = async (checkinId, occupancy) => {
    setBusy(`correct-${checkinId}`);
    setActionError(null);
    try {
      await api.patch(`/api/driver/checkins/${checkinId}`, { occupancy });
      await reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const undo = async (checkinId) => {
    setBusy(`undo-${checkinId}`);
    setActionError(null);
    try {
      await api.del(`/api/driver/checkins/${checkinId}`);
      await reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Loading label="Loading your trip" />;
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data?.trip) return <ErrorNote error={{ message: 'That trip could not be loaded.' }} />;

  const { trip, stops, checkins } = data;
  const active = trip.status === 'active';

  // Server truth plus what is still on the phone: each queued tap will claim the
  // next stop in sequence, so the driver is asked about the right one offline.
  const loggedSeq = checkins.reduce((max, row) => Math.max(max, row.seq), 0);
  const projectedSeq = loggedSeq + outbox.pending.length;
  const nextStop = stops.find((stop) => stop.seq === projectedSeq + 1) ?? null;
  const finished = stops.length > 0 && projectedSeq >= stops.length;

  return (
    <div className="space-y-5">
      <Crumb to="/driver">Your trips</Crumb>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-brand-700 px-2.5 py-1 text-base font-bold text-white">
            {trip.routeCode}
          </span>
          <h1 className="text-lg font-bold text-slate-900">{trip.routeName}</h1>
          {!active ? <span className="pill bg-mute-soft text-mute">{trip.status}</span> : null}
        </div>
        <p className="text-sm text-slate-500">
          Started {clockTime(trip.startedAt)} · {loggedSeq} of {stops.length} stops logged
          {outbox.pending.length ? ` · ${outbox.pending.length} waiting to send` : ''}
        </p>
      </header>

      <OfflineBanner
        online={outbox.online}
        syncing={outbox.syncing}
        pending={outbox.pending.length}
      />
      <ErrorNote error={actionError} />
      <ErrorNote error={outbox.syncError} />

      {active && !finished ? (
        <section className="card space-y-3 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Stop {nextStop?.seq} of {stops.length} — how full is the bus?
            </p>
            <h2 className="text-2xl font-bold text-slate-900">{nextStop?.name}</h2>
            <p className="text-sm text-slate-500">
              One tap logs the departure and the crowd level together.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {OCCUPANCY_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                className={`btn-tap ${TAP_TONE[level.tone]}`}
                onClick={() => tap(level.value)}
              >
                {level.label}
              </button>
            ))}
          </div>

          {trip.lastOccupancy ? (
            <p className="text-xs text-slate-500">
              Last reported: {occupancyLabel(trip.lastOccupancy)}
            </p>
          ) : null}
        </section>
      ) : null}

      {active && finished ? (
        <section className="card-pad space-y-2 border-good/30 bg-good-soft">
          <h2 className="font-bold text-good">Every stop on this route is logged</h2>
          <p className="text-sm text-slate-700">
            End the trip so the route stops showing this bus to commuters.
          </p>
        </section>
      ) : null}

      {outbox.rejected.length ? (
        <section className="card-pad space-y-2 border-red-200 bg-red-50">
          <h2 className="text-sm font-bold text-red-800">
            {plural(outbox.rejected.length, 'check-in')} the server would not accept
          </h2>
          <ul className="space-y-1 text-xs text-red-700">
            {outbox.rejected.map((entry) => (
              <li key={entry.clientUuid}>
                {clockTime(entry.recordedAt)} · {occupancyLabel(entry.occupancy)} — {entry.reason}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-ghost py-1.5 text-xs"
            onClick={() => discardRejected(tripId)}
          >
            Discard these
          </button>
        </section>
      ) : null}

      {active ? (
        <Section title="Phone GPS" subtitle="Optional — smooths the map between stops">
          <div className="card-pad flex flex-wrap items-center gap-3">
            <Toggle
              name="GPS sharing"
              value={gpsOn ? 'on' : 'off'}
              onChange={(value) => setGpsOn(value === 'on')}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'Share location' },
              ]}
            />
            <p className="min-w-0 flex-1 text-xs text-slate-500">
              {gps.error
                ? `Location unavailable: ${gps.error}`
                : gps.fix
                  ? `Last fix ±${gps.fix.accuracy} m at ${clockTime(gps.fix.at)}. Shared only while this trip is active.`
                  : 'Your location is sent only while this trip is active, and never stored against you afterwards.'}
            </p>
          </div>
        </Section>
      ) : null}

      <Section
        title="Logged so far"
        subtitle="Tap a crowd level to correct it, or undo a stop logged by mistake"
      >
        {checkins.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing logged yet on this trip.</p>
        ) : (
          <ol className="card divide-y divide-slate-100">
            {[...checkins].reverse().map((checkin) => {
              const stop = stops.find((entry) => entry.stopId === checkin.stopId);
              return (
                <li key={checkin.id} className="space-y-2 px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800">
                      {checkin.seq}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-800">
                        {stop?.name ?? `Stop ${checkin.seq}`}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {clockTime(checkin.recordedAt)} · {occupancyLabel(checkin.occupancy)}
                      </span>
                    </span>
                    {active ? (
                      <button
                        type="button"
                        className="btn-danger py-1 text-xs"
                        disabled={busy === `undo-${checkin.id}`}
                        onClick={() => undo(checkin.id)}
                      >
                        Undo
                      </button>
                    ) : null}
                  </div>
                  {active ? (
                    <div className="flex flex-wrap gap-1">
                      {OCCUPANCY_LEVELS.map((level) => (
                        <button
                          key={level.value}
                          type="button"
                          aria-pressed={checkin.occupancy === level.value}
                          disabled={busy === `correct-${checkin.id}`}
                          className={`pill ${
                            checkin.occupancy === level.value
                              ? 'bg-brand-700 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                          onClick={() => correct(checkin.id, level.value)}
                        >
                          {level.short}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {active ? (
        <Section title="Finish">
          {confirmClose ? (
            <div className="card-pad space-y-3">
              <p className="text-sm text-slate-700">
                {confirmClose === 'end'
                  ? 'End this trip? Commuters will stop seeing this bus on the route.'
                  : 'Cancel this trip? Its check-ins are kept but left out of the historical averages, so an abandoned run cannot skew future estimates.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={confirmClose === 'end' ? 'btn-primary' : 'btn-danger'}
                  disabled={busy !== null}
                  onClick={() => closeTrip(confirmClose)}
                >
                  {busy ? 'Working…' : confirmClose === 'end' ? 'Yes, end the trip' : 'Yes, cancel it'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy !== null}
                  onClick={() => setConfirmClose(null)}
                >
                  Keep driving
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => setConfirmClose('end')}>
                End trip
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => setConfirmClose('cancel')}
              >
                Cancel trip
              </button>
            </div>
          )}
          {outbox.pending.length ? (
            <p className="text-xs text-warn">
              {plural(outbox.pending.length, 'check-in')} still on this phone. Stay on this screen
              until they send, or they go with the trip's history when signal returns.
            </p>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

export default DriverTrip;

