import type { VifitoApi } from '../preload/index'

declare global {
  interface Window {
    vifito: VifitoApi
  }
}

export {}
