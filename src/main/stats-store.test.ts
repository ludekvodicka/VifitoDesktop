import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Sample } from '../shared/stats'
import { createStatsStore, STATS_SCHEMA_VERSION } from './stats-store'
import { summarizeDay } from './summary'

let baseDir: string

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'vifito-stats-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

const todayKey = (): string => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Samples at a wall-clock offset from local midnight, so they land in the day the store expects. */
const atLocal = (day: string, hour: number, sec: number, sample: Omit<Sample, 't'>): Sample => {
  const [year, month, date] = day.split('-').map(Number)
  return { t: new Date(year!, month! - 1, date!, hour, 0, sec).getTime(), ...sample }
}

const writeLog = async (day: string, samples: Sample[]): Promise<void> => {
  await mkdir(join(baseDir, 'sessions'), { recursive: true })
  await writeFile(join(baseDir, 'sessions', `${day}.jsonl`), samples.map((s) => JSON.stringify(s)).join('\n') + '\n')
}

const readStatsFile = async (day: string): Promise<{ version: number; stats: { totals: { distanceM: number } } }> =>
  JSON.parse(await readFile(join(baseDir, 'stats', `${day}.json`), 'utf8'))

describe('createStatsStore', () => {
  it('rebuilds a day that has no stats file yet and writes the cache', async () => {
    const day = '2026-07-20'
    const samples = [
      atLocal(day, 9, 0, { speedKmh: 4, distanceM: 0, elapsedSec: 0 }),
      atLocal(day, 9, 10, { speedKmh: 4, distanceM: 200, elapsedSec: 10 }),
    ]
    await writeLog(day, samples)

    const overview = await createStatsStore(baseDir).overview()
    const rebuilt = overview.days.find((entry) => entry.day === day)
    expect(rebuilt?.totals.distanceM).toBe(200)
    expect(rebuilt?.records).toHaveLength(1)
    expect((await readStatsFile(day)).version).toBe(STATS_SCHEMA_VERSION)
  })

  it('rebuilds when the stored version does not match', async () => {
    const day = '2026-07-21'
    await writeLog(day, [
      atLocal(day, 8, 0, { speedKmh: 5, distanceM: 0, elapsedSec: 0 }),
      atLocal(day, 8, 10, { speedKmh: 5, distanceM: 500, elapsedSec: 10 }),
    ])
    await mkdir(join(baseDir, 'stats'), { recursive: true })
    await writeFile(
      join(baseDir, 'stats', `${day}.json`),
      JSON.stringify({ version: 0, stats: { day, totals: { distanceM: 1 }, records: [] } }),
    )

    const overview = await createStatsStore(baseDir).overview()
    expect(overview.days.find((entry) => entry.day === day)?.totals.distanceM).toBe(500)
    expect((await readStatsFile(day)).version).toBe(STATS_SCHEMA_VERSION)
  })

  it('rebuilds an unreadable stats file instead of failing', async () => {
    const day = '2026-07-22'
    await writeLog(day, [
      atLocal(day, 8, 0, { speedKmh: 5, distanceM: 0, elapsedSec: 0 }),
      atLocal(day, 8, 10, { speedKmh: 5, distanceM: 300, elapsedSec: 10 }),
    ])
    await mkdir(join(baseDir, 'stats'), { recursive: true })
    await writeFile(join(baseDir, 'stats', `${day}.json`), '{ not json')

    const overview = await createStatsStore(baseDir).overview()
    expect(overview.days.find((entry) => entry.day === day)?.totals.distanceM).toBe(300)
  })

  it('trusts a current stats file over the raw log, which is the point of a cache', async () => {
    const day = '2026-07-23'
    await writeLog(day, [atLocal(day, 8, 0, { speedKmh: 5, distanceM: 999, elapsedSec: 10 })])
    await mkdir(join(baseDir, 'stats'), { recursive: true })
    await writeFile(
      join(baseDir, 'stats', `${day}.json`),
      JSON.stringify({
        version: STATS_SCHEMA_VERSION,
        stats: { day, totals: { samples: 0, distanceM: 42, movingSec: 0, sessions: 0, kcalConsole: 0, kcalPerKg: 0 }, records: [] },
      }),
    )

    const overview = await createStatsStore(baseDir).overview()
    expect(overview.days.find((entry) => entry.day === day)?.totals.distanceM).toBe(42)
  })

  it('answers todaySummary from memory and agrees with summarizeDay', async () => {
    const day = todayKey()
    const samples = [
      atLocal(day, 6, 0, { speedKmh: 4, distanceM: 0, elapsedSec: 0 }),
      atLocal(day, 6, 10, { speedKmh: 4, distanceM: 100, elapsedSec: 10 }),
      atLocal(day, 6, 20, { speedKmh: 4, distanceM: 250, elapsedSec: 20 }),
    ]
    await writeLog(day, samples)

    const store = createStatsStore(baseDir)
    expect(await store.todaySummary()).toEqual(summarizeDay(samples))
  })

  it('adds flushed samples to today without re-reading the whole log', async () => {
    const day = todayKey()
    const first = [
      atLocal(day, 7, 0, { speedKmh: 4, distanceM: 0, elapsedSec: 0 }),
      atLocal(day, 7, 10, { speedKmh: 4, distanceM: 100, elapsedSec: 10 }),
    ]
    const second = [atLocal(day, 7, 20, { speedKmh: 4, distanceM: 200, elapsedSec: 20 })]

    // The handler appends to the log before it ingests, and this order is what the store relies on.
    const store = createStatsStore(baseDir)
    await writeLog(day, first)
    await store.ingest(first)
    await writeLog(day, [...first, ...second])
    await store.ingest(second)

    const summary = await store.todaySummary()
    expect(summary).toEqual(summarizeDay([...first, ...second]))
    expect((await readStatsFile(day)).stats.totals.distanceM).toBe(200)
  })

  it('picks a first batch up from the log, which is where the handler already put it', async () => {
    const day = todayKey()
    const samples = [
      atLocal(day, 4, 0, { speedKmh: 4, distanceM: 0, elapsedSec: 0 }),
      atLocal(day, 4, 10, { speedKmh: 4, distanceM: 700, elapsedSec: 10 }),
    ]
    await writeLog(day, samples)

    const store = createStatsStore(baseDir)
    await store.ingest(samples)

    // Counted once, not twice: opening the day replays the file instead of adding the batch again.
    expect(await store.todaySummary()).toEqual(summarizeDay(samples))
  })

  it('splits a batch that crosses midnight into two stats files', async () => {
    const yesterday = '2026-07-24'
    const today = '2026-07-25'
    const late = atLocal(yesterday, 23, 50, { speedKmh: 4, distanceM: 0, elapsedSec: 0 })
    const lateSecond = { ...late, t: late.t + 5_000, distanceM: 100, elapsedSec: 5 }
    const early = atLocal(today, 0, 10, { speedKmh: 4, distanceM: 150, elapsedSec: 10 })

    // The raw log is written first, exactly as the IPC handler does it.
    await writeLog(yesterday, [late, lateSecond])
    await writeLog(today, [early])

    const store = createStatsStore(baseDir)
    await store.ingest([late, lateSecond, early])

    expect((await readStatsFile(yesterday)).stats.totals.distanceM).toBe(100)
    expect((await readStatsFile(today)).stats.totals.distanceM).toBe(150)
  })

  it('recovers today from the log after a restart, torn last line included', async () => {
    const day = todayKey()
    const samples = [
      atLocal(day, 5, 0, { speedKmh: 4, distanceM: 0, elapsedSec: 0 }),
      atLocal(day, 5, 10, { speedKmh: 4, distanceM: 400, elapsedSec: 10 }),
    ]
    await mkdir(join(baseDir, 'sessions'), { recursive: true })
    await writeFile(
      join(baseDir, 'sessions', `${day}.jsonl`),
      samples.map((s) => JSON.stringify(s)).join('\n') + '\n{"t":123,"spe',
    )

    const store = createStatsStore(baseDir)
    expect((await store.todaySummary()).distanceM).toBe(400)
  })

  it('returns the days newest first and copes with no data at all', async () => {
    const empty = await createStatsStore(baseDir).overview()
    // Today is always present as an open day, even before anything was walked.
    expect(empty.days.every((entry) => entry.records.length === 0)).toBe(true)

    await writeLog('2026-07-10', [atLocal('2026-07-10', 8, 0, { distanceM: 10, elapsedSec: 5 })])
    await writeLog('2026-07-12', [atLocal('2026-07-12', 8, 0, { distanceM: 20, elapsedSec: 5 })])
    const overview = await createStatsStore(baseDir).overview()
    const listed = overview.days.map((entry) => entry.day)
    expect(listed.indexOf('2026-07-12')).toBeLessThan(listed.indexOf('2026-07-10'))
  })
})
