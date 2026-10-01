import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plan } from '../shared/plans'
import { createPlansStore } from './plans-store'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, readFile: vi.fn(fs.readFile), rename: vi.fn(fs.rename) }
})

let baseDir: string
let file: string

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'vifito-plans-'))
  file = join(baseDir, 'plans.json')
})

afterEach(async () => {
  vi.resetAllMocks()
  await rm(baseDir, { recursive: true, force: true })
})

const plan = (id: string): Plan => ({
  id,
  name: `Plan ${id}`,
  color: 'blue',
  phases: [{ id: `${id}-phase`, name: '', speedKmh: 3, inclinePercent: 2, durationSec: 60 }],
})

describe('createPlansStore', () => {
  it('returns an empty snapshot for a missing file without creating it', async () => {
    expect(await createPlansStore(baseDir).list()).toEqual({ plans: [], recoveredFrom: null })
    expect(await readdir(baseDir)).toEqual([])
  })

  it('creates a missing data directory only when saving', async () => {
    const directory = join(baseDir, 'data')
    const store = createPlansStore(directory)
    expect(await store.list()).toEqual({ plans: [], recoveredFrom: null })
    expect(await readdir(baseDir)).toEqual([])

    await store.upsert(plan('a'))

    expect(JSON.parse(await readFile(join(directory, 'plans.json'), 'utf8'))).toEqual({ version: 1, plans: [plan('a')] })
    expect(await readdir(directory)).toEqual(['plans.json'])
  })

  it('normalizes a save, appends a new id and replaces an existing id in place', async () => {
    const store = createPlansStore(baseDir)
    const first = plan('a')
    const normalized = { ...first, phases: [{ ...first.phases[0], speedKmh: 30 }] }
    const saved = await store.upsert({ ...first, name: `  ${first.name}  `, phases: [{ ...first.phases[0], speedKmh: 99 }] })
    expect(saved).toEqual([normalized])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, plans: [normalized] })

    expect(await store.upsert(plan('b'))).toEqual([normalized, plan('b')])
    const edited = { ...normalized, name: 'Edited' }
    expect(await store.upsert(edited)).toEqual([edited, plan('b')])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, plans: [edited, plan('b')] })
    expect(await createPlansStore(baseDir).list()).toEqual({ plans: [edited, plan('b')], recoveredFrom: null })
    expect(await readdir(baseDir)).toEqual(['plans.json'])
  })

  it('normalizes plans read from disk without rewriting a valid file', async () => {
    const first = plan('a')
    const text = JSON.stringify({ plans: [null, { ...first, phases: [{ ...first.phases[0], speedKmh: 99 }] }] })
    await writeFile(file, text)

    expect(await createPlansStore(baseDir).list()).toEqual({
      plans: [{ ...first, phases: [{ ...first.phases[0], speedKmh: 30 }] }],
      recoveredFrom: null,
    })
    expect(await readFile(file, 'utf8')).toBe(text)
  })

  it('persists removal across a restart', async () => {
    const store = createPlansStore(baseDir)
    await store.upsert(plan('a'))
    await store.upsert(plan('b'))

    const remaining = await store.remove('a')

    expect(remaining).toEqual([plan('b')])
    expect(await createPlansStore(baseDir).list()).toEqual({ plans: remaining, recoveredFrom: null })
    expect(await readdir(baseDir)).toEqual(['plans.json'])
  })

  it('rewrites the unchanged list when removing an unknown id', async () => {
    const text = JSON.stringify({ plans: [plan('a')] })
    await writeFile(file, text)
    const store = createPlansStore(baseDir)

    expect(await store.remove('unknown')).toEqual([plan('a')])
    expect(await readFile(file, 'utf8')).not.toBe(text)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, plans: [plan('a')] })
  })

  it.each(['{ invalid JSON\r\n', '{"plans": 5}', '[]', 'null', '{}'])(
    'quarantines corrupt content %j and preserves its bytes through the next save',
    async (text) => {
      const bytes = Buffer.from(text)
      await writeFile(file, bytes)
      const store = createPlansStore(baseDir)

      const snapshot = await store.list()

      expect(snapshot.plans).toEqual([])
      expect(snapshot.recoveredFrom).toMatch(/plans\.corrupt-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/)
      const [quarantined] = await readdir(baseDir)
      expect(snapshot.recoveredFrom).toBe(join(baseDir, quarantined))
      expect(await readFile(snapshot.recoveredFrom!)).toEqual(bytes)
      await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })

      expect(await store.upsert(plan('a'))).toEqual([plan('a')])
      expect(await store.list()).toEqual({ plans: [plan('a')], recoveredFrom: snapshot.recoveredFrom })
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, plans: [plan('a')] })
      expect(await readFile(snapshot.recoveredFrom!)).toEqual(bytes)
      expect((await readdir(baseDir)).sort()).toEqual([quarantined, 'plans.json'].sort())
    },
  )

  it('keeps both plans when two saves start without awaiting', async () => {
    const store = createPlansStore(baseDir)
    const first = store.upsert(plan('a'))
    const second = store.upsert(plan('b'))
    const listed = store.list()

    expect(await first).toEqual([plan('a')])
    expect(await second).toEqual([plan('a'), plan('b')])
    expect(await listed).toEqual({ plans: [plan('a'), plan('b')], recoveredFrom: null })
    expect(await createPlansStore(baseDir).list()).toEqual(await listed)
    expect(await readdir(baseDir)).toEqual(['plans.json'])
  })

  it('serializes a removal between saves without losing the later plan', async () => {
    const store = createPlansStore(baseDir)
    const operations = [store.upsert(plan('a')), store.remove('a'), store.upsert(plan('b'))]

    expect(await Promise.all(operations)).toEqual([[plan('a')], [], [plan('b')]])
    expect(await createPlansStore(baseDir).list()).toEqual({ plans: [plan('b')], recoveredFrom: null })
  })

  it.each([null, undefined, 42, 'plan', [], true])('rejects a non-object payload %j without writing', async (value) => {
    const store = createPlansStore(baseDir)

    await expect(store.upsert(value)).rejects.toThrow('Not a plan')
    expect(await readdir(baseDir)).toEqual([])
    expect(await store.upsert(plan('a'))).toEqual([plan('a')])
  })

  it('propagates read errors for every operation without overwriting or quarantining the file', async () => {
    const bytes = Buffer.from(JSON.stringify({ version: 1, plans: [plan('a')] }))
    await writeFile(file, bytes)
    const store = createPlansStore(baseDir)
    const error = Object.assign(new Error('Permission denied'), { code: 'EACCES' })
    const operations = [() => store.list(), () => store.upsert(plan('b')), () => store.upsert(plan('c')), () => store.remove('a')]

    for (const operation of operations) {
      vi.mocked(readFile).mockRejectedValueOnce(error)
      await expect(operation()).rejects.toBe(error)
      expect(await readFile(file)).toEqual(bytes)
      expect(await readdir(baseDir)).toEqual(['plans.json'])
    }

    expect(await store.upsert(plan('b'))).toEqual([plan('a'), plan('b')])
  })

  it('keeps corrupt content in place when quarantine fails and retries before saving', async () => {
    const text = '{ invalid JSON'
    await writeFile(file, text)
    const store = createPlansStore(baseDir)
    const error = Object.assign(new Error('Rename denied'), { code: 'EPERM' })
    vi.mocked(rename).mockRejectedValueOnce(error)

    await expect(store.upsert(plan('a'))).rejects.toBe(error)
    expect(await readFile(file, 'utf8')).toBe(text)
    expect(await readdir(baseDir)).toEqual(['plans.json'])

    await store.upsert(plan('b'))
    const snapshot = await store.list()
    expect(snapshot.plans).toEqual([plan('b')])
    expect(await readFile(snapshot.recoveredFrom!, 'utf8')).toBe(text)
  })

  it('keeps the file and snapshot unchanged when the atomic rename fails, then accepts a retry', async () => {
    const store = createPlansStore(baseDir)
    await store.upsert(plan('a'))
    const bytes = await readFile(file)
    const error = Object.assign(new Error('File is in use'), { code: 'EPERM' })
    vi.mocked(rename).mockRejectedValueOnce(error)

    await expect(store.upsert(plan('b'))).rejects.toBe(error)

    expect(await readFile(file)).toEqual(bytes)
    expect(await store.list()).toEqual({ plans: [plan('a')], recoveredFrom: null })
    expect(await createPlansStore(baseDir).list()).toEqual(await store.list())
    expect(await store.upsert(plan('c'))).toEqual([plan('a'), plan('c')])
    expect(await createPlansStore(baseDir).list()).toEqual(await store.list())
    expect(await readdir(baseDir)).toEqual(['plans.json'])
  })

  it('ignores a torn temporary write on restart and replaces it on the next save', async () => {
    await createPlansStore(baseDir).upsert(plan('a'))
    await writeFile(`${file}.tmp`, '{"version":1,"plans":[')
    const store = createPlansStore(baseDir)

    expect(await store.list()).toEqual({ plans: [plan('a')], recoveredFrom: null })
    expect(await store.upsert(plan('b'))).toEqual([plan('a'), plan('b')])
    expect(await createPlansStore(baseDir).list()).toEqual(await store.list())
    expect(await readdir(baseDir)).toEqual(['plans.json'])
  })
})
