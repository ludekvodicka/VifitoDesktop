import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeSettings, type AppSettings } from '../shared/settings'
import { dataDir } from './paths'

const settingsPath = () => join(dataDir(), 'settings.json')

export async function readSettings(): Promise<AppSettings> {
  try {
    return normalizeSettings(JSON.parse(await readFile(settingsPath(), 'utf8')))
  } catch {
    // Missing file on a first run, or one somebody hand-edited into invalid JSON. Either way the
    // defaults are a better answer than a dialog nobody can act on.
    return normalizeSettings(undefined)
  }
}

export async function writeSettings(value: unknown): Promise<AppSettings> {
  const settings = normalizeSettings(value)
  await mkdir(dataDir(), { recursive: true })
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  return settings
}
