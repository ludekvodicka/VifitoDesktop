import { describe, expect, it } from 'vitest'
import { buildDayStats, type Sample } from './summary'

const t0 = Date.UTC(2026, 6, 30, 8, 0, 0)
const at = (sec: number, sample: Omit<Sample, 't'>): Sample => ({ t: t0 + sec * 1000, ...sample })

// The console counts on its own, so a connection can start mid-workout. These fixtures use the real
// numbers from 2026-07-30: the first frame arrived with 2623 s and 2960 m already on the counters.
describe('counters standing on the console at connect time', () => {
  it('credits them when the user claims the walk', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 5.1, distanceM: 2960, elapsedSec: 2623 }),
      at(10, { speedKmh: 5.1, distanceM: 2975, elapsedSec: 2633 }),
    ])
    expect(stats.records[0]?.distanceM).toBe(2975)
    expect(stats.records[0]?.durationSec).toBe(2633)
    expect(stats.records[0]?.startedAt).toBe(t0 - 2623 * 1000)
  })

  it('takes them as a starting point when the user declines them', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 5.1, distanceM: 2960, elapsedSec: 2623, counterBaseline: true }),
      at(10, { speedKmh: 5.1, distanceM: 2975, elapsedSec: 2633 }),
    ])
    expect(stats.records[0]?.distanceM).toBe(15)
    expect(stats.records[0]?.durationSec).toBe(10)
    // Nothing to backdate: the app is only crediting what it saw from here on.
    expect(stats.records[0]?.startedAt).toBe(t0)
  })

  it('keeps counting normally after the declined sample, resets included', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 5, distanceM: 2960, elapsedSec: 2623, counterBaseline: true }),
      at(10, { speedKmh: 5, distanceM: 3000, elapsedSec: 2633 }),
      at(20, { speedKmh: 5, distanceM: 50, elapsedSec: 20 }),
      at(30, { speedKmh: 5, distanceM: 90, elapsedSec: 30 }),
    ])
    expect(stats.records[0]?.distanceM).toBe(40 + 50 + 40)
    expect(stats.totals.distanceM).toBe(130)
  })

  it('leaves the day totals equal to the sum of the records either way', () => {
    for (const baseline of [undefined, true as const]) {
      const stats = buildDayStats([
        at(0, { speedKmh: 5, distanceM: 2960, elapsedSec: 2623, counterBaseline: baseline }),
        at(10, { speedKmh: 5, distanceM: 3000, elapsedSec: 2633 }),
      ])
      const sum = stats.records.reduce((total, record) => total + record.distanceM, 0)
      expect(sum).toBe(stats.totals.distanceM)
    }
  })

  it('ignores the marker when the sample carries no counters at all', () => {
    const stats = buildDayStats([
      at(0, { speedKmh: 5, counterBaseline: true }),
      at(10, { speedKmh: 5, distanceM: 40, elapsedSec: 10 }),
    ])
    // The first real values still seed the counters, so nothing is credited from before them.
    expect(stats.records[0]?.distanceM).toBe(40)
  })
})
