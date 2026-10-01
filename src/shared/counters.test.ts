import { describe, expect, it } from 'vitest'
import { accumulate, seed, type Counter } from './counters'

describe('accumulate', () => {
  it('adds the first value whole when there is no baseline', () => {
    const counter: Counter = { total: 0 }
    expect(accumulate(counter, 100)).toEqual({ delta: 100, whole: true })
    expect(counter).toEqual({ total: 100, last: 100 })
  })

  it('counts only increments after a seed', () => {
    const counter: Counter = { total: 0 }
    expect(seed(counter, 2960)).toEqual({ delta: 0, whole: false })
    expect(counter).toEqual({ total: 0, last: 2960 })
    expect(accumulate(counter, 2975)).toEqual({ delta: 15, whole: false })
    expect(accumulate(counter, 3000)).toEqual({ delta: 25, whole: false })
    expect(counter).toEqual({ total: 40, last: 3000 })
  })

  it('counts a new value whole after a drop, then continues with increments', () => {
    const counter: Counter = { total: 40, last: 3000 }
    expect(accumulate(counter, 50)).toEqual({ delta: 50, whole: true })
    expect(accumulate(counter, 90)).toEqual({ delta: 40, whole: false })
    expect(counter).toEqual({ total: 130, last: 90 })
  })

  it('leaves the total and last value unchanged for an undefined value', () => {
    const counter: Counter = { total: 40, last: 3000 }
    expect(accumulate(counter, undefined)).toEqual({ delta: 0, whole: false })
    expect(counter).toEqual({ total: 40, last: 3000 })
    expect(accumulate(counter, 3010)).toEqual({ delta: 10, whole: false })
    expect(counter).toEqual({ total: 50, last: 3010 })
  })

  it('keeps last unset until a counter value arrives', () => {
    const counter: Counter = { total: 0 }
    expect(accumulate(counter, undefined)).toEqual({ delta: 0, whole: false })
    expect(counter).toEqual({ total: 0 })
  })

  it('adds nothing for a repeated value and handles a reset to zero', () => {
    const counter: Counter = { total: 100, last: 100 }
    expect(accumulate(counter, 100)).toEqual({ delta: 0, whole: false })
    expect(accumulate(counter, 0)).toEqual({ delta: 0, whole: true })
    expect(accumulate(counter, 5)).toEqual({ delta: 5, whole: false })
    expect(counter).toEqual({ total: 105, last: 5 })
  })
})

describe('seed', () => {
  it('leaves last unset when the seed is undefined', () => {
    const counter: Counter = { total: 0 }
    expect(seed(counter, undefined)).toEqual({ delta: 0, whole: false })
    expect(counter).toEqual({ total: 0 })
  })

  it('preserves an existing baseline and total when the seed is undefined', () => {
    const counter: Counter = { total: 40, last: 3000 }
    expect(seed(counter, undefined)).toEqual({ delta: 0, whole: false })
    expect(counter).toEqual({ total: 40, last: 3000 })
  })

  it('replaces the baseline without changing an existing total', () => {
    const counter: Counter = { total: 40, last: 3000 }
    expect(seed(counter, 100)).toEqual({ delta: 0, whole: false })
    expect(counter).toEqual({ total: 40, last: 100 })
  })
})
