import type {
  AnalyzeImageServicesPayload,
  AnalyzeImageServicesResult,
  BotStatus,
  CommandResult,
  CompanyLogoSelectionResult,
  CompanyRecord,
  DeleteCompanyPayload,
  DeleteCompanyResult,
  FacebookPagePhoto,
  LastJob,
  ListFacebookPagePhotosPayload,
  MarketingCampaignPayload,
  MarketingRunUpdate,
  SaveCompanyPayload,
  SelectCompanyPublicationAccountPayload,
  SelectCompanyPublicationAccountResult,
  StartBotPayload,
  StartPollerPayload,
  ToggleCompanyActivePayload,
  ToggleCompanyActiveResult,
} from './types'

const api = () => window.electronAPI

export const getBotStatus = (): Promise<BotStatus> => api().getBotStatus()
export const getLastJob = (): Promise<LastJob | null> => api().getLastJob()
export const analyzeImageServices = (payload: AnalyzeImageServicesPayload): Promise<AnalyzeImageServicesResult> =>
  api().analyzeImageServices(payload)
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
export const listCompanyRecords = (): Promise<CompanyRecord[]> => api().listCompanyRecords()
export const saveCompanyRecord = (payload: SaveCompanyPayload): Promise<CompanyRecord> => api().saveCompanyRecord(payload)
export const deleteCompanyRecord = (payload: DeleteCompanyPayload): Promise<DeleteCompanyResult> =>
  api().deleteCompanyRecord(payload)
export const toggleCompanyActive = (payload: ToggleCompanyActivePayload): Promise<ToggleCompanyActiveResult> =>
  api().toggleCompanyActive(payload)
export const selectCompanyPublicationAccount = (
  payload: SelectCompanyPublicationAccountPayload
): Promise<SelectCompanyPublicationAccountResult> => api().selectCompanyPublicationAccount(payload)
export const resetBotState = () => api().resetBotState()
export const generateDefaultPrompt = (): Promise<{ success: boolean; prompt: string }> => api().generateDefaultPrompt()
export const listFacebookPagePhotos = (payload?: ListFacebookPagePhotosPayload): Promise<FacebookPagePhoto[]> =>
  api().listFacebookPagePhotos(payload)
export const changeLogo = (): Promise<{ success: boolean; logoUrl?: string; canceled?: boolean }> => api().changeLogo()
export const selectCompanyLogoSvg = (): Promise<CompanyLogoSelectionResult> => api().selectCompanyLogoSvg()
export const getLogoPath = (): Promise<string | null> => api().getLogoPath()
export const listLogos = (): Promise<{ filename: string; url: string }[]> => api().listLogos()
export const setActiveLogo = (filename: string): Promise<{ success: boolean; logoUrl?: string }> => api().setActiveLogo(filename)
export const onLogNewLines = (cb: (lines: string[]) => void) => api().onLogNewLines(cb)
export const onBotLogLines = (cb: (lines: string[]) => void) => api().onBotLogLines(cb)
export const onMarketingRunUpdate = (cb: (update: MarketingRunUpdate) => void) => api().onMarketingRunUpdate(cb)
