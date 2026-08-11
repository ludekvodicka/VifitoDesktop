import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings } from '../shared/settings'
import type { DaySummary, Sample, StatsOverview } from '../shared/stats'
import type { UpdateState } from '../shared/update'

export type ScannedDevice = { deviceId: string; deviceName: string }

const api = {
  onDevices(callback: (devices: ScannedDevice[]) => void): () => void {
    const handler = (_event: unknown, devices: ScannedDevice[]) => callback(devices)
    ipcRenderer.on('ble:devices', handler)
    return () => {
      ipcRenderer.off('ble:devices', handler)
    }
  },
  pick(deviceId: string): void {
    ipcRenderer.send('ble:pick', deviceId)
  },
  cancel(): void {
    ipcRenderer.send('ble:cancel')
  },
  logSamples(samples: Sample[]): Promise<void> {
    return ipcRenderer.invoke('log:samples', samples)
  },
  today(): Promise<DaySummary> {
    return ipcRenderer.invoke('log:today')
  },
  getStats(): Promise<StatsOverview> {
    return ipcRenderer.invoke('stats:get')
  },
  /** Writes the current GATT dump under data/diagnostics and resolves to the file path. */
  saveGattDump(dump: unknown): Promise<string> {
    return ipcRenderer.invoke('diag:save-gatt-dump', dump)
  },
  getSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke('settings:get')
  },
  /** Returns what was actually stored, which is the normalized version of what was sent. */
  saveSettings(settings: AppSettings): Promise<AppSettings> {
    return ipcRenderer.invoke('settings:set', settings)
  },
  getVersion(): Promise<string> {
    return ipcRenderer.invoke('app:version')
  },
  /** The state as the main process knows it now, for a renderer that mounted after the check. */
  getUpdateState(): Promise<UpdateState> {
    return ipcRenderer.invoke('update:get')
  },
  onUpdateState(callback: (state: UpdateState) => void): () => void {
    const handler = (_event: unknown, state: UpdateState) => callback(state)
    ipcRenderer.on('update:state', handler)
    return () => {
      ipcRenderer.off('update:state', handler)
    }
  },
  checkForUpdate(): Promise<void> {
    return ipcRenderer.invoke('update:check')
  },
  /** Quits and installs what was downloaded. Nothing happens unless an update is ready. */
  installUpdate(): Promise<void> {
    return ipcRenderer.invoke('update:install')
  },
}

export type VifitoApi = typeof api

contextBridge.exposeInMainWorld('vifito', api)
