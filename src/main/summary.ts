export type Sample = {
  t: number
  speedKmh?: number
  distanceM?: number
  inclinePercent?: number
  elapsedSec?: number
  energyTotalKcal?: number
  heartRateBpm?: number
}

export type DaySummary = {
  samples: number
  /** Metres walked over the whole day. */
  distanceM: number
  /** Workout time over the whole day, as counted by the console. */
  movingSec: number
  sessions: number
}

/** A longer gap between samples means the app or the console was away in the meantime. */
const MAX_GAP_SEC = 30

type Counter = { total: number; last?: number }

/**
 * Console counters (distance, time, calories) grow during a workout and drop back to zero when a
 * new one starts. Increments are therefore taken against the last SEEN value, not against the
 * previous sample: the console does not send every field in every frame, so an absolute value
 * would otherwise be counted again and again. The first value seen on a given day is added whole,
 * because the workout was already running before the app connected; a drop counts as a new workout.
 */
function accumulate(counter: Counter, value: number | undefined): void {
  if (value === undefined) return
  if (counter.last === undefined || value < counter.last) counter.total += value
  else counter.total += value - counter.last
  counter.last = value
}

export function summarizeDay(samples: Sample[]): DaySummary {
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const distance: Counter = { total: 0 }
  const elapsed: Counter = { total: 0 }
  let sessions = 0
  let previousT: number | undefined

  for (const sample of sorted) {
    const gapSec = previousT === undefined ? Infinity : (sample.t - previousT) / 1000
    if (gapSec > MAX_GAP_SEC) sessions++
    accumulate(distance, sample.distanceM)
    accumulate(elapsed, sample.elapsedSec)
    previousT = sample.t
  }

  return { samples: sorted.length, distanceM: distance.total, movingSec: elapsed.total, sessions }
}
