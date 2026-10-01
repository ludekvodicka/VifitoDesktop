import { contextBridge, ipcRenderer } from 'electron'
import type { Plan, PlansSnapshot } from '../shared/plans'
import type { AppSettings } from '../shared/settings'
import type { DaySummary, Sample, StatsOverview } from '../shared/stats'
import { AutoUpdateBridge } from '../../shared/electron/autoUpdate/preload/autoUpdateBridge'

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
  getPlans(): Promise<PlansSnapshot> {
    return ipcRenderer.invoke('plans:list')
  },
  savePlan(plan: Plan): Promise<Plan[]> {
    return ipcRenderer.invoke('plans:upsert', plan)
  },
  deletePlan(id: string): Promise<Plan[]> {
    return ipcRenderer.invoke('plans:remove', id)
  },
  getVersion(): Promise<string> {
    return ipcRenderer.invoke('app:version')
  },
  autoUpdate: AutoUpdateBridge.create(ipcRenderer),
}

export type VifitoApi = typeof api

contextBridge.exposeInMainWorld('vifito', api)
