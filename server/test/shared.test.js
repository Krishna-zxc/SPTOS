import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STALE_AFTER_SECONDS,
  NO_DATA_LABEL,
  bandForHour,
  bucketForLoadFactor,
  dayType,
  freshness,
  occupancyLoadFactor,
} from '@sptos/shared';

/**
 * The transparency NFR is the one requirement a UI cannot compensate for later,
 * so freshness gets tested at its edges rather than in the middle.
 */
test('freshness reports no data rather than inventing a position', () => {
  const state = freshness(null);
  assert.equal(state.hasData, false);
  assert.equal(state.isStale, true);
  assert.equal(state.label, NO_DATA_LABEL);
});

test('freshness flips to stale exactly at the configured cutoff', () => {
  const now = Date.parse('2026-09-03T10:00:00.000Z');
  const cutoff = DEFAULT_STALE_AFTER_SECONDS;

  const fresh = freshness(new Date(now - (cutoff - 1) * 1000), { now });
  const stale = freshness(new Date(now - (cutoff + 1) * 1000), { now });

  assert.equal(fresh.isStale, false);
  assert.equal(stale.isStale, true);

  // A stale reading must lead with "no recent data" rather than a bare age, so
  // it can never be mistaken for a live position, but it still says how old the
  // last sighting was.
  assert.ok(stale.label.startsWith(NO_DATA_LABEL));
  assert.match(stale.label, /last seen/);
});

test('freshness honours a route-specific cutoff', () => {
  const now = Date.now();
  const state = freshness(new Date(now - 120_000), { now, staleAfterSeconds: 60 });
  assert.equal(state.isStale, true);
  assert.equal(state.ageSeconds, 120);
});

test('the night band wraps past midnight', () => {
  assert.equal(bandForHour(23).key, 'night');
  assert.equal(bandForHour(2).key, 'night');
  assert.equal(bandForHour(8).key, 'morning_peak');
  assert.equal(bandForHour(18).key, 'evening_peak');
});

test('day type splits weekends out of the averages', () => {
  assert.equal(dayType(new Date('2026-09-03T09:00:00')), 'weekday'); // Thursday
  assert.equal(dayType(new Date('2026-09-05T09:00:00')), 'weekend'); // Saturday
});

test('occupancy load factors rise with crowding and round-trip through buckets', () => {
  const ordered = ['empty', 'seats_free', 'standing_only', 'full'].map(occupancyLoadFactor);
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b));
  assert.equal(bucketForLoadFactor(occupancyLoadFactor('full')).value, 'full');
  assert.equal(bucketForLoadFactor(occupancyLoadFactor('empty')).value, 'empty');

  // An averaged load factor between buckets snaps to the nearest one.
  assert.equal(bucketForLoadFactor(0.72).value, 'standing_only');
  assert.equal(bucketForLoadFactor(null), null);
});
