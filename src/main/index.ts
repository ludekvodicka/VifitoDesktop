import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from './paths'
import { appendSamples } from './session-log'
import { readSettings, writeSettings } from './settings'
import { createStatsStore } from './stats-store'
import type { Sample } from '../shared/stats'
import { checkForUpdates, getUpdateState, installUpdate, startAutoUpdates } from './update'

/** Callback from the select-bluetooth-device event. Held until the user picks a device. */
let pickDevice: ((deviceId: string) => void) | null = null

const stats = createStatsStore(dataDir())

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    backgroundColor: '#0f1116',
    show: false,
    title: 'Vifito iR',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Without this handler navigator.bluetooth.requestDevice() in the renderer would never settle.
  // The event repeats as the scan finds more devices; the renderer draws the list itself.
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault()
    pickDevice = callback
    win.webContents.send('ble:devices', devices.map((d) => ({ deviceId: d.deviceId, deviceName: d.deviceName })))
  })

  win.on('closed', () => {
    pickDevice = null
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

ipcMain.on('ble:pick', (_event, deviceId: string) => {
  pickDevice?.(deviceId)
  pickDevice = null
})

// An empty string is the documented way to cancel the selection.
ipcMain.on('ble:cancel', () => {
  pickDevice?.('')
  pickDevice = null
})

ipcMain.handle('log:samples', async (_event, samples: Sample[]) => {
  // The raw log is written first and never waits for the derived stats. If the cache throws, the
  // samples are still on disk and the next rebuild repairs it.
  await appendSamples(dataDir(), samples)
  try {
    await stats.ingest(samples)
  } catch (error) {
    console.error('[stats] ingest failed, the cache will be rebuilt from the log:', error)
  }
})

ipcMain.handle('log:today', async () => stats.todaySummary())

ipcMain.handle('stats:get', async () => stats.overview())

// Kept for the console history investigation: the dump is the only record of what a console really
// exposes, and it has to survive the app being closed. Colons are not legal in a Windows file name.
ipcMain.handle('diag:save-gatt-dump', async (_event, dump: unknown) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const directory = join(dataDir(), 'diagnostics')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `gatt-dump-${stamp}.json`)
  await writeFile(path, `${JSON.stringify(dump, null, 2)}\n`, 'utf8')
  return path
})

ipcMain.handle('settings:get', async () => readSettings())

ipcMain.handle('settings:set', async (_event, settings: unknown) => writeSettings(settings))

ipcMain.handle('app:version', async () => app.getVersion())

ipcMain.handle('update:get', async () => getUpdateState())

ipcMain.handle('update:check', async () => checkForUpdates())

ipcMain.handle('update:install', async () => installUpdate())

void app.whenReady().then(() => {
  createWindow()
  startAutoUpdates()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
