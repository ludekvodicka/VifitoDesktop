import { PLAN_COLORS } from '../shared/plans'
import { fmtDuration } from './format'
import { PlanMedal } from './PlanMedal'
import { isRunActive, type PlanRunState } from './plans/planRunner'
import { describeRun } from './plans/runView'
import { useNow } from './plans/useNow'

type Props = {
  run: PlanRunState
  onEndPlan: () => void
  onStop: () => void
  onRetry: () => void
  onClose: () => void
}

export function RunStrip({ run, onEndPlan, onStop, onRetry, onClose }: Props) {
  const now = useNow(run.kind === 'running')
  if (run.kind === 'finished')
    return (
      <div className="run-strip">
        <span className="plan-name" style={{ color: PLAN_COLORS[run.plan.color] }}>{run.plan.name}</span>
        <PlanMedal result={run} onClose={onClose} />
      </div>
    )
  if (!isRunActive(run)) return null
  const view = describeRun(run, now)
  return (
    <div className="run-strip">
      <span className="plan-name" style={{ color: PLAN_COLORS[run.plan.color] }}>{run.plan.name}</span>
      <span>{view.phaseNumber}/{view.phaseCount} {view.phaseLabel} <span className="countdown">{fmtDuration(view.phaseRemainingSec)}</span></span>
      <span className="control-note">{fmtDuration(view.totalRemainingSec)} left, {view.status}</span>
      <div className="run-actions">
        {run.kind === 'failed' && <button onClick={onRetry}>Retry</button>}
        <button disabled={run.kind === 'starting'} onClick={onEndPlan}>End plan</button>
        <button className="stop" onClick={onStop}>STOP</button>
      </div>
    </div>
  )
}
