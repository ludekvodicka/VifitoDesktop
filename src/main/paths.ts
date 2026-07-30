import { app } from 'electron'
import { join } from 'node:path'

/**
 * Installed builds write next to the app's own data, a build from source writes into the project so
 * the files stay where the developer can see them.
 */
export function dataDir(): string {
  return app.isPackaged ? join(app.getPath('userData'), 'data') : join(process.cwd(), 'data')
}
