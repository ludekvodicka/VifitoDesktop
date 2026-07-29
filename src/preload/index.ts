import { contextBridge, ipcRenderer } from 'electron'

export type ScannedDevice = { deviceId: string; deviceName: string }
export type Sample = {
  t: number
  speedKmh?: number
  distanceM?: number
  inclinePercent?: number
  elapsedSec?: number
  energyTotalKcal?: number
  heartRateBpm?: number
}
export type DaySummary = { samples: number; distanceM: number; movingSec: number; sessions: number }

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
}

export type VifitoApi = typeof api

contextBridge.exposeInMainWorld('vifito', api)
