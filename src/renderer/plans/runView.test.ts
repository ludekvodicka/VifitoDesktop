import { describe, expect, it } from 'vitest'
import type { Plan } from '../../shared/plans'
import type { ActiveRunState, PlanEndReason } from './planRunner'
import { describeEnd, describeRun } from './runView'

const plan: Plan = {
  id: 'walk', name: 'Walk', color: 'blue',
  phases: [
    { id: 'warmup', name: 'Warm up', speedKmh: 2, inclinePercent: 0, durationSec: 30 },
    { id: 'climb', name: '', speedKmh: 3, inclinePercent: 6, durationSec: 60 },
    { id: 'cooldown', name: 'Cool down', speedKmh: 2, inclinePercent: 0, durationSec: 20 },
  ],
}

describe('describeRun', () => {
  it('shows the active phase position, a ceiled countdown and only the later phases in the total', () => {
    expect(describeRun({ kind: 'running', plan, phaseId: 'climb', phaseEndsAt: 70_000 }, 40_001)).toEqual({
      phaseNumber: 2,
      phaseCount: 3,
      phaseLabel: 'Phase 2',
      phaseRemainingSec: 30,
      totalRemainingSec: 50,
      status: 'Running',
    })
  })

  it('uses a named phase and has no later time on the final phase', () => {
    expect(describeRun({ kind: 'running', plan, phaseId: 'cooldown', phaseEndsAt: 70_000 }, 60_000)).toEqual({
      phaseNumber: 3, phaseCount: 3, phaseLabel: 'Cool down', phaseRemainingSec: 10, totalRemainingSec: 10, status: 'Running',
    })
  })

  it.each([70_000, 80_000])('clamps an expired countdown to zero at %s', (now) => {
    const view = describeRun({ kind: 'running', plan, phaseId: 'climb', phaseEndsAt: 70_000 }, now)
    expect(view.phaseRemainingSec).toBe(0)
    expect(view.totalRemainingSec).toBe(20)
  })

  it('reports the entire first phase and plan while starting', () => {
    expect(describeRun({ kind: 'starting', plan }, 999_999)).toEqual({
      phaseNumber: 1,
      phaseCount: 3,
      phaseLabel: 'Warm up',
      phaseRemainingSec: 30,
      totalRemainingSec: 110,
      status: 'Starting the belt',
    })
  })

  it('allows the saved plan to become empty while starting', () => {
    expect(describeRun({ kind: 'starting', plan: { ...plan, phases: [] } }, 0)).toEqual({
      phaseNumber: 1, phaseCount: 0, phaseLabel: 'Phase 1', phaseRemainingSec: 0, totalRemainingSec: 0, status: 'Starting the belt',
    })
  })

  it.each([
    { kind: 'held', plan, phaseId: 'climb', remainingMs: 20_001 },
    { kind: 'failed', plan, phaseId: 'climb', remainingMs: 20_001, message: 'Set Target Speed: Operation Failed' },
  ] satisfies ActiveRunState[])('keeps the $kind remainder frozen as time passes', (state) => {
    const first = describeRun(state, 0)
    expect(describeRun(state, 600_000)).toEqual(first)
    expect(first.phaseRemainingSec).toBe(21)
    expect(first.totalRemainingSec).toBe(41)
    if (state.kind === 'held') expect(first.status).toBe('Paused by Slowdown')
    else if (state.kind === 'failed') expect(first.status).toBe(state.message)
    else throw new Error(`Unknown run state: ${JSON.stringify(state)}`)
  })

  it('clamps a held remainder shortened below zero by a save', () => {
    const view = describeRun({ kind: 'held', plan, phaseId: 'climb', remainingMs: -5000 }, 0)
    expect(view.phaseRemainingSec).toBe(0)
    expect(view.totalRemainingSec).toBe(20)
  })

  it('rejects an unknown state', () => {
    expect(() => describeRun({ kind: 'unknown' } as unknown as ActiveRunState, 0)).toThrow(/Unknown run state/)
  })
})

describe('describeEnd', () => {
  const messages: Record<PlanEndReason, string> = {
    endPlan: 'Plan ended. The belt keeps its speed and incline.',
    stop: 'STOP ended the plan.',
    disconnected: 'The connection dropped, so the plan ended. It does not resume after a reconnect.',
    beltStopped: 'The belt stopped on the console, so the plan ended.',
    startRefused: 'The console did not start the belt. Nothing else was sent.',
    phaseRemoved: 'The running phase was removed, so the plan ended. The belt keeps its speed and incline.',
  }

  it.each(Object.entries(messages))('explains %s', (reason, message) => {
    expect(describeEnd(reason as PlanEndReason)).toBe(message)
  })

  it('rejects an unknown reason', () => {
    expect(() => describeEnd('unknown' as PlanEndReason)).toThrow(/Unknown end reason/)
  })
})
