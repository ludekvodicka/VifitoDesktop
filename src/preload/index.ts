import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings } from '../shared/settings'
import type { DaySummary, Sample, StatsOverview } from '../shared/stats'

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
}

export type VifitoApi = typeof api

contextBridge.exposeInMainWorld('vifito', api)
