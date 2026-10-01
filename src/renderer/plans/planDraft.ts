import { PLAN_LIMITS, phaseLabel, type Plan, type PlanColor, type PlanPhase } from '../../shared/plans'
import { toNumber } from '../../shared/presets'
import type { PhaseTargets } from './planRunner'

export type PhaseDraft = {
  id: string
  name: string
  speedKmh: string
  inclinePercent: string
  minutes: string
  seconds: string
}
export type PlanDraft = { name: string; color: PlanColor; phases: PhaseDraft[] }
export type DraftProblem = { phaseId: string | null; message: string }
export type DraftResult = { ok: true; plan: Plan } | { ok: false; problems: DraftProblem[] }

export function toDraft(plan: Plan): PlanDraft {
  return {
    name: plan.name,
    color: plan.color,
    phases: plan.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      speedKmh: String(phase.speedKmh),
      inclinePercent: String(phase.inclinePercent),
      minutes: String(Math.floor(phase.durationSec / 60)),
      seconds: String(phase.durationSec % 60),
    })),
  }
}

export function isDirty(draft: PlanDraft, plan: Plan): boolean {
  const saved = toDraft(plan)
  return draft.name !== saved.name || draft.color !== saved.color || draft.phases.length !== saved.phases.length ||
    draft.phases.some((phase, index) => {
      const previous = saved.phases[index]
      return phase.id !== previous.id || phase.name !== previous.name || phase.speedKmh !== previous.speedKmh ||
        phase.inclinePercent !== previous.inclinePercent || phase.minutes !== previous.minutes || phase.seconds !== previous.seconds
    })
}

export function newPhase(last: PhaseDraft | undefined): PhaseDraft {
  return {
    id: crypto.randomUUID(),
    name: '',
    speedKmh: last?.speedKmh ?? '2',
    inclinePercent: last?.inclinePercent ?? '0',
    minutes: '1',
    seconds: '0',
  }
}

export function readDraft(draft: PlanDraft, id: string): DraftResult {
  const problems: DraftProblem[] = []
  const name = draft.name.trim()
  if (name === '') problems.push({ phaseId: null, message: 'The plan needs a name.' })
  if (name.length > PLAN_LIMITS.nameLength)
    problems.push({ phaseId: null, message: `Plan names can have up to ${PLAN_LIMITS.nameLength} characters.` })
  const phases: PlanPhase[] = []
  draft.phases.forEach((phase, index) => {
    const label = phaseLabel(phase.name.trim(), index)
    const problem = (message: string) => problems.push({ phaseId: phase.id, message: `${label}: ${message}` })
    const speedKmh = toNumber(phase.speedKmh)
    const inclinePercent = toNumber(phase.inclinePercent)
    const minutes = phase.minutes.trim() === '' ? 0 : toNumber(phase.minutes)
    const seconds = phase.seconds.trim() === '' ? 0 : toNumber(phase.seconds)
    if (phase.name.trim().length > PLAN_LIMITS.phaseNameLength)
      problem(`names can have up to ${PLAN_LIMITS.phaseNameLength} characters.`)
    if (speedKmh === null || speedKmh < PLAN_LIMITS.speedKmh.min || speedKmh > PLAN_LIMITS.speedKmh.max)
      problem('speed 0.1 to 30 km/h.')
    if (inclinePercent === null || inclinePercent < PLAN_LIMITS.inclinePercent.min || inclinePercent > PLAN_LIMITS.inclinePercent.max)
      problem('incline 0 to 30 %.')
    if (minutes === null || !Number.isInteger(minutes) || minutes < 0 || minutes > 99)
      problem('minutes must be a whole number from 0 to 99.')
    if (seconds === null || !Number.isInteger(seconds) || seconds < 0 || seconds > 59)
      problem('seconds must be a whole number from 0 to 59.')
    if (minutes !== null && seconds !== null && minutes * 60 + seconds < PLAN_LIMITS.durationSec.min)
      problem('duration must be at least 5 seconds.')
    if (speedKmh !== null && inclinePercent !== null && minutes !== null && seconds !== null)
      phases.push({ id: phase.id, name: phase.name.trim(), speedKmh, inclinePercent, durationSec: minutes * 60 + seconds })
  })
  return problems.length > 0 ? { ok: false, problems } : { ok: true, plan: { id, name, color: draft.color, phases } }
}

export function phaseWarnings(
  phase: PhaseDraft,
  targetsFor: ((phase: PlanPhase) => PhaseTargets) | null,
  maxInclinePercent: number | null,
): string[] {
  const speedKmh = toNumber(phase.speedKmh)
  const inclinePercent = toNumber(phase.inclinePercent)
  if (speedKmh === null || inclinePercent === null) return []
  const warnings: string[] = []
  const targets = targetsFor?.({ id: phase.id, name: phase.name, speedKmh, inclinePercent, durationSec: 0 })
  if (targets?.inclinePercent === null)
    warnings.push('Incline will not be set because the console minimum is above the maximum from Settings.')
  else if (maxInclinePercent !== null && inclinePercent > maxInclinePercent)
    warnings.push(`Above your maximum incline, runs at ${(targets?.inclinePercent ?? maxInclinePercent).toFixed(1)} %.`)
  else if (targets && targets.inclinePercent !== inclinePercent)
    warnings.push(`This console runs it at ${targets.inclinePercent.toFixed(1)} %.`)
  if (targets && targets.speedKmh !== speedKmh)
    warnings.push(`This console runs it at ${targets.speedKmh.toFixed(1)} km/h.`)
  return warnings
}
