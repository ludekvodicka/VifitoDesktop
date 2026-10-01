import { describe, expect, it } from 'vitest'
import { PLAN_COLORS, normalizePlan, normalizePlans, phaseLabel, planDurationSec, type Plan } from './plans'

const plan: Plan = {
  id: 'walk',
  name: 'Morning walk',
  color: 'green',
  phases: [
    { id: 'warmup', name: 'Warm up', speedKmh: 2, inclinePercent: 0, durationSec: 30 },
    { id: 'walk-uphill', name: '', speedKmh: 3.5, inclinePercent: 3, durationSec: 180 },
  ],
}

describe('normalizePlans', () => {
  it('returns an empty list for anything that is not an array', () => {
    for (const value of [undefined, null, {}, 'x', 42, false]) expect(normalizePlans(value)).toEqual([])
  })

  it('keeps valid plans and their ids unchanged', () => {
    expect(normalizePlans([plan])).toEqual([plan])
    expect(normalizePlans([])).toEqual([])
  })

  it('drops non-object plans and keeps the others in order', () => {
    const second = { ...plan, id: 'evening', name: 'Evening walk' }
    expect(normalizePlans([null, plan, 'x', [], false, 42, undefined, second])).toEqual([plan, second])
  })
})

describe('normalizePlan', () => {
  it('drops values that are not plan objects', () => {
    for (const value of [undefined, null, 'x', 42, false, []]) expect(normalizePlan(value)).toBeNull()
  })

  it('keeps a valid plan unchanged', () => {
    expect(normalizePlan(plan)).toEqual(plan)
  })

  it.each([
    ['speedKmh', 0, 0.1],
    ['speedKmh', -1, 0.1],
    ['speedKmh', 99, 30],
    ['inclinePercent', -2, 0],
    ['inclinePercent', 45, 30],
    ['durationSec', 1, 5],
    ['durationSec', 10000, 5999],
  ])('clamps %s = %s to %s', (field, value, expected) => {
    const normalized = normalizePlan({ ...plan, phases: [{ ...plan.phases[0], [field]: value }] })
    expect(normalized?.phases[0]).toMatchObject({ [field]: expected })
  })

  it('reads numeric strings and rounds speeds, inclines and durations', () => {
    const normalized = normalizePlan({
      ...plan,
      phases: [
        { ...plan.phases[0], speedKmh: '3.5', inclinePercent: ' 12.34 ', durationSec: '60.6' },
        { ...plan.phases[1], speedKmh: 3.56, inclinePercent: 2.26, durationSec: 5.4 },
      ],
    })
    expect(normalized?.phases).toEqual([
      { ...plan.phases[0], speedKmh: 3.5, inclinePercent: 12.3, durationSec: 61 },
      { ...plan.phases[1], speedKmh: 3.6, inclinePercent: 2.3, durationSec: 5 },
    ])
  })

  it('repairs missing or invalid numeric fields to their minimums', () => {
    for (const value of [undefined, null, '', ' ', 'fast', NaN, Infinity, -Infinity, false, {}, []]) {
      const normalized = normalizePlan({ phases: [{ speedKmh: value, inclinePercent: value, durationSec: value }] })
      expect(normalized?.phases[0]).toMatchObject({ speedKmh: 0.1, inclinePercent: 0, durationSec: 5 })
    }
  })

  it('keeps every palette color and repairs unknown colors to blue', () => {
    for (const color of Object.keys(PLAN_COLORS)) expect(normalizePlan({ ...plan, color })?.color).toBe(color)
    for (const color of ['teal', 'toString', 'constructor', '__proto__', '', null, undefined, 1])
      expect(normalizePlan({ ...plan, color })?.color).toBe('blue')
  })

  it('generates separate UUIDs for missing, blank or invalid plan and phase ids', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    for (const id of [undefined, null, '', ' ', 42]) {
      const normalized = normalizePlan({ id, phases: [{ id }, { id }] })!
      const ids = [normalized.id, ...normalized.phases.map((phase) => phase.id)]
      for (const generated of ids) expect(generated).toMatch(uuid)
      expect(new Set(ids).size).toBe(3)
    }
  })

  it('trims names and caps plans at 60 characters and phases at 40', () => {
    const normalized = normalizePlan({
      ...plan,
      name: `  ${'p'.repeat(70)}  `,
      phases: [{ ...plan.phases[0], name: `  ${'s'.repeat(50)}  ` }, { ...plan.phases[1], name: '  Uphill  ' }],
    })
    expect(normalized?.name).toBe('p'.repeat(60))
    expect(normalized?.phases.map((phase) => phase.name)).toEqual(['s'.repeat(40), 'Uphill'])
    expect(normalizePlan({ ...plan, name: '  Morning walk  ' })?.name).toBe('Morning walk')
  })

  it('repairs blank or invalid names without storing the phase position', () => {
    for (const name of ['', ' ', undefined, null, 42]) {
      const normalized = normalizePlan({ name, phases: [{ name }] })
      expect(normalized?.name).toBe('Untitled plan')
      expect(normalized?.phases[0]?.name).toBe('')
    }
  })

  it('drops non-object phases and keeps the others in order', () => {
    expect(normalizePlan({ ...plan, phases: [null, plan.phases[0], 'x', [], false, 42, undefined, plan.phases[1]] })).toEqual(plan)
  })

  it('repairs a missing or invalid phase list to an empty list', () => {
    for (const phases of [undefined, null, {}, 'x', 42, []])
      expect(normalizePlan({ ...plan, phases })?.phases).toEqual([])
  })
})

describe('phaseLabel', () => {
  it('uses the current position for an unnamed phase', () => {
    expect(phaseLabel('', 2)).toBe('Phase 3')
  })

  it('keeps a named phase', () => {
    expect(phaseLabel('Warm up', 2)).toBe('Warm up')
  })
})

describe('planDurationSec', () => {
  it('sums the phase durations', () => {
    expect(planDurationSec(plan)).toBe(210)
  })

  it('returns zero for an empty plan', () => {
    expect(planDurationSec({ ...plan, phases: [] })).toBe(0)
  })
})
