/**
 * Presentation helpers, and the one piece of domain logic that has to live on
 * the client: re-ageing freshness locally.
 *
 * The server stamps every payload with how old the underlying check-in was *at
 * the moment it answered*. If the tab then sits for ten minutes — a sleeping
 * phone, a dropped socket — that stamp is a lie by omission. So the age is
 * recomputed from the original timestamp against the local clock on every tick,
 * and the ETA is suppressed the moment it goes stale (NFR: transparency).
 */
import { useEffect, useState } from 'react';
import { freshness } from '@sptos/shared';

/** A clock that ticks, so ages and countdowns re-render without a refetch. */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Freshness as of `now`, from the timestamp the server reported.
 * `state` is any object carrying a `freshness` block.
 */
export function ageState(state, staleAfterSeconds, now) {
  const at = state?.freshness?.updatedAt ?? state?.lastCheckin?.recordedAt ?? null;
  return freshness(at, { now, staleAfterSeconds });
}

/**
 * Whether an ETA may be shown, judged against the local clock rather than the
 * server's answer, plus why not when it may not be.
 */
export function etaGate(trip, staleAfterSeconds, now) {
  const fresh = ageState(trip, staleAfterSeconds, now);
  if (!trip?.etaAvailable) {
    return { fresh, show: false, reason: trip?.etaUnavailableReason ?? 'awaiting_checkins' };
  }
  if (fresh.isStale) return { fresh, show: false, reason: 'stale_data' };
  return { fresh, show: true, reason: null };
}

export const ETA_UNAVAILABLE_TEXT = {
  awaiting_checkins: 'Waiting for the driver’s first check-in on this trip.',
  stale_data: 'No recent check-in, so any estimate would be guesswork.',
};

/** Minutes as a commuter would say them. */
export function etaText(eta) {
  if (!eta) return '—';
  if (eta.overdueSeconds > 0) {
    const minutes = Math.round(eta.overdueSeconds / 60);
    return minutes < 1 ? 'Due now' : `Overdue by ${minutes} min`;
  }
  if (eta.etaMinutes <= 0) return 'Due now';
  return `${eta.etaMinutes} min`;
}

/** The range that makes an estimate honest (PRD §12 mitigation). */
export function rangeText(eta) {
  if (!eta) return '';
  const { rangeLowMinutes: low, rangeHighMinutes: high } = eta;
  if (low === high) return `about ${low} min`;
  return `${low}–${high} min`;
}

export const CONFIDENCE_TEXT = {
  high: 'Based on this route’s measured history for this hour',
  medium: 'Partly based on measured history',
  low: 'Timetable only — no measured history for this leg yet',
};

export function clockTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function percent(share, digits = 0) {
  if (share === null || share === undefined || Number.isNaN(share)) return '—';
  return `${(share * 100).toFixed(digits)}%`;
}

/** Signed delay, phrased the way a planner reads it. */
export function delayText(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const magnitude = Math.abs(Math.round(seconds));
  if (magnitude < 60) return seconds >= 0 ? `${magnitude}s late` : `${magnitude}s early`;
  const minutes = Math.floor(magnitude / 60);
  const rest = magnitude % 60;
  const body = rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  return seconds >= 0 ? `${body} late` : `${body} early`;
}

export function durationText(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
