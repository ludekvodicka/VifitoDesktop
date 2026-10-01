import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plan, PlanPhase } from '../../shared/plans'
import { ControlOp, encodeSetIncline, encodeSetSpeed, type ControlResponse } from '../ble/controlPoint'
import { createPlanRunner, isRunActive, type PlanEndReason, type PlanRunnerDeps, type PlanRunState } from './planRunner'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const plan: Plan = {
  id: 'walk', name: 'Walk', color: 'blue',
  phases: [
    { id: 'warmup', name: 'Warm up', speedKmh: 2, inclinePercent: 14, durationSec: 30 },
    { id: 'climb', name: '', speedKmh: 3, inclinePercent: 6, durationSec: 60 },
  ],
}
const otherPlan: Plan = { ...plan, id: 'other', name: 'Other walk' }
const singlePhase: Plan = { ...plan, phases: [plan.phases[0]!] }

function changedPhase(index: number, changes: Partial<PlanPhase>): Plan {
  return { ...plan, phases: plan.phases.map((phase, position) => position === index ? { ...phase, ...changes } : phase) }
}

function ok(op: number): ControlResponse {
  return { requestOp: op, requestName: '', result: 1, ok: true, notPermitted: false, message: 'ok' }
}

function refused(op: number): ControlResponse {
  return { requestOp: op, requestName: '', result: 4, ok: false, notPermitted: false, message: 'Operation Failed' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup() {
  const sent: number[][] = []
  const answers: Array<(response: ControlResponse | null) => void> = []
  const states: PlanRunState[] = [{ kind: 'idle' }]
  const events: string[] = []
  const deps = {
    send: vi.fn<PlanRunnerDeps['send']>((command) => {
      events.push(`send:${command[0]}`)
      sent.push([...command])
      return new Promise((resolve) => answers.push(resolve))
    }),
    startBelt: vi.fn(async () => true),
    stopBelt: vi.fn(async () => { runner.end('stop') }),
    targetsFor: vi.fn<PlanRunnerDeps['targetsFor']>((phase) => ({ speedKmh: phase.speedKmh, inclinePercent: Math.min(phase.inclinePercent, 12) })),
    showTargets: vi.fn(() => { events.push('show') }),
    clearPendingCommands: vi.fn(() => { events.push('clear') }),
    onChange: vi.fn((state: PlanRunState) => {
      events.push(state.kind)
      states.push(state)
    }),
  } satisfies PlanRunnerDeps
  const runner = createPlanRunner(deps)
  const answer = async (index: number, response = ok(sent[index]![0]!)): Promise<void> => {
    answers[index]!(response)
    await vi.advanceTimersByTimeAsync(0)
  }
  const acceptPhase = async (index = sent.length - 1) => {
    await answer(index)
    await answer(index + 1)
  }
  return { runner, deps, sent, answers, states, events, answer, acceptPhase, state: () => states.at(-1)! }
}

describe('plan runner phases', () => {
  it('sends only speed for null incline targets and advances through completion', async () => {
    const { runner, deps, sent, state, answer } = setup()
    deps.targetsFor.mockImplementation((phase) => ({ speedKmh: phase.speedKmh, inclinePercent: null }))
    await runner.play(plan, true)
    await answer(0)
    expect(sent).toEqual([[...encodeSetSpeed(2)]])
    expect(deps.showTargets).toHaveBeenLastCalledWith({ speedKmh: 2, inclinePercent: null })
    expect(state()).toMatchObject({ kind: 'running', phaseId: 'warmup' })
    await vi.advanceTimersByTimeAsync(30_000)
    await answer(1)
    expect(sent).toEqual([[...encodeSetSpeed(2)], [...encodeSetSpeed(3)]])
    expect(state()).toMatchObject({ kind: 'running', phaseId: 'climb' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(state()).toEqual({ kind: 'finished', plan, durationSec: 90, distanceM: null })
    expect(deps.stopBelt).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(2)
  })

  it('clears pending manual commands and shows capped targets before sending speed then incline', async () => {
    const { runner, deps, sent, events, state, acceptPhase } = setup()
    await runner.play(plan, true)
    expect(events).toEqual(['clear', 'show', 'running', `send:${ControlOp.setTargetSpeed}`])
    expect(deps.targetsFor).toHaveBeenCalledWith(plan.phases[0])
    expect(deps.showTargets).toHaveBeenCalledWith({ speedKmh: 2, inclinePercent: 12 })
    expect(deps.startBelt).not.toHaveBeenCalled()
    expect(state()).toEqual({ kind: 'running', plan, phaseId: 'warmup', phaseEndsAt: 30_000 })
    await acceptPhase()
    expect(sent).toEqual([[...encodeSetSpeed(2)], [...encodeSetIncline(12)]])
    expect(deps.clearPendingCommands).toHaveBeenCalledTimes(1)
  })

  it('enters the next phase at its boundary and clears manual commands once per phase', async () => {
    const { runner, deps, sent, state, acceptPhase } = setup()
    await runner.play(plan, true)
    await acceptPhase()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(sent).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(state()).toEqual({ kind: 'running', plan, phaseId: 'climb', phaseEndsAt: 90_000 })
    await acceptPhase()
    expect(sent).toEqual([
      [...encodeSetSpeed(2)], [...encodeSetIncline(12)], [...encodeSetSpeed(3)], [...encodeSetIncline(6)],
    ])
    expect(deps.clearPendingCommands).toHaveBeenCalledTimes(2)
    expect(deps.stopBelt).not.toHaveBeenCalled()
  })

  it('finishes before calling STOP, preserves the medal and sends nothing afterwards', async () => {
    const { runner, deps, sent, events, state, acceptPhase } = setup()
    deps.stopBelt.mockImplementation(async () => {
      expect(state()).toEqual({ kind: 'finished', plan, durationSec: 90, distanceM: null })
      events.push('stop')
      runner.end('stop')
    })
    await runner.play(plan, true)
    await acceptPhase()
    await vi.advanceTimersByTimeAsync(30_000)
    await acceptPhase()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(events.slice(-2)).toEqual(['finished', 'stop'])
    const finished = state()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(state()).toBe(finished)
    expect(sent).toHaveLength(4)
    expect(deps.stopBelt).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([ok(ControlOp.setTargetSpeed), null, refused(ControlOp.setTargetSpeed)])(
    'ignores a late answer after the last phase finished: %j', async (response) => {
      const { runner, deps, sent, answers, state } = setup()
      await runner.play(singlePhase, true)
      await vi.advanceTimersByTimeAsync(30_000)
      const finished = state()
      expect(finished.kind).toBe('finished')
      answers[0]!(response)
      await vi.advanceTimersByTimeAsync(600_000)
      expect(state()).toBe(finished)
      expect(sent).toHaveLength(1)
      expect(deps.stopBelt).toHaveBeenCalledTimes(1)
    },
  )

  it.each([ok(ControlOp.setTargetSpeed), null, refused(ControlOp.setTargetSpeed)])(
    'ignores a phase answer after the next phase has started: %j', async (response) => {
      const { runner, sent, answers, state, acceptPhase } = setup()
      await runner.play(plan, true)
      await vi.advanceTimersByTimeAsync(30_000)
      const next = state()
      expect(next).toMatchObject({ kind: 'running', phaseId: 'climb' })
      answers[0]!(response)
      await vi.advanceTimersByTimeAsync(0)
      expect(state()).toBe(next)
      expect(sent).toEqual([[...encodeSetSpeed(2)], [...encodeSetSpeed(3)]])
      await acceptPhase()
      expect(sent[2]).toEqual([...encodeSetIncline(6)])
    },
  )

  it('ignores Play for a plan without phases', async () => {
    const { runner, deps, sent, state } = setup()
    await runner.play({ ...plan, phases: [] }, false)
    expect(state()).toEqual({ kind: 'idle' })
    expect(sent).toEqual([])
    expect(deps.startBelt).not.toHaveBeenCalled()
  })
})

describe('plan runner starting', () => {
  it('waits for Start to accept before showing or sending phase 1', async () => {
    const { runner, deps, sent, state, acceptPhase } = setup()
    const start = deferred<boolean>()
    deps.startBelt.mockReturnValueOnce(start.promise)
    const play = runner.play(plan, false)
    expect(state()).toEqual({ kind: 'starting', plan })
    expect(deps.startBelt).toHaveBeenCalledTimes(1)
    expect(deps.showTargets).not.toHaveBeenCalled()
    expect(sent).toEqual([])
    await vi.advanceTimersByTimeAsync(5000)
    start.resolve(true)
    await play
    expect(state()).toEqual({ kind: 'running', plan, phaseId: 'warmup', phaseEndsAt: 35_000 })
    await acceptPhase()
    expect(sent).toEqual([[...encodeSetSpeed(2)], [...encodeSetIncline(12)]])
  })

  it('ends without sending when Start is refused', async () => {
    const { runner, deps, sent, state } = setup()
    deps.startBelt.mockResolvedValueOnce(false)
    await runner.play(plan, false)
    expect(state()).toEqual({ kind: 'ended', plan, reason: 'startRefused' })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sent).toEqual([])
    expect(deps.showTargets).not.toHaveBeenCalled()
    expect(deps.stopBelt).not.toHaveBeenCalled()
  })

  it.each(['stop', 'disconnected', 'endPlan', 'beltStopped'] satisfies PlanEndReason[])(
    'invalidates the pending Start synchronously on %s', async (reason) => {
      const { runner, deps, sent, state } = setup()
      const start = deferred<boolean>()
      deps.startBelt.mockReturnValueOnce(start.promise)
      const play = runner.play(plan, false)
      runner.end(reason)
      expect(state()).toEqual({ kind: 'ended', plan, reason })
      start.resolve(true)
      await play
      await vi.advanceTimersByTimeAsync(600_000)
      expect(sent).toEqual([])
      expect(state()).toEqual({ kind: 'ended', plan, reason })
      expect(deps.showTargets).not.toHaveBeenCalled()
    },
  )

  it('does not let an old pending Start affect a new run', async () => {
    const { runner, deps, sent, state } = setup()
    const start = deferred<boolean>()
    deps.startBelt.mockReturnValueOnce(start.promise)
    const play = runner.play(plan, false)
    runner.end('stop')
    await runner.play(otherPlan, true)
    const current = state()
    start.resolve(false)
    await play
    expect(state()).toBe(current)
    expect(sent).toHaveLength(1)
  })
})

describe('plan runner endings', () => {
  const endings: PlanEndReason[] = ['stop', 'endPlan', 'disconnected', 'beltStopped']
  const cases = endings.flatMap((reason) => [0, 1].flatMap((commandIndex) =>
    [ok(ControlOp.setTargetSpeed), null, refused(ControlOp.setTargetSpeed)].map((response) => ({ reason, commandIndex, response })),
  ))

  it.each(cases)('sends nothing after $reason with command $commandIndex in flight and answer $response', async ({ reason, commandIndex, response }) => {
    const { runner, deps, sent, answers, answer, state } = setup()
    await runner.play(plan, true)
    if (commandIndex === 1) await answer(0)
    runner.end(reason)
    const ended = state()
    expect(ended).toEqual({ kind: 'ended', plan, reason })
    expect(vi.getTimerCount()).toBe(0)
    answers[commandIndex]!(response)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(state()).toBe(ended)
    expect(sent).toHaveLength(commandIndex + 1)
    expect(deps.stopBelt).not.toHaveBeenCalled()
  })

  it('does not let an old phase answer affect a new run', async () => {
    const { runner, sent, answers, state } = setup()
    await runner.play(plan, true)
    runner.end('endPlan')
    await runner.play(otherPlan, true)
    const current = state()
    answers[0]!(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(state()).toBe(current)
    expect(sent).toHaveLength(2)
  })
})

describe('plan runner failure and hold', () => {
  it('retries speed without incline when no incline is allowed after a refusal', async () => {
    const { runner, deps, sent, state, answer } = setup()
    await runner.play(plan, true)
    await answer(0)
    await answer(1, refused(ControlOp.setTargetInclination))
    expect(state()).toMatchObject({ kind: 'failed' })
    deps.targetsFor.mockImplementation((phase) => ({ speedKmh: phase.speedKmh, inclinePercent: null }))
    runner.retry()
    await answer(2)
    expect(sent.slice(2)).toEqual([[...encodeSetSpeed(2)]])
    expect(deps.showTargets).toHaveBeenLastCalledWith({ speedKmh: 2, inclinePercent: null })
    expect(state()).toMatchObject({ kind: 'running', phaseId: 'warmup' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state()).toMatchObject({ kind: 'running', phaseId: 'climb' })
  })

  it.each([refused(ControlOp.setTargetSpeed), null])('freezes on a live failure and retries both targets for the remainder: %j', async (response) => {
    const { runner, deps, sent, answers, state, acceptPhase } = setup()
    await runner.play(plan, true)
    await vi.advanceTimersByTimeAsync(7000)
    answers[0]!(response)
    await vi.advanceTimersByTimeAsync(0)
    expect(state()).toEqual({
      kind: 'failed', plan, phaseId: 'warmup', remainingMs: 23_000,
      message: response?.message ?? 'The console did not answer.',
    })
    const failed = state()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(state()).toBe(failed)
    expect(sent).toHaveLength(1)
    runner.retry()
    await acceptPhase()
    expect(sent.slice(1)).toEqual([[...encodeSetSpeed(2)], [...encodeSetIncline(12)]])
    expect(deps.clearPendingCommands).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(22_999)
    expect(state()).toMatchObject({ kind: 'running', phaseId: 'warmup' })
    await vi.advanceTimersByTimeAsync(1)
    expect(state()).toMatchObject({ kind: 'running', phaseId: 'climb' })
    expect(sent).toHaveLength(4)
  })

  it('fails on a refused incline as well as a refused speed', async () => {
    const { runner, sent, answers, answer, state } = setup()
    await runner.play(plan, true)
    await answer(0)
    await vi.advanceTimersByTimeAsync(4000)
    answers[1]!(refused(ControlOp.setTargetInclination))
    await vi.advanceTimersByTimeAsync(600_000)
    expect(state()).toEqual({ kind: 'failed', plan, phaseId: 'warmup', remainingMs: 26_000, message: 'Operation Failed' })
    expect(sent).toHaveLength(2)
  })

  it('holds the remainder and resumes without sending targets', async () => {
    const { runner, deps, sent, state, acceptPhase } = setup()
    await runner.play(plan, true)
    await acceptPhase()
    await vi.advanceTimersByTimeAsync(10_000)
    runner.hold()
    expect(state()).toEqual({ kind: 'held', plan, phaseId: 'warmup', remainingMs: 20_000 })
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(600_000)
    runner.resume()
    expect(state()).toEqual({ kind: 'running', plan, phaseId: 'warmup', phaseEndsAt: 630_000 })
    expect(sent).toHaveLength(2)
    expect(deps.clearPendingCommands).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(19_999)
    expect(sent).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(state()).toMatchObject({ kind: 'running', phaseId: 'climb' })
  })

  it('keeps the held remainder when an in-flight command fails', async () => {
    const { runner, answers, state, sent } = setup()
    await runner.play(plan, true)
    await vi.advanceTimersByTimeAsync(5000)
    runner.hold()
    await vi.advanceTimersByTimeAsync(100_000)
    answers[0]!(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(state()).toEqual({ kind: 'failed', plan, phaseId: 'warmup', remainingMs: 25_000, message: 'The console did not answer.' })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sent).toHaveLength(1)
  })
})

describe('plan runner saved changes', () => {
  it.each([{ speedKmh: 4 }, { inclinePercent: 7 }])('sends only speed on Save when no incline is allowed: %j', async (changes) => {
    const { runner, deps, sent, state, answer } = setup()
    deps.targetsFor.mockImplementation((phase) => ({ speedKmh: phase.speedKmh, inclinePercent: null }))
    await runner.play(plan, true)
    await answer(0)
    await vi.advanceTimersByTimeAsync(5000)
    const saved = changedPhase(0, changes)
    runner.planSaved(saved)
    await answer(1)
    expect(sent).toEqual([[...encodeSetSpeed(2)], [...encodeSetSpeed(saved.phases[0].speedKmh)]])
    expect(deps.showTargets).toHaveBeenLastCalledWith({ speedKmh: saved.phases[0].speedKmh, inclinePercent: null })
    expect(state()).toEqual({ kind: 'running', plan: saved, phaseId: 'warmup', phaseEndsAt: 30_000 })
  })

  it.each([
    { speedKmh: 4 },
    { inclinePercent: 7 },
  ])('shows and sends changed active targets immediately: %j', async (changes) => {
    const { runner, deps, sent, state, acceptPhase, events } = setup()
    await runner.play(plan, true)
    await acceptPhase()
    await vi.advanceTimersByTimeAsync(5000)
    const saved = changedPhase(0, changes)
    runner.planSaved(saved)
    expect(events.slice(-4)).toEqual(['clear', 'show', 'running', `send:${ControlOp.setTargetSpeed}`])
    const targets = { speedKmh: changes.speedKmh ?? 2, inclinePercent: changes.inclinePercent ?? 12 }
    expect(deps.showTargets).toHaveBeenLastCalledWith(targets)
    expect(state()).toEqual({ kind: 'running', plan: saved, phaseId: 'warmup', phaseEndsAt: 30_000 })
    await acceptPhase()
    expect(sent.slice(2)).toEqual([[...encodeSetSpeed(targets.speedKmh)], [...encodeSetIncline(targets.inclinePercent)]])
  })

  it('ignores an old answer after a Save sent new active targets', async () => {
    const { runner, answers, sent, state, acceptPhase } = setup()
    await runner.play(plan, true)
    runner.planSaved(changedPhase(0, { speedKmh: 4 }))
    const current = state()
    answers[0]!(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(state()).toBe(current)
    expect(sent).toEqual([[...encodeSetSpeed(2)], [...encodeSetSpeed(4)]])
    await acceptPhase()
    expect(sent[2]).toEqual([...encodeSetIncline(12)])
  })

  it('moves the end later by the duration difference without resending targets', async () => {
    const { runner, sent, state, acceptPhase } = setup()
    await runner.play(plan, true)
    await acceptPhase()
    await vi.advanceTimersByTimeAsync(10_000)
    const saved = changedPhase(0, { durationSec: 45 })
    runner.planSaved(saved)
    expect(state()).toEqual({ kind: 'running', plan: saved, phaseId: 'warmup', phaseEndsAt: 45_000 })
    expect(sent).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(34_999)
    expect(sent).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(state()).toMatchObject({ kind: 'running', phaseId: 'climb' })
  })

  it('advances immediately when the saved phase is already over, without sending its changed targets', async () => {
    const { runner, sent, state, acceptPhase } = setup()
    await runner.play(plan, true)
    await acceptPhase()
    await vi.advanceTimersByTimeAsync(10_000)
    const saved = changedPhase(0, { durationSec: 5, speedKmh: 9 })
    runner.planSaved(saved)
    expect(state()).toEqual({ kind: 'running', plan: saved, phaseId: 'climb', phaseEndsAt: 70_000 })
    await acceptPhase()
    expect(sent.slice(2)).toEqual([[...encodeSetSpeed(3)], [...encodeSetIncline(6)]])
  })

  it('uses later saved phases when reached and their durations in the medal', async () => {
    const { runner, sent, state, acceptPhase } = setup()
    await runner.play(plan, true)
    await acceptPhase()
    const saved = changedPhase(1, { speedKmh: 4, inclinePercent: 10, durationSec: 20 })
    runner.planSaved(saved)
    expect(sent).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state()).toEqual({ kind: 'running', plan: saved, phaseId: 'climb', phaseEndsAt: 50_000 })
    await acceptPhase()
    expect(sent.slice(2)).toEqual([[...encodeSetSpeed(4)], [...encodeSetIncline(10)]])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(state()).toEqual({ kind: 'finished', plan: saved, durationSec: 50, distanceM: null })
  })

  it('keeps the current command batch live when only a duration or name changed', async () => {
    const { runner, answers, state } = setup()
    await runner.play(plan, true)
    const saved = changedPhase(0, { name: 'New name', durationSec: 40 })
    runner.planSaved(saved)
    await vi.advanceTimersByTimeAsync(5000)
    answers[0]!(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(state()).toEqual({ kind: 'failed', plan: saved, phaseId: 'warmup', remainingMs: 35_000, message: 'The console did not answer.' })
  })

  it('uses the latest saved first phase once Start succeeds', async () => {
    const { runner, deps, sent, state, acceptPhase } = setup()
    const start = deferred<boolean>()
    deps.startBelt.mockReturnValueOnce(start.promise)
    const play = runner.play(plan, false)
    const saved: Plan = { ...plan, phases: [{ ...plan.phases[1]!, durationSec: 20 }] }
    runner.planSaved(saved)
    expect(state()).toEqual({ kind: 'starting', plan: saved })
    expect(sent).toEqual([])
    await vi.advanceTimersByTimeAsync(3000)
    start.resolve(true)
    await play
    expect(state()).toEqual({ kind: 'running', plan: saved, phaseId: 'climb', phaseEndsAt: 23_000 })
    await acceptPhase()
    expect(sent).toEqual([[...encodeSetSpeed(3)], [...encodeSetIncline(6)]])
  })

  it('ends without phase commands if a save removed every phase during Start', async () => {
    const { runner, deps, sent, state } = setup()
    const start = deferred<boolean>()
    deps.startBelt.mockReturnValueOnce(start.promise)
    const play = runner.play(plan, false)
    const saved = { ...plan, phases: [] }
    runner.planSaved(saved)
    start.resolve(true)
    await play
    expect(state()).toEqual({ kind: 'ended', plan: saved, reason: 'phaseRemoved' })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sent).toEqual([])
  })

  it('shifts a held remainder without sending and resumes on the new remainder', async () => {
    const { runner, sent, state, acceptPhase } = setup()
    await runner.play(plan, true)
    await acceptPhase()
    await vi.advanceTimersByTimeAsync(10_000)
    runner.hold()
    const saved = changedPhase(0, { speedKmh: 4, durationSec: 45 })
    runner.planSaved(saved)
    expect(state()).toEqual({ kind: 'held', plan: saved, phaseId: 'warmup', remainingMs: 35_000 })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sent).toHaveLength(2)
    runner.resume()
    expect(sent).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(34_999)
    expect(sent).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(sent[2]).toEqual([...encodeSetSpeed(3)])
  })

  it('shifts a failed remainder without sending and retries the saved targets', async () => {
    const { runner, sent, answers, state, acceptPhase } = setup()
    await runner.play(plan, true)
    await vi.advanceTimersByTimeAsync(10_000)
    answers[0]!(null)
    await vi.advanceTimersByTimeAsync(0)
    const saved = changedPhase(0, { speedKmh: 4, durationSec: 45 })
    runner.planSaved(saved)
    expect(state()).toEqual({ kind: 'failed', plan: saved, phaseId: 'warmup', remainingMs: 35_000, message: 'The console did not answer.' })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sent).toHaveLength(1)
    runner.retry()
    await acceptPhase()
    expect(sent.slice(1)).toEqual([[...encodeSetSpeed(4)], [...encodeSetIncline(12)]])
    await vi.advanceTimersByTimeAsync(34_999)
    expect(sent).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(state()).toMatchObject({ kind: 'running', phaseId: 'climb' })
  })

  it.each(['held', 'failed'] as const)('waits for resume or retry when a saved duration is already over in %s', async (kind) => {
    const { runner, sent, answers, state } = setup()
    await runner.play(plan, true)
    await vi.advanceTimersByTimeAsync(10_000)
    if (kind === 'held') runner.hold()
    else if (kind === 'failed') {
      answers[0]!(null)
      await vi.advanceTimersByTimeAsync(0)
    } else throw new Error(`Unknown run state: ${kind}`)
    runner.planSaved(changedPhase(0, { durationSec: 5, speedKmh: 9 }))
    expect(state()).toMatchObject({ kind, remainingMs: -5000 })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sent).toHaveLength(1)
    if (kind === 'held') runner.resume()
    else if (kind === 'failed') runner.retry()
    else throw new Error(`Unknown run state: ${kind}`)
    expect(state()).toMatchObject({ kind: 'running', phaseId: 'climb' })
    expect(sent).toEqual([[...encodeSetSpeed(2)], [...encodeSetSpeed(3)]])
  })

  it.each(['running', 'held', 'failed'] as const)('ends when the active phase is removed from %s', async (kind) => {
    const { runner, deps, sent, answers, state } = await inState(kind)
    const before = state()
    expect(isRunActive(before)).toBe(true)
    runner.planSaved({ ...plan, phases: [plan.phases[1]!] })
    expect(state()).toEqual({ kind: 'ended', plan, reason: 'phaseRemoved' })
    const ended = state()
    const count = sent.length
    answers[0]!(null)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(state()).toBe(ended)
    expect(sent).toHaveLength(count)
    expect(deps.stopBelt).not.toHaveBeenCalled()
  })
})

async function inState(kind: PlanRunState['kind']) {
  const test = setup()
  if (kind === 'idle') return test
  else if (kind === 'starting') {
    test.deps.startBelt.mockReturnValueOnce(new Promise(() => {}))
    void test.runner.play(plan, false)
  } else if (kind === 'running') await test.runner.play(plan, true)
  else if (kind === 'held') {
    await test.runner.play(plan, true)
    test.runner.hold()
  } else if (kind === 'failed') {
    await test.runner.play(plan, true)
    test.answers[0]!(null)
    await vi.advanceTimersByTimeAsync(0)
  } else if (kind === 'finished') {
    await test.runner.play(singlePhase, true)
    await test.acceptPhase()
    await vi.advanceTimersByTimeAsync(30_000)
  } else if (kind === 'ended') {
    await test.runner.play(plan, true)
    test.runner.end('endPlan')
  } else throw new Error(`Unknown run state: ${kind}`)
  return test
}

describe('plan runner state guards', () => {
  it.each(['starting', 'running', 'held', 'failed'] as const)('ignores Play and a save of another plan while %s', async (kind) => {
    const { runner, deps, sent, state } = await inState(kind)
    const before = state()
    const count = sent.length
    const starts = deps.startBelt.mock.calls.length
    await runner.play(otherPlan, false)
    runner.planSaved(otherPlan)
    expect(state()).toBe(before)
    expect(sent).toHaveLength(count)
    expect(deps.startBelt).toHaveBeenCalledTimes(starts)
  })

  it.each(['idle', 'finished', 'ended'] as const)('ignores end, save and distance while %s', async (kind) => {
    const { runner, sent, state } = await inState(kind)
    const before = state()
    const count = sent.length
    runner.end('disconnected')
    runner.planSaved(changedPhase(0, { speedKmh: 9 }))
    runner.recordDistance(999)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(state()).toBe(before)
    expect(sent).toHaveLength(count)
  })

  const noops = {
    idle: ['hold', 'resume', 'retry', 'dismiss'],
    starting: ['hold', 'resume', 'retry', 'dismiss'],
    running: ['resume', 'retry', 'dismiss'],
    held: ['hold', 'retry', 'dismiss'],
    failed: ['hold', 'resume', 'dismiss'],
    finished: ['hold', 'resume', 'retry'],
    ended: ['hold', 'resume', 'retry'],
  } as const

  it.each(Object.keys(noops) as PlanRunState['kind'][])('ignores inapplicable actions in %s', async (kind) => {
    const { runner, sent, state, deps } = await inState(kind)
    const before = state()
    const count = sent.length
    const changes = deps.onChange.mock.calls.length
    for (const action of noops[kind]) runner[action]()
    expect(state()).toBe(before)
    expect(sent).toHaveLength(count)
    expect(deps.onChange).toHaveBeenCalledTimes(changes)
  })

  it.each(['held', 'failed'] as const)('ends %s without sending or stopping the belt', async (kind) => {
    const { runner, sent, deps, state } = await inState(kind)
    runner.end('endPlan')
    expect(state()).toEqual({ kind: 'ended', plan, reason: 'endPlan' })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sent).toHaveLength(1)
    expect(deps.stopBelt).not.toHaveBeenCalled()
  })

  it.each(['finished', 'ended'] as const)('dismisses %s without commands', async (kind) => {
    const { runner, sent, state } = await inState(kind)
    const count = sent.length
    runner.dismiss()
    expect(state()).toEqual({ kind: 'idle' })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sent).toHaveLength(count)
  })

  it.each(['finished', 'ended'] as const)('starts a new plan after %s', async (kind) => {
    const { runner, sent, state } = await inState(kind)
    const count = sent.length
    const now = performance.now()
    await runner.play(otherPlan, true)
    expect(state()).toEqual({ kind: 'running', plan: otherPlan, phaseId: 'warmup', phaseEndsAt: now + 30_000 })
    expect(sent).toHaveLength(count + 1)
  })
})

describe('plan runner distance', () => {
  it('uses the first value as a baseline, counts increments and credits a console reset whole', async () => {
    const { runner, state, acceptPhase } = setup()
    runner.recordDistance(1000)
    await runner.play(singlePhase, true)
    await acceptPhase()
    runner.recordDistance(undefined)
    runner.recordDistance(2960)
    runner.recordDistance(2970)
    runner.recordDistance(undefined)
    runner.recordDistance(2985)
    runner.recordDistance(3)
    runner.recordDistance(8)
    runner.recordDistance(8)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state()).toMatchObject({ kind: 'finished', distanceM: 33 })
    runner.recordDistance(1000)
    expect(state()).toMatchObject({ kind: 'finished', distanceM: 33 })
  })

  it('counts distance while starting, held and failed and resets it for the next run', async () => {
    const { runner, deps, answers, state, acceptPhase } = setup()
    const start = deferred<boolean>()
    deps.startBelt.mockReturnValueOnce(start.promise)
    const play = runner.play(singlePhase, false)
    runner.recordDistance(100)
    runner.recordDistance(105)
    start.resolve(true)
    await play
    runner.hold()
    runner.recordDistance(110)
    answers[0]!(null)
    await vi.advanceTimersByTimeAsync(0)
    runner.recordDistance(115)
    runner.retry()
    await acceptPhase()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state()).toMatchObject({ kind: 'finished', distanceM: 15 })
    await runner.play(singlePhase, true)
    await acceptPhase()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state()).toMatchObject({ kind: 'finished', distanceM: null })
  })

  it('reports zero rather than no distance when only a baseline was seen', async () => {
    const { runner, state } = setup()
    await runner.play(singlePhase, true)
    runner.recordDistance(0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state()).toMatchObject({ kind: 'finished', distanceM: 0 })
  })

  it('does not let distance received after an ended run become the next baseline', async () => {
    const { runner, state } = setup()
    await runner.play(singlePhase, true)
    runner.recordDistance(100)
    runner.end('endPlan')
    runner.recordDistance(1000)
    await runner.play(singlePhase, true)
    runner.recordDistance(1500)
    runner.recordDistance(1510)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state()).toMatchObject({ kind: 'finished', distanceM: 10 })
  })
})

describe('isRunActive', () => {
  const cases: Array<{ state: PlanRunState; active: boolean }> = [
    { state: { kind: 'idle' }, active: false },
    { state: { kind: 'starting', plan }, active: true },
    { state: { kind: 'running', plan, phaseId: 'warmup', phaseEndsAt: 30_000 }, active: true },
    { state: { kind: 'held', plan, phaseId: 'warmup', remainingMs: 30_000 }, active: true },
    { state: { kind: 'failed', plan, phaseId: 'warmup', remainingMs: 30_000, message: 'Refused' }, active: true },
    { state: { kind: 'finished', plan, durationSec: 90, distanceM: null }, active: false },
    { state: { kind: 'ended', plan, reason: 'stop' }, active: false },
  ]

  it.each(cases)('reports $state.kind as active=$active', ({ state, active }) => {
    expect(isRunActive(state)).toBe(active)
  })

  it('rejects an unknown state', () => {
    expect(() => isRunActive({ kind: 'unknown' } as unknown as PlanRunState)).toThrow(/Unknown run state/)
  })
})
