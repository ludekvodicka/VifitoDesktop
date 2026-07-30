import { describe, expect, it } from 'vitest'
import { kcalPerKgPerSec, recordKcal, RUNNING_THRESHOLD_KMH } from './calories'

describe('kcalPerKgPerSec', () => {
  it('matches the ACSM walking equation at 5 km/h on the flat', () => {
    // v = 83.33 m/min, VO2 = 3.5 + 8.333 = 11.833 ml/kg/min -> 11.833/1000*5/60 kcal/kg/s
    expect(kcalPerKgPerSec(5, 0)).toBeCloseTo(0.000986, 6)
  })

  it('spends more on an incline than on the flat', () => {
    expect(kcalPerKgPerSec(5, 8)).toBeGreaterThan(kcalPerKgPerSec(5, 0))
  })

  it('returns zero for a stopped or nonsensical speed', () => {
    expect(kcalPerKgPerSec(0, 5)).toBe(0)
    expect(kcalPerKgPerSec(-3, 5)).toBe(0)
    expect(kcalPerKgPerSec(NaN, 0)).toBe(0)
  })

  it('treats a missing incline as flat rather than as a break', () => {
    expect(kcalPerKgPerSec(5, NaN)).toBeCloseTo(kcalPerKgPerSec(5, 0), 9)
  })

  it('switches equation at the running threshold', () => {
    const walking = kcalPerKgPerSec(RUNNING_THRESHOLD_KMH - 0.1, 0)
    const running = kcalPerKgPerSec(RUNNING_THRESHOLD_KMH, 0)
    // The running equation weights speed twice as heavily, so it jumps at the threshold.
    expect(running).toBeGreaterThan(walking)
  })

  it('grows with time linearly, which is what lets the record store one integral', () => {
    expect(kcalPerKgPerSec(6, 2) * 3600).toBeCloseTo(kcalPerKgPerSec(6, 2) * 1800 * 2, 9)
  })
})

describe('recordKcal', () => {
  const record = (kcalPerKg: number, kcalConsole: number) => ({ kcalPerKg, kcalConsole })

  it('prefers the estimate when a weight is known', () => {
    expect(recordKcal(record(4, 250), 80)).toEqual({ value: 320, source: 'estimate' })
  })

  it('falls back to the console value when no weight is filled in', () => {
    expect(recordKcal(record(4, 250), null)).toEqual({ value: 250, source: 'console' })
  })

  it('falls back to the console value when the estimate is empty', () => {
    expect(recordKcal(record(0, 250), 80)).toEqual({ value: 250, source: 'console' })
  })

  it('returns null when neither number exists, so the UI can show a dash', () => {
    expect(recordKcal(record(0, 0), 80)).toBeNull()
    expect(recordKcal(record(0, 0), null)).toBeNull()
  })

  it('ignores a zero or negative weight instead of estimating nothing', () => {
    expect(recordKcal(record(4, 250), 0)).toEqual({ value: 250, source: 'console' })
  })
})
