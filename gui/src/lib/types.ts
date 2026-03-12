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

export interface MarketingCampaignPayload {
  budget: string
  startDate: string
  endDate: string
}

export interface MarketingRunUpdate {
  type: 'status' | 'log' | 'done'
  status?: 'idle' | 'running' | 'success' | 'warning' | 'error'
  line?: string
  summary?: string
  preview?: {
    objective: string
    url: string
    country: string
    formFields: string[]
    budget: string
    startDate: string
    endDate: string
    mcpAvailable: boolean
    process?: {
      id: string
      title: string
      detail: string
      status: 'pending' | 'running' | 'success' | 'warning' | 'error'
    }[]
  }
}

export interface ElectronAPI {
  getBotStatus: () => Promise<BotStatus>
  getLastJob: () => Promise<LastJob | null>
  startBot: (profileName?: string) => Promise<CommandResult>
  stopBot: () => Promise<CommandResult>
  startPoller: () => Promise<CommandResult>
  stopPoller: () => Promise<CommandResult>
  isPollerRunning: () => Promise<boolean>
  runMarketingCampaignPreview: (payload: MarketingCampaignPayload) => Promise<CommandResult>
  readLogLines: (count?: number) => Promise<string[]>
  getEnvConfig: () => Promise<Record<string, string>>
  saveEnvConfig: (config: Record<string, string>) => Promise<CommandResult>
  resetBotState: () => Promise<{ success: boolean; deleted: string[] }>
  onLogNewLines: (callback: (lines: string[]) => void) => () => void
  onBotLogLines: (callback: (lines: string[]) => void) => () => void
  onMarketingRunUpdate: (callback: (update: MarketingRunUpdate) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
