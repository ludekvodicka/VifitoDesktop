import { describe, expect, it } from 'vitest'
import { kcalPerKgPerSec } from '../shared/calories'
import { buildDayStats, summarizeDay, type Sample } from './summary'

const t0 = Date.UTC(2026, 6, 29, 8, 0, 0)
const at = (sec: number, sample: Omit<Sample, 't'>): Sample => ({ t: t0 + sec * 1000, ...sample })

describe('summarizeDay', () => {
  it('sums the increments of the console counters', () => {
    const summary = summarizeDay([
      at(0, { speedKmh: 0, distanceM: 0, elapsedSec: 0 }),
      at(1, { speedKmh: 4, distanceM: 1, elapsedSec: 1 }),
      at(2, { speedKmh: 4, distanceM: 2, elapsedSec: 2 }),
      at(3, { speedKmh: 4, distanceM: 3, elapsedSec: 3 }),
    ])
    expect(summary.distanceM).toBe(3)
    expect(summary.movingSec).toBe(3)
    expect(summary.sessions).toBe(1)
  })

  it('adds the first counter value whole, the workout was already running', () => {
    const summary = summarizeDay([
      at(0, { distanceM: 4390, elapsedSec: 3960 }),
      at(1, { distanceM: 4400, elapsedSec: 3961 }),
    ])
    expect(summary.distanceM).toBe(4400)
    expect(summary.movingSec).toBe(3961)
  })

  it('adds the new value after a counter reset, not the difference', () => {
    const summary = summarizeDay([
      at(0, { distanceM: 500 }),
      at(1, { distanceM: 520 }),
      at(2, { distanceM: 5 }),
      at(3, { distanceM: 12 }),
    ])
    expect(summary.distanceM).toBe(500 + 20 + 5 + 7)
  })

  it('does not add the absolute value twice when distance arrives in every other sample', () => {
    const summary = summarizeDay([
      at(0, { speedKmh: 4, distanceM: 100 }),
      at(1, { speedKmh: 4 }),
      at(2, { speedKmh: 4, distanceM: 102 }),
      at(3, { speedKmh: 4 }),
      at(4, { speedKmh: 4, distanceM: 104 }),
    ])
    expect(summary.distanceM).toBe(104)
  })

  it('adds nothing for a repeated identical sample', () => {
    const summary = summarizeDay([
      at(0, { distanceM: 100, elapsedSec: 60 }),
      at(1, { distanceM: 100, elapsedSec: 60 }),
      at(2, { distanceM: 100, elapsedSec: 60 }),
    ])
    expect(summary.distanceM).toBe(100)
    expect(summary.movingSec).toBe(60)
  })

  it('treats a gap longer than the limit as a new session', () => {
    const summary = summarizeDay([at(0, { distanceM: 100 }), at(600, { distanceM: 300 })])
    expect(summary.sessions).toBe(2)
    expect(summary.distanceM).toBe(300)
  })

  it('handles an empty day', () => {
    expect(summarizeDay([])).toEqual({ samples: 0, distanceM: 0, movingSec: 0, sessions: 0 })
  })
})

