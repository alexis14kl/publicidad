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
    leadgenFormsLoaded?: boolean
    leadgenForms?: {
      id: string
      name: string
      status: string
      questions?: {
        key: string
        label: string
        type: string
      }[]
      requirements?: {
        hasEmail: boolean
        hasPhone: boolean
        hasFirstName: boolean
        hasLastName: boolean
        hasFullName: boolean
        exactMatch: boolean
        acceptableMatch: boolean
      }
      questionsError?: string
    }[]
    selectedLeadgenFormId?: string
    selectedLeadgenFormName?: string
    selectedLeadgenFormReason?: string
    imageAsset?: {
      sourcePath: string
      preparedPath: string
      fileName: string
      width: number
      height: number
      adjusted: boolean
      adjustmentReason: string
      status: string
    } | null
    creativeDraftConfig?: {
      pageId: string
      leadgenFormId: string
      imageAssetPath: string
      callToActionType: string
      objective: string
      message: string
      headline: string
      link: string
      callToActionValue: {
        lead_gen_form_id: string
      }
      objectStorySpec: {
        page_id: string
        link_data: {
          link: string
          message: string
          name: string
          call_to_action: {
            type: string
            value: {
              lead_gen_form_id: string
            }
          }
        }
      }
      adDraftStatus: string
    } | null
    adDraftConfig?: {
      adsetId: string
      adName: string
      status: string
      creativeStatus: string
      tracking: {
        leadgen_form_id: string
        page_id: string
      }
    } | null
    metaCreative?: {
      imageHash: string
      creativeId: string
      creativeName: string
    } | null
    metaAd?: {
      adId: string
      adName: string
    } | null
    browserMonitorUrl?: string
    orchestrator?: {
      plan: {
        task: string
        agent: string
        reason: string
        cost: string
        approvedByUser: boolean
      }
      adsAnalyst: {
        platform: string
        format: string
        objective: string
        audience: string
        hook: string
        copy: string
        cta: string
        visualReference: string
        assumptions: string[]
      }
      imageCreator: {
        dimensions: string
        style: string
        prompt: string
        status: string
      }
      marketing: {
        status: string
        verdict: string
        notes: string[]
      }
      execution: {
        accountHint: string
        pageId: string
        campaignType: string
        budgetCap: string
        formFields: string[]
      }
    } | null
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
