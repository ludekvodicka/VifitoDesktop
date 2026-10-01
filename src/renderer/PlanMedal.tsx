import { distanceUnit, fmtDistance, fmtDuration } from './format'
import type { PlanRunState } from './plans/planRunner'

export function PlanMedal({ result, onClose }: {
  result: Extract<PlanRunState, { kind: 'finished' }>
  onClose: () => void
}) {
  return (
    <div className="medal" role="status">
      <svg className="medal-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 2h5l3 6-4 3zM15 2h5l-4 9-4-3z" fill="currentColor" />
        <circle cx="12" cy="15" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="m12 10 1.5 3 3.3.5-2.4 2.3.6 3.2-3-1.6L9 19l.6-3.2-2.4-2.3 3.3-.5z" fill="currentColor" />
      </svg>
      <b>Finished</b>
      <span>{fmtDuration(result.durationSec)}</span>
      {result.distanceM !== null && <span>{fmtDistance(result.distanceM)} {distanceUnit(result.distanceM)}</span>}
      <button aria-label="Close" onClick={onClose}>×</button>
    </div>
  )
}
