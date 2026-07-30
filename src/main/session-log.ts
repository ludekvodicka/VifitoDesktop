import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sample } from '../shared/stats'

/** Local YYYY-MM-DD. The log is bucketed by the day the user was walking, not by UTC. */
export function dayKeyOf(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// baseDir is a parameter rather than a call to dataDir() so this module stays free of electron and
// the tests can run it over a temp directory.
const sessionsDir = (baseDir: string): string => join(baseDir, 'sessions')
const fileFor = (baseDir: string, day: string): string => join(sessionsDir(baseDir), `${day}.jsonl`)

export async function appendSamples(baseDir: string, samples: Sample[]): Promise<void> {
  if (samples.length === 0) return
  const byDay = new Map<string, Sample[]>()
  for (const sample of samples) {
    const key = dayKeyOf(sample.t)
    const bucket = byDay.get(key)
    if (bucket) bucket.push(sample)
    else byDay.set(key, [sample])
  }
  await mkdir(sessionsDir(baseDir), { recursive: true })
  for (const [day, bucket] of byDay)
    await appendFile(fileFor(baseDir, day), bucket.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8')
}

export async function readDayByKey(baseDir: string, day: string): Promise<Sample[]> {
  let raw: string
  try {
    raw = await readFile(fileFor(baseDir, day), 'utf8')
  } catch {
    return []
  }
  const samples: Sample[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      samples.push(JSON.parse(line) as Sample)
    } catch {
      // the log is append-only, a torn last line is expected after a crash
    }
  }
  return samples
}

/** The days that have a sample file, oldest first. */
export async function listDays(baseDir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(sessionsDir(baseDir))
  } catch {
    return []
  }
  return entries
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => name.slice(0, -'.jsonl'.length))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    .sort()
}
