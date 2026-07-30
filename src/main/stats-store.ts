import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DayStats, DaySummary, Sample, StatsOverview } from '../shared/stats'
import { dayKeyOf, listDays, readDayByKey } from './session-log'
import { createDayStatsBuilder, type DayStatsBuilder } from './summary'

/** Bumped whenever a stored record gains or changes a field; a mismatch rebuilds from the JSONL. */
export const STATS_SCHEMA_VERSION = 1

export type StatsStore = {
  /** Feed freshly flushed samples: update today's accumulator and rewrite today's stats file. */
  ingest: (samples: Sample[]) => Promise<void>
  /** Every day, newest first, rebuilding whatever is missing or stale. */
  overview: () => Promise<StatsOverview>
  /** Today from memory, which is what replaces re-parsing the whole day file on every flush. */
  todaySummary: () => Promise<DaySummary>
}

type StatsFile = { version: number; stats: DayStats }

const statsDir = (baseDir: string): string => join(baseDir, 'stats')

async function readStatsFile(baseDir: string, day: string): Promise<StatsFile | null> {
  try {
    const parsed = JSON.parse(await readFile(join(statsDir(baseDir), `${day}.json`), 'utf8')) as StatsFile
    return typeof parsed?.version === 'number' && parsed.stats ? parsed : null
  } catch {
    // Missing on the first run, or hand-edited into invalid JSON. Either way the day is rebuilt.
    return null
  }
}

async function writeStatsFile(baseDir: string, day: string, stats: DayStats): Promise<void> {
  await mkdir(statsDir(baseDir), { recursive: true })
  const payload: StatsFile = { version: STATS_SCHEMA_VERSION, stats }
  await writeFile(join(statsDir(baseDir), `${day}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

/**
 * The raw JSONL sample log stays the only source of truth. This is a derived cache: a per-day file
 * that is rebuilt whenever it is missing, stale or unreadable, which is also what makes the history
 * recorded before this feature appear without any migration step.
 */
export function createStatsStore(baseDir: string): StatsStore {
  const days = new Map<string, DayStats>()
  let todayBuilder: DayStatsBuilder | null = null
  let todayKey: string | null = null
  let loadedPastDays = false

  const loadDay = async (day: string): Promise<DayStats> => {
    const cached = await readStatsFile(baseDir, day)
    if (cached?.version === STATS_SCHEMA_VERSION) return cached.stats
    const rebuilt = buildDay(day, await readDayByKey(baseDir, day))
    await writeStatsFile(baseDir, day, rebuilt)
    return rebuilt
  }

  const buildDay = (day: string, samples: Sample[]): DayStats => {
    const builder = createDayStatsBuilder()
    for (const sample of [...samples].sort((a, b) => a.t - b.t)) builder.add(sample)
    return { ...builder.build(), day }
  }

  // Switching day finalizes the previous one to disk and starts a fresh accumulator, so a flush
  // that straddles midnight lands in two files instead of one.
  const openDay = async (key: string): Promise<void> => {
    if (todayKey === key && todayBuilder) return
    if (todayKey !== null) {
      const finished = days.get(todayKey)
      if (finished) await writeStatsFile(baseDir, todayKey, finished)
    }
    const builder = createDayStatsBuilder()
    // Replaying the day's own log is what recovers the records after a crash or a restart.
    for (const sample of await readDayByKey(baseDir, key)) builder.add(sample)
    todayKey = key
    todayBuilder = builder
    days.set(key, { ...builder.build(), day: key })
  }

  /**
   * Called after the samples are already appended to the JSONL, which is what makes the day switch
   * cheap: opening a day replays its file, so the batch's samples for that day are already in it and
   * must not be added a second time.
   */
  const ingest = async (samples: Sample[]): Promise<void> => {
    if (samples.length === 0) return
    const byDay = new Map<string, Sample[]>()
    for (const sample of [...samples].sort((a, b) => a.t - b.t)) {
      const key = dayKeyOf(sample.t)
      const bucket = byDay.get(key)
      if (bucket) bucket.push(sample)
      else byDay.set(key, [sample])
    }
    for (const [key, bucket] of [...byDay].sort(([left], [right]) => left.localeCompare(right))) {
      if (key === todayKey && todayBuilder) for (const sample of bucket) todayBuilder.add(sample)
      else await openDay(key)
      if (todayKey === null || !todayBuilder) continue
      const stats = { ...todayBuilder.build(), day: todayKey }
      days.set(todayKey, stats)
      await writeStatsFile(baseDir, todayKey, stats)
    }
  }

  const overview = async (): Promise<StatsOverview> => {
    if (!loadedPastDays) {
      for (const day of await listDays(baseDir)) if (!days.has(day)) days.set(day, await loadDay(day))
      loadedPastDays = true
    }
    await openDay(dayKeyOf(Date.now()))
    return { days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)) }
  }

  const todaySummary = async (): Promise<DaySummary> => {
    await openDay(dayKeyOf(Date.now()))
    const { totals } = days.get(todayKey ?? '') ?? { totals: undefined }
    return {
      samples: totals?.samples ?? 0,
      distanceM: totals?.distanceM ?? 0,
      movingSec: totals?.movingSec ?? 0,
      sessions: totals?.sessions ?? 0,
    }
  }

  return { ingest, overview, todaySummary }
}
