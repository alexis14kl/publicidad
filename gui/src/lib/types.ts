export interface BotStatus {
  status: 'online' | 'offline' | 'executing'
  action: string | null
  started_at: number | null
  host: string | null
  pid: number | null
}

export interface LastJob {
  last_job_id: string
  last_action: string
  last_status: string
  queue_mode: string
  updated_at: number
}

export interface CommandResult {
  success: boolean
  error?: string
  pid?: number
}

export interface ElectronAPI {
  getBotStatus: () => Promise<BotStatus>
  getLastJob: () => Promise<LastJob | null>
  startBot: (profileName?: string) => Promise<CommandResult>
  stopBot: () => Promise<CommandResult>
  startPoller: () => Promise<CommandResult>
  stopPoller: () => Promise<CommandResult>
  isPollerRunning: () => Promise<boolean>
  readLogLines: (count?: number) => Promise<string[]>
  getEnvConfig: () => Promise<Record<string, string>>
  onLogNewLines: (callback: (lines: string[]) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
