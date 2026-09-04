import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateArrivals, makeSegmentResolver } from '../src/services/eta.service.js';
import { toCsv } from '../src/services/analytics.service.js';

const profile = ({ hourly = [], daily = [], offsets = [] } = {}) => ({
  hourly: new Map(hourly),
  daily: new Map(daily),
  scheduledOffsets: new Map(offsets),
});

const STOPS = [
  { seq: 1, stopId: 11, name: 'A' },
  { seq: 2, stopId: 12, name: 'B' },
  { seq: 3, stopId: 13, name: 'C' },
];

test('a leg with enough same-hour history uses the measured average', () => {
  const resolve = makeSegmentResolver(
    profile({ hourly: [['1|weekday|9', { samples: 5, avgSeconds: 400, stddevSeconds: 30 }]] }),
    { minSamples: 3, fallbackSeconds: 180 },
  );

  const leg = resolve(1, 'weekday', 9);
  assert.equal(leg.source, 'measured');
  assert.equal(leg.seconds, 400);
  assert.equal(leg.samples, 5);
});

test('too few same-hour samples relax to the day-type average, not the schedule', () => {
  const resolve = makeSegmentResolver(
    profile({
      hourly: [['1|weekday|9', { samples: 2, avgSeconds: 400, stddevSeconds: 30 }]],
      daily: [['1|weekday', { samples: 40, avgSeconds: 500, stddevSeconds: 90 }]],
      offsets: [
        [1, 0],
        [2, 600],
      ],
    }),
    { minSamples: 3 },
  );

  const leg = resolve(1, 'weekday', 9);
  assert.equal(leg.source, 'measured_daytype');
  assert.equal(leg.seconds, 500);
});

test('with no history at all the timetable is used before the flat guess', () => {
  const resolve = makeSegmentResolver(
    profile({
      offsets: [
        [1, 0],
        [2, 660],
      ],
    }),
    { minSamples: 3, fallbackSeconds: 180 },
  );

  const scheduled = resolve(1, 'weekday', 9);
  assert.equal(scheduled.source, 'scheduled');
  assert.equal(scheduled.seconds, 660);

  // Leg 2 has no offset for seq 3, so there is nothing left but the flat value.
  const guessed = resolve(2, 'weekday', 9);
  assert.equal(guessed.source, 'fallback');
  assert.equal(guessed.seconds, 180);
});

test('arrivals accumulate down the route and only cover stops still ahead', () => {
  const resolve = makeSegmentResolver(
    profile({
      hourly: [
        ['1|weekday|9', { samples: 9, avgSeconds: 300, stddevSeconds: 0 }],
        ['2|weekday|9', { samples: 9, avgSeconds: 600, stddevSeconds: 0 }],
      ],
    }),
    { minSamples: 3 },
  );

  const departedAt = new Date('2026-09-03T09:00:00');
  const etas = estimateArrivals({
    resolveSegment: resolve,
    fromSeq: 1,
    departedAt,
    stops: STOPS,
    now: departedAt.getTime(),
  });

  assert.deepEqual(
    etas.map((eta) => eta.seq),
    [2, 3],
    'the stop the bus just left is not an arrival',
  );
  assert.equal(etas[0].etaMinutes, 5);
  assert.equal(etas[1].etaMinutes, 15, 'leg times sum along the route');
});

test('every estimate is labelled an estimate and carries a range', () => {
  const resolve = makeSegmentResolver(
    profile({ hourly: [['1|weekday|9', { samples: 9, avgSeconds: 600, stddevSeconds: 120 }]] }),
    { minSamples: 3 },
  );

  const departedAt = new Date('2026-09-03T09:00:00');
  const [eta] = estimateArrivals({
    resolveSegment: resolve,
    fromSeq: 1,
    departedAt,
    stops: STOPS,
    now: departedAt.getTime(),
  });

  // PRD §12 mitigation: an early ETA is only defensible if it is presented as a
  // labelled estimate with a range.
  assert.equal(eta.isEstimate, true);
  assert.equal(eta.confidence, 'high');
  assert.ok(eta.rangeLowMinutes < eta.etaMinutes);
  assert.ok(eta.rangeHighMinutes > eta.etaMinutes);
});

test('confidence degrades as soon as one leg on the way is guessed', () => {
  const resolve = makeSegmentResolver(
    profile({ hourly: [['1|weekday|9', { samples: 9, avgSeconds: 300, stddevSeconds: 10 }]] }),
    { minSamples: 3, fallbackSeconds: 180 },
  );

  const departedAt = new Date('2026-09-03T09:00:00');
  const etas = estimateArrivals({
    resolveSegment: resolve,
    fromSeq: 1,
    departedAt,
    stops: STOPS,
    now: departedAt.getTime(),
  });

  assert.equal(etas[0].confidence, 'high');
  assert.equal(etas[1].confidence, 'medium', 'a measured leg plus a guessed leg is not high');
});

test('a bus past its estimate reports as overdue rather than negative', () => {
  const resolve = makeSegmentResolver(
    profile({ hourly: [['1|weekday|9', { samples: 9, avgSeconds: 300, stddevSeconds: 0 }]] }),
    { minSamples: 3 },
  );

  const departedAt = new Date('2026-09-03T09:00:00');
  const [eta] = estimateArrivals({
    resolveSegment: resolve,
    fromSeq: 1,
    departedAt,
    stops: STOPS,
    now: departedAt.getTime() + 8 * 60_000,
  });

  assert.equal(eta.etaMinutes, 0);
  assert.equal(eta.overdueSeconds, 180);
});

test('CSV export neutralises spreadsheet formula injection', () => {
  const csv = toCsv(
    [
      { key: 'stopName', label: 'Stop' },
      { key: 'checkins', label: 'Check-ins' },
    ],
    [
      { stopName: '=HYPERLINK("http://evil","click")', checkins: 4 },
      { stopName: 'Baner, Phata', checkins: 7 },
      { stopName: 'He said "go"', checkins: 1 },
    ],
  );

  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Stop,Check-ins');
  assert.ok(lines[1].startsWith('"\'=HYPERLINK'), 'a leading = is escaped and quoted');
  assert.equal(lines[2], '"Baner, Phata",7');
  assert.equal(lines[3], '"He said ""go""",1');
});
