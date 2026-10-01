import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizePlan, normalizePlans, PLANS_FILE_VERSION, type Plan, type PlansFile, type PlansSnapshot } from '../shared/plans'

export type PlansStore = {
  list: () => Promise<PlansSnapshot>
  upsert: (plan: unknown) => Promise<Plan[]>
  remove: (id: unknown) => Promise<Plan[]>
}

function parsePlansFile(text: string): { plans: unknown[] } | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    if (!('plans' in parsed) || !Array.isArray(parsed.plans)) return null
    return { plans: parsed.plans }
  } catch {
    return null
  }
}

export function createPlansStore(baseDir: string): PlansStore {
  const file = join(baseDir, 'plans.json')
  let snapshot: PlansSnapshot | null = null
  let queue: Promise<unknown> = Promise.resolve()

  // Serializing reads too prevents a first load from racing with another call's quarantine or save.
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  const load = async (): Promise<PlansSnapshot> => {
    if (snapshot) return snapshot
    const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    const parsed = text === null ? { plans: [] } : parsePlansFile(text)
    if (parsed) return (snapshot = { plans: normalizePlans(parsed.plans), recoveredFrom: null })

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const aside = join(baseDir, `plans.corrupt-${stamp}.json`)
    await rename(file, aside)
    return (snapshot = { plans: [], recoveredFrom: aside })
  }

  const store = async (plans: Plan[]): Promise<Plan[]> => {
    await mkdir(baseDir, { recursive: true })
    const payload: PlansFile = { version: PLANS_FILE_VERSION, plans }
    await writeFile(`${file}.tmp`, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    // Until the rename succeeds, both the file and the cached snapshot keep the previous list.
    await rename(`${file}.tmp`, file)
    snapshot = { plans, recoveredFrom: snapshot?.recoveredFrom ?? null }
    return plans
  }

  return {
    list: () => serial(load),
    upsert: (value) =>
      serial(async () => {
        const plan = normalizePlan(value)
        if (!plan) throw new Error('Not a plan')
        const { plans } = await load()
        const known = plans.some((p) => p.id === plan.id)
        return store(known ? plans.map((p) => (p.id === plan.id ? plan : p)) : [...plans, plan])
      }),
    remove: (id) => serial(async () => store((await load()).plans.filter((p) => p.id !== id))),
  }
}