describe('buildDayStats', () => {
  it('keeps one record across the console resetting its counters mid-block', () => {
    // Real data had a single gap-free block containing seven counter resets.
    const stats = buildDayStats([
      at(0, { speedKmh: 4, distanceM: 0, elapsedSec: 0 }),
      at(10, { speedKmh: 4, distanceM: 100, elapsedSec: 100 }),
      at(20, { speedKmh: 4, distanceM: 200, elapsedSec: 200 }),
      at(30, { speedKmh: 4, distanceM: 20, elapsedSec: 50 }),
      at(40, { speedKmh: 4, distanceM: 60, elapsedSec: 100 }),
    ])
    expect(stats.records).toHaveLength(1)
    expect(stats.records[0]?.durationSec).toBe(300)
    expect(stats.records[0]?.distanceM).toBe(260)
  })

  it('backdates the start when it joins a workout the console was already counting', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 6, distanceM: 2960, elapsedSec: 2499 }),
      at(10, { speedKmh: 6, distanceM: 2980, elapsedSec: 2509 }),
    ])
    expect(stats.records[0]?.startedAt).toBe(t0 - 2499 * 1000)
    expect(stats.records[0]?.durationSec).toBe(2509)
  })

  it('lets bare samples hold the chain without adding anything', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 4, distanceM: 0, elapsedSec: 0 }),
      at(10, {}),
      at(20, {}),
      at(30, { speedKmh: 4, distanceM: 50, elapsedSec: 30 }),
    ])
    expect(stats.records).toHaveLength(1)
    expect(stats.records[0]?.samples).toBe(4)
    expect(stats.records[0]?.distanceM).toBe(50)
  })

  it('does not split or double count on duplicate timestamps', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 4, distanceM: 10, elapsedSec: 10 }),
      at(0, { speedKmh: 4, distanceM: 10, elapsedSec: 10 }),
      at(1, { speedKmh: 4, distanceM: 20, elapsedSec: 11 }),
    ])
    expect(stats.records).toHaveLength(1)
    expect(stats.records[0]?.distanceM).toBe(20)
  })

  it('counts a block with no movement as a session but not as a record', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 4, distanceM: 0, elapsedSec: 0 }),
      at(10, { speedKmh: 4, distanceM: 100, elapsedSec: 10 }),
      at(600, { speedKmh: 0 }),
      at(610, { speedKmh: 0 }),
    ])
    expect(stats.records).toHaveLength(1)
    expect(stats.totals.sessions).toBe(2)
  })

  it('still emits a record whose distance quantized to zero', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 2, distanceM: 0, elapsedSec: 0 }),
      at(10, { speedKmh: 2, distanceM: 0, elapsedSec: 10 }),
    ])
    expect(stats.records).toHaveLength(1)
    expect(stats.records[0]?.distanceM).toBe(0)
    expect(stats.records[0]?.avgSpeedKmh).toBe(0)
  })

  it('averages only the non-zero heart rate readings', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 4, elapsedSec: 0, heartRateBpm: 0 }),
      at(10, { speedKmh: 4, elapsedSec: 10, heartRateBpm: 0 }),
      at(20, { speedKmh: 4, elapsedSec: 20, heartRateBpm: 78 }),
      at(30, { speedKmh: 4, elapsedSec: 30, heartRateBpm: 82 }),
    ])
    expect(stats.records[0]?.avgHeartRateBpm).toBe(80)
  })

  it('leaves the heart rate unset when every reading is zero', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 4, elapsedSec: 0, heartRateBpm: 0 }),
      at(10, { speedKmh: 4, elapsedSec: 10, heartRateBpm: 0 }),
    ])
    expect(stats.records[0]?.avgHeartRateBpm).toBeUndefined()
  })

  it('clamps a backdated start to local midnight', () => {
    const justAfterMidnight = new Date(2026, 6, 30, 0, 10, 0).getTime()
    const midnight = new Date(2026, 6, 30, 0, 0, 0).getTime()
    const stats = buildDayStats([
      { t: justAfterMidnight, speedKmh: 5, distanceM: 3000, elapsedSec: 3600 },
      { t: justAfterMidnight + 10_000, speedKmh: 5, distanceM: 3020, elapsedSec: 3610 },
    ])
    expect(stats.records[0]?.startedAt).toBe(midnight)
    expect(stats.records[0]?.durationSec).toBe(3610)
  })

  it('credits only the increment when the counters continue across a gap', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 5, distanceM: 3000, elapsedSec: 3000 }),
      at(10, { speedKmh: 5, distanceM: 3020, elapsedSec: 3010 }),
      at(70, { speedKmh: 5, distanceM: 3100, elapsedSec: 3070 }),
      at(80, { speedKmh: 5, distanceM: 3120, elapsedSec: 3080 }),
    ])
    expect(stats.records).toHaveLength(2)
    expect(stats.records[1]?.durationSec).toBe(70)
    expect(stats.records[1]?.distanceM).toBe(100)
    // No backdating: the console never restarted, so the second record begins when it was seen.
    expect(stats.records[1]?.startedAt).toBe(t0 + 70 * 1000)
  })

  it('keeps the sum of the records equal to the day totals', () => {
    const samples = [
      at(0, { speedKmh: 4, distanceM: 0, elapsedSec: 0, energyTotalKcal: 0 }),
      at(10, { speedKmh: 4, distanceM: 100, elapsedSec: 10, energyTotalKcal: 5 }),
      at(20, { speedKmh: 4, distanceM: 20, elapsedSec: 5, energyTotalKcal: 2 }),
      at(600, { speedKmh: 6, distanceM: 300, elapsedSec: 200, energyTotalKcal: 40 }),
      at(610, { speedKmh: 6, distanceM: 350, elapsedSec: 210, energyTotalKcal: 44 }),
    ]
    const stats = buildDayStats(samples)
    const sum = (pick: (record: (typeof stats.records)[number]) => number) =>
      stats.records.reduce((total, record) => total + pick(record), 0)
    expect(sum((record) => record.durationSec)).toBe(stats.totals.movingSec)
    expect(sum((record) => record.distanceM)).toBe(stats.totals.distanceM)
    expect(sum((record) => record.kcalConsole)).toBe(stats.totals.kcalConsole)
    expect(summarizeDay(samples)).toEqual({
      samples: stats.totals.samples,
      distanceM: stats.totals.distanceM,
      movingSec: stats.totals.movingSec,
      sessions: stats.totals.sessions,
    })
  })

  it('carries the last target the app set inside the record', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 4, elapsedSec: 0, targetSpeedKmh: 4 }),
      at(10, { speedKmh: 5, elapsedSec: 10, targetSpeedKmh: 6 }),
      at(20, { speedKmh: 6, elapsedSec: 20 }),
    ])
    expect(stats.records[0]?.targetSpeedKmh).toBe(6)
    expect(stats.records[0]?.targetInclinePercent).toBeUndefined()
  })

  it('integrates the calorie estimate over elapsed intervals only', () => {
    const oneSecond = buildDayStats([
      at(0, { speedKmh: 5, elapsedSec: 0 }),
      at(1, { speedKmh: 5, elapsedSec: 1 }),
    ])
    expect(oneSecond.records[0]?.kcalPerKg).toBeCloseTo(kcalPerKgPerSec(5, 0), 9)

    // The 600 s gap opens a new record and must not be integrated as if walking had continued:
    // the second record only carries the one second that elapsed inside it.
    const acrossGap = buildDayStats([
      at(0, { speedKmh: 5, elapsedSec: 0 }),
      at(1, { speedKmh: 5, elapsedSec: 1 }),
      at(601, { speedKmh: 5, elapsedSec: 11 }),
      at(602, { speedKmh: 5, elapsedSec: 12 }),
    ])
    expect(acrossGap.records).toHaveLength(2)
    expect(acrossGap.records[1]?.kcalPerKg).toBeCloseTo(kcalPerKgPerSec(5, 0), 9)
  })

  it('reports the observed speed and incline extremes', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 3, inclinePercent: 0, elapsedSec: 0 }),
      at(10, { speedKmh: 6, inclinePercent: 4, elapsedSec: 10 }),
      at(20, { speedKmh: 5, inclinePercent: 8, elapsedSec: 20 }),
    ])
    expect(stats.records[0]?.maxSpeedKmh).toBe(6)
    expect(stats.records[0]?.maxInclinePercent).toBe(8)
    expect(stats.records[0]?.avgInclinePercent).toBeCloseTo(6, 9)
  })
})
