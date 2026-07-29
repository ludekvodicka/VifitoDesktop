import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { appendSamples, todaySummary } from './session-log'
import type { Sample } from './summary'
import { startAutoUpdates } from './update'

/** Callback from the select-bluetooth-device event. Held until the user picks a device. */
let pickDevice: ((deviceId: string) => void) | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    backgroundColor: '#0f1116',
    show: false,
    title: 'Vifito Rio 45 iR',
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
  await appendSamples(samples)
})

ipcMain.handle('log:today', async () => todaySummary())

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
