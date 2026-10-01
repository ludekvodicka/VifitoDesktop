import { kcalPerKgPerSec } from '../shared/calories'
import { accumulate, seed, type Counter } from '../shared/counters'
import type { DayStats, DaySummary, Sample, UseRecord } from '../shared/stats'

// Re-exported so the existing importers of these two types keep working unchanged.
export type { DaySummary, Sample }

/**
 * A longer gap between samples means the app or the console was away in the meantime. It is both the
 * session boundary of the daily summary and the boundary of one use record.
 */
const MAX_GAP_SEC = 30

function localMidnightOf(t: number): number {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

type Accumulator = {
  startedAt: number
  endedAt: number
  durationSec: number
  distanceM: number
  kcalConsole: number
  kcalPerKg: number
  maxSpeedKmh?: number
  inclineWeightedSec: number
  inclineSec: number
  maxInclinePercent?: number
  heartRateSum: number
  heartRateCount: number
  targetSpeedKmh?: number
  targetInclinePercent?: number
  samples: number
  /** Whether an elapsed credit already landed here; only the first one can backdate the start. */
  sawElapsed: boolean
}

export type DayStatsBuilder = {
  add: (sample: Sample) => void
  /** Pure snapshot, safe to call repeatedly while more samples keep arriving. */
  build: () => DayStats
}

export function createDayStatsBuilder(): DayStatsBuilder {
  const distance: Counter = { total: 0 }
  const elapsed: Counter = { total: 0 }
  const kcal: Counter = { total: 0 }
  const records: UseRecord[] = []
  let current: Accumulator | null = null
  let sessions = 0
  let samples = 0
  let previousT: number | undefined
  let day: string | null = null

  const finish = (accumulator: Accumulator | null): void => {
    if (!accumulator) return
    // A block with no console time and no distance is the app sitting connected next to a still
    // belt. It counts as a session for summarizeDay, but it is not a use of the machine.
    if (accumulator.durationSec === 0 && accumulator.distanceM === 0) return
    records.push({
      startedAt: accumulator.startedAt,
      endedAt: accumulator.endedAt,
      durationSec: accumulator.durationSec,
      distanceM: accumulator.distanceM,
      avgSpeedKmh:
        accumulator.durationSec > 0 ? (accumulator.distanceM / accumulator.durationSec) * 3.6 : 0,
      maxSpeedKmh: accumulator.maxSpeedKmh,
      avgInclinePercent:
        accumulator.inclineSec > 0 ? accumulator.inclineWeightedSec / accumulator.inclineSec : undefined,
      maxInclinePercent: accumulator.maxInclinePercent,
      kcalConsole: accumulator.kcalConsole,
      kcalPerKg: accumulator.kcalPerKg,
      avgHeartRateBpm:
        accumulator.heartRateCount > 0 ? accumulator.heartRateSum / accumulator.heartRateCount : undefined,
      targetSpeedKmh: accumulator.targetSpeedKmh,
      targetInclinePercent: accumulator.targetInclinePercent,
      samples: accumulator.samples,
    })
  }

  const add = (sample: Sample): void => {
    const gapSec = previousT === undefined ? Infinity : (sample.t - previousT) / 1000
    if (gapSec > MAX_GAP_SEC) {
      finish(current)
      sessions++
      current = {
        startedAt: sample.t,
        endedAt: sample.t,
        durationSec: 0,
        distanceM: 0,
        kcalConsole: 0,
        kcalPerKg: 0,
        inclineWeightedSec: 0,
        inclineSec: 0,
        heartRateSum: 0,
        heartRateCount: 0,
        samples: 0,
        sawElapsed: false,
      }
    }
    if (!current) throw new Error('Record accumulator missing after the boundary check')
    if (day === null) day = dayKeyOfSample(sample.t)

    const credit = sample.counterBaseline ? seed : accumulate
    const distanceCredit = credit(distance, sample.distanceM)
    const elapsedCredit = credit(elapsed, sample.elapsedSec)
    const kcalCredit = credit(kcal, sample.energyTotalKcal)
    current.distanceM += distanceCredit.delta
    current.durationSec += elapsedCredit.delta
    current.kcalConsole += kcalCredit.delta

    // A whole credit means the console had been counting before this record started watching, so the
    // workout really began earlier. Clamped to local midnight and to the previous record's end,
    // which keeps the records inside their day and non-overlapping.
    if (elapsedCredit.whole && !current.sawElapsed && elapsedCredit.delta > 0) {
      const floor = Math.max(localMidnightOf(sample.t), records.at(-1)?.endedAt ?? 0)
      current.startedAt = Math.max(floor, sample.t - elapsedCredit.delta * 1000)
    }
    if (elapsedCredit.delta > 0) current.sawElapsed = true

    if (sample.speedKmh !== undefined)
      current.maxSpeedKmh = Math.max(current.maxSpeedKmh ?? 0, sample.speedKmh)
    if (sample.inclinePercent !== undefined) {
      const weightSec = gapSec === Infinity || gapSec > MAX_GAP_SEC ? 0 : gapSec
      current.inclineWeightedSec += sample.inclinePercent * weightSec
      current.inclineSec += weightSec
      current.maxInclinePercent = Math.max(current.maxInclinePercent ?? 0, sample.inclinePercent)
    }
    // The console reports 0 rather than omitting the field when no hand pulse is detected.
    if (sample.heartRateBpm) {
      current.heartRateSum += sample.heartRateBpm
      current.heartRateCount++
    }
    if (sample.targetSpeedKmh !== undefined) current.targetSpeedKmh = sample.targetSpeedKmh
    if (sample.targetInclinePercent !== undefined) current.targetInclinePercent = sample.targetInclinePercent

    // Integrated over the interval that just elapsed, so a gap between records adds nothing.
    if (gapSec !== Infinity && gapSec <= MAX_GAP_SEC && sample.speedKmh !== undefined)
      current.kcalPerKg += kcalPerKgPerSec(sample.speedKmh, sample.inclinePercent ?? 0) * gapSec

    current.endedAt = sample.t
    current.samples++
    samples++
    previousT = sample.t
  }

  const build = (): DayStats => {
    const snapshot = records.slice()
    const pending = current
    if (pending) {
      // Snapshot the open record without closing it: more samples may still arrive.
      const closing = records.length
      finish(pending)
      snapshot.push(...records.slice(closing))
      records.length = closing
    }
    return {
      day: day ?? '',
      totals: {
        samples,
        distanceM: distance.total,
        movingSec: elapsed.total,
        sessions,
        kcalConsole: kcal.total,
        kcalPerKg: snapshot.reduce((sum, record) => sum + record.kcalPerKg, 0),
      },
      records: snapshot,
    }
  }

  return { add, build }
}

/** Local YYYY-MM-DD, the same key the sample log uses for its file names. */
function dayKeyOfSample(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function buildDayStats(samples: Sample[]): DayStats {
  const builder = createDayStatsBuilder()
  for (const sample of [...samples].sort((a, b) => a.t - b.t)) builder.add(sample)
  return builder.build()
}

export function summarizeDay(samples: Sample[]): DaySummary {
  const { totals } = buildDayStats(samples)
  return {
    samples: totals.samples,
    distanceM: totals.distanceM,
    movingSec: totals.movingSec,
    sessions: totals.sessions,
  }
}
