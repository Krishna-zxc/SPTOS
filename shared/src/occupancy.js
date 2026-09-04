/**
 * Occupancy buckets (PRD FR-D3, glossary 15.1).
 *
 * Four discrete buckets, deliberately coarse: a conductor picking one of four
 * labelled choices in a moving bus is faster and less ambiguous than judging a
 * percentage. `loadFactor` is the approximate share of capacity each bucket
 * represents and is what the demand analytics aggregate on (FR-A2).
 */
export const OCCUPANCY_LEVELS = [
  { value: 'empty', label: 'Empty', short: 'Empty', loadFactor: 0.1, tone: 'good' },
  { value: 'seats_free', label: 'Seats free', short: 'Seats', loadFactor: 0.4, tone: 'good' },
  { value: 'standing_only', label: 'Standing only', short: 'Standing', loadFactor: 0.75, tone: 'warn' },
  { value: 'full', label: 'Full', short: 'Full', loadFactor: 1.0, tone: 'bad' },
];

export const OCCUPANCY_VALUES = OCCUPANCY_LEVELS.map((level) => level.value);

const BY_VALUE = new Map(OCCUPANCY_LEVELS.map((level) => [level.value, level]));

export function occupancyLevel(value) {
  return BY_VALUE.get(value) ?? null;
}

export function occupancyLabel(value) {
  return BY_VALUE.get(value)?.label ?? 'Unknown';
}

export function occupancyLoadFactor(value) {
  return BY_VALUE.get(value)?.loadFactor ?? null;
}

/** Turns an averaged load factor back into the nearest bucket, for summaries. */
export function bucketForLoadFactor(loadFactor) {
  if (loadFactor === null || loadFactor === undefined || Number.isNaN(loadFactor)) return null;
  let best = OCCUPANCY_LEVELS[0];
  for (const level of OCCUPANCY_LEVELS) {
    if (Math.abs(level.loadFactor - loadFactor) < Math.abs(best.loadFactor - loadFactor)) {
      best = level;
    }
  }
  return best;
}
