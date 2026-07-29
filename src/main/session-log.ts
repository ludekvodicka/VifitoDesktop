import { app } from 'electron'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { summarizeDay, type DaySummary, type Sample } from './summary'

const dataDir = () => (app.isPackaged ? join(app.getPath('userData'), 'data') : join(process.cwd(), 'data'))

function dayKey(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fileFor(t: number): string {
  return join(dataDir(), 'sessions', `${dayKey(t)}.jsonl`)
}

export async function appendSamples(samples: Sample[]): Promise<void> {
  if (samples.length === 0) return
  const byDay = new Map<string, Sample[]>()
  for (const sample of samples) {
    const key = dayKey(sample.t)
    const bucket = byDay.get(key)
    if (bucket) bucket.push(sample)
    else byDay.set(key, [sample])
  }
  await mkdir(join(dataDir(), 'sessions'), { recursive: true })
  for (const bucket of byDay.values()) {
    const first = bucket[0]
    if (!first) continue
    await appendFile(fileFor(first.t), bucket.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8')
  }
}

export async function readDay(t: number): Promise<Sample[]> {
  let raw: string
  try {
    raw = await readFile(fileFor(t), 'utf8')
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

export async function todaySummary(): Promise<DaySummary> {
  return summarizeDay(await readDay(Date.now()))
}
