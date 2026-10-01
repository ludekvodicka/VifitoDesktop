import { accumulate, seed, type Counter } from '../../shared/counters'
import { planDurationSec, type Plan, type PlanPhase } from '../../shared/plans'
import type { ControlChannel } from '../ble/connection'
import { encodeSetIncline, encodeSetSpeed } from '../ble/controlPoint'

export type PhaseTargets = { speedKmh: number; inclinePercent: number | null }

export type PlanEndReason = 'endPlan' | 'stop' | 'disconnected' | 'beltStopped' | 'startRefused' | 'phaseRemoved'

export type PlanRunState =
  | { kind: 'idle' }
  | { kind: 'starting'; plan: Plan }
  | { kind: 'running'; plan: Plan; phaseId: string; phaseEndsAt: number }
  | { kind: 'held'; plan: Plan; phaseId: string; remainingMs: number }
  | { kind: 'failed'; plan: Plan; phaseId: string; remainingMs: number; message: string }
  | { kind: 'finished'; plan: Plan; durationSec: number; distanceM: number | null }
  | { kind: 'ended'; plan: Plan; reason: PlanEndReason }

export type ActiveRunState = Extract<PlanRunState, { kind: 'starting' | 'running' | 'held' | 'failed' }>

export type PlanRunnerDeps = {
  /** App passes runCommand, which resolves to null for both dropped commands and communication failures. */
  send: ControlChannel['send']
  /** Uses App's lowest-speed-first start path and reports whether the belt started. */
  startBelt: () => Promise<boolean>
  stopBelt: () => Promise<void>
  /** App supplies targets already quantized to the console grid and capped at the configured incline. */
  targetsFor: (phase: PlanPhase) => PhaseTargets
  showTargets: (targets: PhaseTargets) => void
  clearPendingCommands: () => void
  onChange: (state: PlanRunState) => void
}

export type PlanRunner = {
  play: (plan: Plan, beltRunning: boolean) => Promise<void>
  /** Invalidates the run synchronously, before the caller queues STOP or disconnects. */
  end: (reason: PlanEndReason) => void
  hold: () => void
  resume: () => void
  retry: () => void
  planSaved: (plan: Plan) => void
  recordDistance: (meters: number | undefined) => void
  dismiss: () => void
}

export function isRunActive(state: PlanRunState): state is ActiveRunState {
  if (state.kind === 'starting' || state.kind === 'running' || state.kind === 'held' || state.kind === 'failed') return true
  else if (state.kind === 'idle' || state.kind === 'finished' || state.kind === 'ended') return false
  else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
}

