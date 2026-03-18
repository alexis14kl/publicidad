import type { ElectronAPI } from '../api/types'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
