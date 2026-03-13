import type {
  BotStatus,
  LastJob,
  CommandResult,
  CompanyPlatform,
  CompanyRecord,
  SaveCompanyPayload,
  StartBotPayload,
  StartPollerPayload,
  MarketingCampaignPayload,
  MarketingRunUpdate,
} from './types'

const api = () => window.electronAPI

export const getBotStatus = (): Promise<BotStatus> => api().getBotStatus()
export const getLastJob = (): Promise<LastJob | null> => api().getLastJob()
export const startBot = (payload?: StartBotPayload): Promise<CommandResult> => api().startBot(payload)
export const stopBot = (): Promise<CommandResult> => api().stopBot()
export const startPoller = (payload?: StartPollerPayload): Promise<CommandResult> => api().startPoller(payload)
export const stopPoller = (): Promise<CommandResult> => api().stopPoller()
export const isPollerRunning = (): Promise<boolean> => api().isPollerRunning()
export const runMarketingCampaignPreview = (payload: MarketingCampaignPayload): Promise<CommandResult> =>
  api().runMarketingCampaignPreview(payload)
export const readLogLines = (count?: number): Promise<string[]> => api().readLogLines(count)
export const getEnvConfig = (): Promise<Record<string, string>> => api().getEnvConfig()
export const saveEnvConfig = (config: Record<string, string>) => api().saveEnvConfig(config)
export const listCompanyRecords = (platform: CompanyPlatform): Promise<CompanyRecord[]> => api().listCompanyRecords(platform)
export const saveCompanyRecord = (payload: SaveCompanyPayload): Promise<CompanyRecord> => api().saveCompanyRecord(payload)
export const resetBotState = () => api().resetBotState()
export const onLogNewLines = (cb: (lines: string[]) => void) => api().onLogNewLines(cb)
export const onBotLogLines = (cb: (lines: string[]) => void) => api().onBotLogLines(cb)
export const onMarketingRunUpdate = (cb: (update: MarketingRunUpdate) => void) => api().onMarketingRunUpdate(cb)
