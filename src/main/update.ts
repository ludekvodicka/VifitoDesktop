import { app } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

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
  autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => console.warn('[updater]', error))
}
