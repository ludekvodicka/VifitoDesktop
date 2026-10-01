import { describe, expect, it } from 'vitest'
import { PLAN_LIMITS, type Plan } from '../../shared/plans'
import { quantize } from '../ble/controlPoint'
import { isDirty, newPhase, phaseWarnings, readDraft, toDraft, type PhaseDraft } from './planDraft'

const plan: Plan = {
  id: 'walk',
  name: 'Morning walk',
  color: 'blue',
  phases: [
    { id: 'warmup', name: 'Warm up', speedKmh: 2, inclinePercent: 0, durationSec: 30 },
    { id: 'climb', name: '', speedKmh: 3.5, inclinePercent: 3, durationSec: 180 },
  ],
}

describe('plan drafts', () => {
  it('round-trips a saved plan without changing its values or ids', () => {
    expect(readDraft(toDraft(plan), plan.id)).toEqual({ ok: true, plan })
  })

  it('allows a named plan with no phases', () => {
    const empty = { ...plan, phases: [] }
    expect(readDraft(toDraft(empty), empty.id)).toEqual({ ok: true, plan: empty })
  })

  it.each(['', '  \t '])('requires a nonblank name: %j', (name) => {
    expect(readDraft({ ...toDraft(plan), name }, plan.id)).toEqual({
      ok: false, problems: [{ phaseId: null, message: 'The plan needs a name.' }],
    })
  })

  it('trims plan and phase names and keeps an optional phase name empty', () => {
    const draft = toDraft(plan)
    draft.name = ' Morning walk '
    draft.phases[0].name = ' Warm up '
    draft.phases[1].name = '  '
    expect(readDraft(draft, plan.id)).toEqual({ ok: true, plan })
  })

  it('reports names beyond the stored limits', () => {
    const draft = toDraft(plan)
    draft.name = 'n'.repeat(PLAN_LIMITS.nameLength + 1)
    draft.phases[0].name = 'p'.repeat(PLAN_LIMITS.phaseNameLength + 1)
    const result = readDraft(draft, plan.id)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected name problems')
    expect(result.problems.map((problem) => problem.phaseId)).toEqual([null, 'warmup'])
  })

  it.each([
    ['speedKmh', '', 'speed'],
    ['speedKmh', '0', 'speed'],
    ['speedKmh', '31', 'speed'],
    ['speedKmh', 'fast', 'speed'],
    ['speedKmh', 'Infinity', 'speed'],
    ['inclinePercent', '', 'incline'],
    ['inclinePercent', '-1', 'incline'],
    ['inclinePercent', '31', 'incline'],
    ['inclinePercent', 'NaN', 'incline'],
    ['minutes', '-1', 'minutes'],
    ['minutes', '100', 'minutes'],
    ['minutes', '1.5', 'minutes'],
    ['minutes', 'later', 'minutes'],
    ['seconds', '-1', 'seconds'],
    ['seconds', '60', 'seconds'],
    ['seconds', '5.5', 'seconds'],
    ['seconds', 'soon', 'seconds'],
  ] as const)('rejects %s = %j', (field, value, message) => {
    const draft = toDraft(plan)
    draft.phases[0][field] = value
    const result = readDraft(draft, plan.id)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected a phase problem')
    expect(result.problems).toContainEqual({ phaseId: 'warmup', message: expect.stringContaining(message) })
  })

  it('rejects a four-second phase', () => {
    const draft = toDraft(plan)
    draft.phases[0].seconds = '4'
    expect(readDraft(draft, plan.id)).toEqual({
      ok: false, problems: [{ phaseId: 'warmup', message: 'Warm up: duration must be at least 5 seconds.' }],
    })
  })

  it.each([
    ['', '30', 30],
    [' ', '30', 30],
    ['1', '', 60],
    ['0', '5', 5],
    ['99', '59', 5999],
  ])('reads %j minutes and %j seconds as %s seconds', (minutes, seconds, durationSec) => {
    const draft = toDraft(plan)
    Object.assign(draft.phases[0], { minutes, seconds })
    const result = readDraft(draft, plan.id)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected a valid phase')
    expect(result.plan.phases[0].durationSec).toBe(durationSec)
  })

  it('rejects a completely empty duration and labels an unnamed phase by position', () => {
    const draft = toDraft(plan)
    Object.assign(draft.phases[1], { minutes: '', seconds: '' })
    expect(readDraft(draft, plan.id)).toEqual({
      ok: false, problems: [{ phaseId: 'climb', message: 'Phase 2: duration must be at least 5 seconds.' }],
    })
  })

  it('accepts the numeric boundaries and does not silently round typed speed or incline', () => {
    const draft = toDraft(plan)
    Object.assign(draft.phases[0], { speedKmh: '0.1', inclinePercent: '30' })
    Object.assign(draft.phases[1], { speedKmh: '3.33', inclinePercent: '0' })
    const result = readDraft(draft, plan.id)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected valid targets')
    expect(result.plan.phases[0]).toMatchObject({ speedKmh: 0.1, inclinePercent: 30 })
    expect(result.plan.phases[1]).toMatchObject({ speedKmh: 3.33, inclinePercent: 0 })
  })

  it('collects problems across the entire plan', () => {
    const draft = toDraft(plan)
    draft.name = ''
    draft.phases[0].speedKmh = ''
    draft.phases[1].inclinePercent = '-1'
    const result = readDraft(draft, plan.id)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected multiple problems')
    expect(result.problems.map((problem) => problem.phaseId)).toEqual([null, 'warmup', 'climb'])
  })
})

