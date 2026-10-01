import { phaseLabel, type Plan } from '../../shared/plans'
import type { ActiveRunState, PlanEndReason } from './planRunner'

export type RunView = {
  phaseNumber: number
  phaseCount: number
  phaseLabel: string
  phaseRemainingSec: number
  totalRemainingSec: number
  status: string
}

export function describeRun(state: ActiveRunState, now: number): RunView {
  if (state.kind === 'starting') return view(state.plan, null, 0, 'Starting the belt')
  else if (state.kind === 'running') return view(state.plan, state.phaseId, state.phaseEndsAt - now, 'Running')
  else if (state.kind === 'held') return view(state.plan, state.phaseId, state.remainingMs, 'Paused by Slowdown')
  else if (state.kind === 'failed') return view(state.plan, state.phaseId, state.remainingMs, state.message)
  else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
}

function view(plan: Plan, phaseId: string | null, remainingMs: number, status: string): RunView {
  const index = phaseId === null ? 0 : plan.phases.findIndex((phase) => phase.id === phaseId)
  const phaseRemainingSec =
    phaseId === null ? (plan.phases[0]?.durationSec ?? 0) : Math.max(0, Math.ceil(remainingMs / 1000))
  const later = plan.phases.slice(index + 1).reduce((sum, phase) => sum + phase.durationSec, 0)
  return {
    phaseNumber: index + 1,
    phaseCount: plan.phases.length,
    phaseLabel: phaseLabel(plan.phases[index]?.name ?? '', index),
    phaseRemainingSec,
    totalRemainingSec: phaseRemainingSec + later,
    status,
  }
}

export function describeEnd(reason: PlanEndReason): string {
  if (reason === 'endPlan') return 'Plan ended. The belt keeps its speed and incline.'
  else if (reason === 'stop') return 'STOP ended the plan.'
  else if (reason === 'disconnected') return 'The connection dropped, so the plan ended. It does not resume after a reconnect.'
  else if (reason === 'beltStopped') return 'The belt stopped on the console, so the plan ended.'
  else if (reason === 'startRefused') return 'The console did not start the belt. Nothing else was sent.'
  else if (reason === 'phaseRemoved') return 'The running phase was removed, so the plan ended. The belt keeps its speed and incline.'
  else throw new Error(`Unknown end reason: ${reason}`)
}
