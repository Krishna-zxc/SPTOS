/**
 * Time bands (PRD FR-A2, FR-S1).
 *
 * ETA averaging and demand analytics both need to compare like with like: a
 * leg driven at 09:00 on a Tuesday is not comparable to the same leg at 14:00
 * on a Sunday. Two granularities are used:
 *
 *  - hour x day type  — fine grained, used for ETA averaging where accuracy
 *    matters and samples accumulate per leg.
 *  - named bands      — coarse, used on the admin dashboard where a planner
 *    wants "evening peak", not twenty-four bars.
 */
export const DAY_TYPES = ['weekday', 'weekend'];

export const TIME_BANDS = [
  { key: 'early', label: 'Early', range: '04:00–07:00', startHour: 4, endHour: 7 },
  { key: 'morning_peak', label: 'Morning peak', range: '07:00–11:00', startHour: 7, endHour: 11 },
  { key: 'midday', label: 'Midday', range: '11:00–16:00', startHour: 11, endHour: 16 },
  { key: 'evening_peak', label: 'Evening peak', range: '16:00–20:00', startHour: 16, endHour: 20 },
  { key: 'night', label: 'Night', range: '20:00–04:00', startHour: 20, endHour: 4 },
];

export function dayType(date = new Date()) {
  const day = date.getDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

/** The named band containing `hour` (0–23). The night band wraps midnight. */
export function bandForHour(hour) {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  for (const band of TIME_BANDS) {
    const wraps = band.endHour <= band.startHour;
    const inside = wraps
      ? h >= band.startHour || h < band.endHour
      : h >= band.startHour && h < band.endHour;
    if (inside) return band;
  }
  // Unreachable: the bands tile the full 24 hours.
  return TIME_BANDS.at(-1);
}

export function bandForDate(date = new Date()) {
  return bandForHour(date.getHours());
}

export function timeBandLabel(band, type) {
  const resolved = typeof band === 'string' ? TIME_BANDS.find((b) => b.key === band) : band;
  if (!resolved) return 'Unknown';
  const prefix = type ? `${type === 'weekend' ? 'Weekend' : 'Weekday'} · ` : '';
  return `${prefix}${resolved.label} (${resolved.range})`;
}
