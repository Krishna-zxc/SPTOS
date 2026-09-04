/**
 * The crowding indicator (PRD FR-C4, FR-D3).
 *
 * Four buckets, colour-coded consistently: a commuter deciding whether to wait
 * for the next bus reads the colour before the word. The bucket list comes from
 * the server (`/api/meta`) because §15.2.2 leaves three-versus-four open.
 */
import { occupancyLevel } from '@sptos/shared';

const TONES = {
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
};

export function CrowdBadge({ occupancy, short = false, className = '' }) {
  const level = occupancyLevel(occupancy);

  if (!level) {
    return (
      <span className={`pill bg-mute-soft text-mute ${className}`} title="No crowding report yet">
        Crowding unknown
      </span>
    );
  }

  return (
    <span
      className={`pill ${TONES[level.tone]} ${className}`}
      title={`Driver reported: ${level.label}`}
    >
      <span aria-hidden="true" className="font-mono text-[0.65rem]">
        {'▮'.repeat(Math.round(level.loadFactor * 4)).padEnd(4, '▯')}
      </span>
      {short ? level.short : level.label}
    </span>
  );
}

/** A load factor averaged over many check-ins, snapped back to a bucket label. */
export function LoadFactorBadge({ loadFactor, className = '' }) {
  if (loadFactor === null || loadFactor === undefined) {
    return <span className={`text-slate-400 ${className}`}>—</span>;
  }
  const tone = loadFactor >= 0.85 ? 'bad' : loadFactor >= 0.6 ? 'warn' : 'good';
  return (
    <span className={`pill ${TONES[tone]} ${className}`}>{Math.round(loadFactor * 100)}% full</span>
  );
}

export default CrowdBadge;
