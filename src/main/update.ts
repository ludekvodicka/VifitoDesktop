import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/update'

const { autoUpdater } = electronUpdater

let state: UpdateState = { kind: 'disabled' }
/** `download-progress` carries no version, so the one announced by `update-available` is kept here. */
let pendingVersion = ''

// Broadcast rather than hold a window: the renderer can be reloaded, and macOS builds a second
// window from the activate handler. Both then get the state without anybody re-wiring the updater.
function setState(next: UpdateState): void {
  state = next
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('update:state', next)
}

export function getUpdateState(): UpdateState {
  return state
}

/**
 * Best effort check against the GitHub Releases feed: it downloads in the background and installs
 * on quit. Every failure is expected traffic here (no network, no release published yet, unsigned
 * macOS build) and must not take the app down with it.
 */
export function startAutoUpdates(): void {
  if (!app.isPackaged) return
  autoUpdater.logger = {
    info: (message?: unknown) => console.info('[updater]', message),
    warn: (message?: unknown) => console.warn('[updater]', message),
    error: (message?: unknown) => console.error('[updater]', message),
    debug: () => {},
  }
  autoUpdater.on('checking-for-update', () => setState({ kind: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version
    setState({ kind: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => setState({ kind: 'current' }))
  autoUpdater.on('download-progress', (progress) =>
    setState({ kind: 'downloading', version: pendingVersion, percent: progress.percent }),
  )
  autoUpdater.on('update-downloaded', (info) => setState({ kind: 'downloaded', version: info.version }))
  autoUpdater.on('error', (error) => setState({ kind: 'failed', message: error.message }))
  setState({ kind: 'checking' })
  checkForUpdates()
}

export function checkForUpdates(): void {
  if (!app.isPackaged) return
  // The status comes from the events above. A rejection here is the same failure the error event
  // already turned into a state, so it only needs the log.
  void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => console.warn('[updater]', error))
}

export function installUpdate(): void {
  if (state.kind !== 'downloaded') return
  autoUpdater.quitAndInstall()
}