export function createPlanRunner(deps: PlanRunnerDeps): PlanRunner {
  let state: PlanRunState = { kind: 'idle' }
  let batch: symbol | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let distance: Counter = { total: 0 }

  const set = (next: PlanRunState) => {
    state = next
    deps.onChange(next)
  }
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const latestPlan = (fallback: Plan): Plan => (isRunActive(state) ? state.plan : fallback)

  const runPhase = (plan: Plan, phase: PlanPhase, durationMs: number) => {
    const mine = Symbol()
    batch = mine
    // A debounced stepper click must not land after the phase targets and undo them.
    deps.clearPendingCommands()
    const targets = deps.targetsFor(phase)
    deps.showTargets(targets)
    set({ kind: 'running', plan, phaseId: phase.id, phaseEndsAt: performance.now() + durationMs })
    clearTimer()
    timer = setTimeout(advance, durationMs)
    void sendTargets(mine, targets)
  }

  const sendTargets = async (mine: symbol, targets: PhaseTargets) => {
    const commands = [encodeSetSpeed(targets.speedKmh)]
    if (targets.inclinePercent !== null) commands.push(encodeSetIncline(targets.inclinePercent))
    for (const command of commands) {
      const response = await deps.send(command)
      // An end or a newer phase invalidates even a refusal from an older batch.
      if (batch !== mine) return
      if (!response?.ok) return fail(response?.message ?? 'The console did not answer.')
    }
  }

  const continueFor = (plan: Plan, phaseId: string, remainingMs: number) => {
    set({ kind: 'running', plan, phaseId, phaseEndsAt: performance.now() + remainingMs })
    clearTimer()
    if (remainingMs <= 0) advance()
    else timer = setTimeout(advance, remainingMs)
  }

  const advance = () => {
    timer = null
    if (state.kind === 'running') {
      const { plan, phaseId } = state
      const next = plan.phases[plan.phases.findIndex((phase) => phase.id === phaseId) + 1]
      if (next) runPhase(plan, next, next.durationSec * 1000)
      else finish(plan)
    } else if (state.kind === 'idle' || state.kind === 'starting' || state.kind === 'held' || state.kind === 'failed' || state.kind === 'finished' || state.kind === 'ended') return
    else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
  }

  const finish = (plan: Plan) => {
    batch = null
    clearTimer()
    const distanceM = distance.last === undefined ? null : distance.total
    set({ kind: 'finished', plan, durationSec: planDurationSec(plan), distanceM })
    // App's stopBelt calls end('stop'), which must already see the finished medal.
    void deps.stopBelt()
  }

  const fail = (message: string) => {
    if (state.kind === 'running') {
      clearTimer()
      set({ kind: 'failed', plan: state.plan, phaseId: state.phaseId, remainingMs: state.phaseEndsAt - performance.now(), message })
    } else if (state.kind === 'held') {
      clearTimer()
      set({ ...state, kind: 'failed', message })
    } else if (state.kind === 'idle' || state.kind === 'starting' || state.kind === 'failed' || state.kind === 'finished' || state.kind === 'ended') return
    else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
  }

  const end = (reason: PlanEndReason) => {
    if (!isRunActive(state)) return
    batch = null
    clearTimer()
    set({ kind: 'ended', plan: state.plan, reason })
  }

  return {
    play: async (plan, beltRunning) => {
      if (isRunActive(state) || plan.phases.length === 0) return
      const mine = Symbol()
      batch = mine
      distance = { total: 0 }
      if (!beltRunning) {
        set({ kind: 'starting', plan })
        const started = await deps.startBelt()
        if (batch !== mine) return
        if (!started) return end('startRefused')
      }
      const current = latestPlan(plan)
      const first = current.phases[0]
      if (!first) return end('phaseRemoved')
      runPhase(current, first, first.durationSec * 1000)
    },
    end,
    hold: () => {
      if (state.kind === 'running') {
        clearTimer()
        set({ kind: 'held', plan: state.plan, phaseId: state.phaseId, remainingMs: state.phaseEndsAt - performance.now() })
      } else if (state.kind === 'idle' || state.kind === 'starting' || state.kind === 'held' || state.kind === 'failed' || state.kind === 'finished' || state.kind === 'ended') return
      else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
    },
    resume: () => {
      if (state.kind === 'held') continueFor(state.plan, state.phaseId, state.remainingMs)
      else if (state.kind === 'idle' || state.kind === 'starting' || state.kind === 'running' || state.kind === 'failed' || state.kind === 'finished' || state.kind === 'ended') return
      else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
    },
    retry: () => {
      if (state.kind === 'failed') {
        if (state.remainingMs <= 0) continueFor(state.plan, state.phaseId, 0)
        else runPhase(state.plan, phaseOf(state.plan, state.phaseId), state.remainingMs)
      } else if (state.kind === 'idle' || state.kind === 'starting' || state.kind === 'running' || state.kind === 'held' || state.kind === 'finished' || state.kind === 'ended') return
      else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
    },
    planSaved: (plan) => {
      if (!isRunActive(state) || plan.id !== state.plan.id) return
      if (state.kind === 'starting') set({ ...state, plan })
      else if (state.kind === 'running' || state.kind === 'held' || state.kind === 'failed') {
        const phaseId = state.phaseId
        const after = plan.phases.find((phase) => phase.id === phaseId)
        if (!after) return end('phaseRemoved')
        const before = phaseOf(state.plan, phaseId)
        // Time already walked stays counted when a saved duration changes.
        const shiftMs = (after.durationSec - before.durationSec) * 1000
        if (state.kind === 'held' || state.kind === 'failed') set({ ...state, plan, remainingMs: state.remainingMs + shiftMs })
        else if (state.kind === 'running') {
          const remainingMs = state.phaseEndsAt - performance.now() + shiftMs
          const changed = after.speedKmh !== before.speedKmh || after.inclinePercent !== before.inclinePercent
          if (changed && remainingMs > 0) runPhase(plan, after, remainingMs)
          else continueFor(plan, phaseId, remainingMs)
        } else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
      } else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
    },
    recordDistance: (meters) => {
      if (!isRunActive(state)) return
      // The console's first value can include walking done before this run.
      if (distance.last === undefined) seed(distance, meters)
      else accumulate(distance, meters)
    },
    dismiss: () => {
      if (state.kind === 'finished' || state.kind === 'ended') set({ kind: 'idle' })
      else if (state.kind === 'idle' || state.kind === 'starting' || state.kind === 'running' || state.kind === 'held' || state.kind === 'failed') return
      else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
    },
  }
}

function phaseOf(plan: Plan, phaseId: string): PlanPhase {
  const phase = plan.phases.find((candidate) => candidate.id === phaseId)
  if (!phase) throw new Error(`Phase ${phaseId} is not in plan ${plan.id}`)
  return phase
}