describe('isDirty', () => {
  it('is false for an untouched draft', () => {
    expect(isDirty(toDraft(plan), plan)).toBe(false)
  })

  it('detects name and color edits', () => {
    expect(isDirty({ ...toDraft(plan), name: 'Evening walk' }, plan)).toBe(true)
    expect(isDirty({ ...toDraft(plan), color: 'green' }, plan)).toBe(true)
  })

  it.each([
    ['name', 'New phase'],
    ['speedKmh', '3'],
    ['inclinePercent', '2'],
    ['minutes', '1'],
    ['seconds', '20'],
  ] as const)('detects a phase %s edit without mutating the saved plan', (field, value) => {
    const original = structuredClone(plan)
    const draft = toDraft(plan)
    draft.phases[0][field] = value
    expect(isDirty(draft, plan)).toBe(true)
    expect(plan).toEqual(original)
  })

  it('compares raw text, including unfinished numbers and whitespace', () => {
    const draft = toDraft(plan)
    draft.phases[0].speedKmh = '2.'
    expect(isDirty(draft, plan)).toBe(true)
    expect(isDirty({ ...toDraft(plan), name: `${plan.name} ` }, plan)).toBe(true)
  })

  it('detects phase additions, removals and replacement ids', () => {
    const draft = toDraft(plan)
    expect(isDirty({ ...draft, phases: [...draft.phases, newPhase(undefined)] }, plan)).toBe(true)
    expect(isDirty({ ...draft, phases: draft.phases.slice(1) }, plan)).toBe(true)
    draft.phases[0].id = 'replacement'
    expect(isDirty(draft, plan)).toBe(true)
  })
})

describe('newPhase', () => {
  it('starts with 2 km/h, 0 % and one minute', () => {
    expect(newPhase(undefined)).toEqual({
      id: expect.any(String), name: '', speedKmh: '2', inclinePercent: '0', minutes: '1', seconds: '0',
    })
  })

  it('copies the previous speed and incline but resets the name and duration', () => {
    const last = { ...toDraft(plan).phases[0], speedKmh: '3.', inclinePercent: '6' }
    expect(newPhase(last)).toEqual({
      id: expect.any(String), name: '', speedKmh: '3.', inclinePercent: '6', minutes: '1', seconds: '0',
    })
  })

  it('gives each phase a distinct id', () => {
    const first = newPhase(undefined)
    const second = newPhase(first)
    const third = newPhase(second)
    expect(new Set([first.id, second.id, third.id]).size).toBe(3)
  })
})

describe('phaseWarnings', () => {
  const phase: PhaseDraft = { id: 'climb', name: '', speedKmh: '3.3', inclinePercent: '14', minutes: '1', seconds: '0' }
  const targetsFor = (value: Plan['phases'][number]) => ({
    speedKmh: quantize(value.speedKmh, { min: 0.1, max: 20, step: 0.1 }, 0.5),
    inclinePercent: quantize(value.inclinePercent, { min: 0, max: 12, step: 0.5 }, 0.5),
  })

  it('warns that an incline above the maximum runs at the capped target', () => {
    expect(phaseWarnings(phase, targetsFor, 12)).toEqual(['Above your maximum incline, runs at 12.0 %.'])
  })

  it('warns from Settings even while the console is disconnected', () => {
    expect(phaseWarnings(phase, null, 12)).toEqual(['Above your maximum incline, runs at 12.0 %.'])
  })

  it.each(['0', '0.5', '14'])('warns that incline %s will be skipped when the console minimum exceeds the cap', (inclinePercent) => {
    const noIncline = (value: Plan['phases'][number]) => ({ speedKmh: value.speedKmh, inclinePercent: null })
    expect(phaseWarnings({ ...phase, inclinePercent }, noIncline, 0.5)).toEqual([
      'Incline will not be set because the console minimum is above the maximum from Settings.',
    ])
  })

  it('does not warn about an unsupported cap without a connected console range', () => {
    expect(phaseWarnings({ ...phase, inclinePercent: '0.5' }, null, 0.5)).toEqual([])
    expect(phaseWarnings(phase, null, 0.5)).toEqual(['Above your maximum incline, runs at 0.5 %.'])
  })

  it('keeps the speed warning when incline will not be set', () => {
    expect(phaseWarnings(phase, () => ({ speedKmh: 3.5, inclinePercent: null }), 0.5)).toEqual([
      'Incline will not be set because the console minimum is above the maximum from Settings.',
      'This console runs it at 3.5 km/h.',
    ])
  })

  it('shows the console target when the cap lies between grid points', () => {
    expect(phaseWarnings(phase, targetsFor, 12.3)).toEqual(['Above your maximum incline, runs at 12.0 %.'])
  })

  it('warns about speed quantization separately from incline limits', () => {
    expect(phaseWarnings({ ...phase, speedKmh: '3.33' }, targetsFor, 12)).toEqual([
      'Above your maximum incline, runs at 12.0 %.',
      'This console runs it at 3.3 km/h.',
    ])
  })

  it('warns when only the console changes an incline', () => {
    expect(phaseWarnings({ ...phase, inclinePercent: '3.3' }, targetsFor, null)).toEqual([
      'This console runs it at 3.5 %.',
    ])
  })

  it('has no warnings when both targets are reachable', () => {
    expect(phaseWarnings({ ...phase, inclinePercent: '12' }, targetsFor, 12)).toEqual([])
    expect(phaseWarnings(phase, null, null)).toEqual([])
  })

  it.each([
    ['speedKmh', ''],
    ['speedKmh', 'fast'],
    ['inclinePercent', ''],
    ['inclinePercent', 'NaN'],
  ] as const)('does not warn for an unparsable %s = %j', (field, value) => {
    expect(phaseWarnings({ ...phase, [field]: value }, targetsFor, 12)).toEqual([])
  })
})
