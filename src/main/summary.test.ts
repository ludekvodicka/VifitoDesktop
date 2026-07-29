import { describe, expect, it } from 'vitest'
import { summarizeDay, type Sample } from './summary'

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
