import type {
  AnalyzeImageServicesPayload,
  AnalyzeImageServicesResult,
  AnalyzeVideoScenesPayload,
  AnalyzeVideoScenesResult,
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
  MetaActivateCampaignPayload,
  MetaActivateCampaignResult,
  MetaAppTokenResult,
  MetaCreateAdCreativePayload,
  MetaCreateAdCreativeResult,
  MetaCreateAdPayload,
  MetaCreateAdResult,
  MetaCreateAdSetPayload,
  MetaCreateAdSetResult,
  MetaCreateCampaignPayload,
  MetaCreateCampaignResult,
  MetaCreateLeadgenFormPayload,
  MetaCreateLeadgenFormResult,
  MetaDebugTokenPayload,
  MetaDebugTokenResult,
  MetaExchangeCodePayload,
  MetaExchangeLongLivedPayload,
  MetaLeadPipelinePayload,
  MetaLeadPipelineResult,
  MetaOAuthUrlResult,
  MetaPageTokensResult,
  MetaPipelineStepEvent,
  MetaPublishPagePhotoPayload,
  MetaPublishPagePhotoResult,
  MetaPublishPagePostPayload,
  MetaPublishPagePostResult,
  MetaStartOAuthResult,
  MetaTokenResult,
  OAuthAccount,
  OAuthAutoCreateResult,
  OAuthPlatform,
  OAuthResult,
  MetaUploadAdImagePayload,
  MetaUploadAdImageResult,
  IgAccountInfo,
  IgApiResult,
  IgCarouselResult,
  IgCommentResult,
  IgContainerResult,
  IgContainerStatusResult,
  IgCreateCarouselPayload,
  IgCreateImagePayload,
  IgCreateReelPayload,
  IgCreateStoryPayload,
  IgGetUserIdResult,
  IgInsightsPayload,
  IgInsightsResult,
  IgListCommentsResult,
  IgListMediaResult,
  IgMediaDetail,
  IgPublishImagePayload,
  IgPublishReelPayload,
  IgPublishResult,
  IgPublishStepEvent,
  IgPublishingLimit,
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
export const analyzeVideoScenes = (payload: AnalyzeVideoScenesPayload): Promise<AnalyzeVideoScenesResult> =>
  api().analyzeVideoScenes(payload)
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

export interface AutoCampaignInput {
  name: string
  description: string
  budget: string
  goals?: string
  start_date?: string
  end_date?: string
  contact_mode?: 'lead_form' | 'whatsapp'
  access_token?: string
  ad_account_id?: string
  page_id?: string
  dryRun?: boolean
}

export interface AutoCampaignResult {
  success: boolean
  spec?: Record<string, unknown>
  results?: {
    ok: boolean
    campaign: { id: string; name: string } | null
    adset: { id: string; name: string } | null
    lead_form: { id: string; name: string } | null
    ads: { id: string; name: string; creative_id: string }[]
    errors: string[]
  }
  error?: string
}

export const runAutoCampaign = (payload: AutoCampaignInput): Promise<AutoCampaignResult> =>
  api().runAutoCampaign(payload)

// ── Meta Marketing API ──────────────────────────────────────────────────────

// ── OAuth generico (multi-plataforma) ──────────────────────────────────────
export const oauthStart = (platform: OAuthPlatform): Promise<OAuthResult> => api().oauthStart(platform)
export const oauthAutoCreateAccounts = (accounts: OAuthAccount[]): Promise<OAuthAutoCreateResult> =>
  api().oauthAutoCreateAccounts({ accounts })

// 0. OAuth Window Flow (backward compat)
export const metaStartOAuth = (): Promise<MetaStartOAuthResult> => api().metaStartOAuth()

// 1. App Access Token
export const metaGetAppToken = (payload?: Record<string, string>): Promise<MetaAppTokenResult> =>
  api().metaGetAppToken(payload)

// 2. OAuth Flow
export const metaGetOAuthUrl = (payload?: Record<string, string | string[]>): Promise<MetaOAuthUrlResult> =>
  api().metaGetOAuthUrl(payload)

export const metaExchangeCode = (payload: MetaExchangeCodePayload): Promise<MetaTokenResult> =>
  api().metaExchangeCode(payload)

export const metaExchangeLongLived = (payload: MetaExchangeLongLivedPayload): Promise<MetaTokenResult> =>
  api().metaExchangeLongLived(payload)

// 3. Page Tokens
export const metaGetPageTokens = (payload?: { userToken?: string }): Promise<MetaPageTokensResult> =>
  api().metaGetPageTokens(payload)

// Token Debug
export const metaDebugToken = (payload: MetaDebugTokenPayload): Promise<MetaDebugTokenResult> =>
  api().metaDebugToken(payload)

// 4. Campaign Pipeline (individual steps)
export const metaUploadAdImage = (payload: MetaUploadAdImagePayload): Promise<MetaUploadAdImageResult> =>
  api().metaUploadAdImage(payload)

export const metaCreateLeadgenForm = (payload?: MetaCreateLeadgenFormPayload): Promise<MetaCreateLeadgenFormResult> =>
  api().metaCreateLeadgenForm(payload)

export const metaCreateCampaign = (payload?: MetaCreateCampaignPayload): Promise<MetaCreateCampaignResult> =>
  api().metaCreateCampaign(payload)

export const metaCreateAdset = (payload: MetaCreateAdSetPayload): Promise<MetaCreateAdSetResult> =>
  api().metaCreateAdset(payload)

export const metaCreateAdCreative = (payload: MetaCreateAdCreativePayload): Promise<MetaCreateAdCreativeResult> =>
  api().metaCreateAdCreative(payload)

export const metaCreateAd = (payload: MetaCreateAdPayload): Promise<MetaCreateAdResult> =>
  api().metaCreateAd(payload)

export const metaActivateCampaign = (payload: MetaActivateCampaignPayload): Promise<MetaActivateCampaignResult> =>
  api().metaActivateCampaign(payload)

// Pipeline completo (6 pasos en secuencia)
export const metaExecuteLeadPipeline = (payload: MetaLeadPipelinePayload): Promise<MetaLeadPipelineResult> =>
  api().metaExecuteLeadPipeline(payload)

// 5. Page Posts
export const metaPublishPagePost = (payload?: MetaPublishPagePostPayload): Promise<MetaPublishPagePostResult> =>
  api().metaPublishPagePost(payload)

export const metaPublishPagePhoto = (payload: MetaPublishPagePhotoPayload): Promise<MetaPublishPagePhotoResult> =>
  api().metaPublishPagePhoto(payload)

// Pipeline step event listener
export const onMetaPipelineStep = (cb: (data: MetaPipelineStepEvent) => void) => api().onMetaPipelineStep(cb)

// ── Instagram API ───────────────────────────────────────────────────────────

// 1. IG User ID
export const igGetUserId = (payload?: { token?: string }): Promise<IgGetUserIdResult> =>
  api().igGetUserId(payload)

// 2. Account Info
export const igGetAccountInfo = (payload?: { igUserId?: string; token?: string }): Promise<IgAccountInfo> =>
  api().igGetAccountInfo(payload)

// 3. Publishing — Containers
export const igCreateImageContainer = (payload: IgCreateImagePayload): Promise<IgContainerResult> =>
  api().igCreateImageContainer(payload)

export const igCreateReelContainer = (payload: IgCreateReelPayload): Promise<IgContainerResult> =>
  api().igCreateReelContainer(payload)

export const igCreateStoryContainer = (payload: IgCreateStoryPayload): Promise<IgContainerResult> =>
  api().igCreateStoryContainer(payload)

export const igCreateCarousel = (payload: IgCreateCarouselPayload): Promise<IgCarouselResult> =>
  api().igCreateCarousel(payload)

export const igCheckContainerStatus = (payload: { containerId: string; token?: string }): Promise<IgContainerStatusResult> =>
  api().igCheckContainerStatus(payload)

export const igPublishContainer = (payload: { igUserId?: string; token?: string; containerId: string }): Promise<IgPublishResult> =>
  api().igPublishContainer(payload)

// 3. Publishing — Convenience
export const igPublishImage = (payload: IgPublishImagePayload): Promise<IgPublishResult> =>
  api().igPublishImage(payload)

export const igPublishReel = (payload: IgPublishReelPayload): Promise<IgPublishResult> =>
  api().igPublishReel(payload)

// 4. Media
export const igListMedia = (payload?: { igUserId?: string; token?: string; limit?: number }): Promise<IgListMediaResult> =>
  api().igListMedia(payload)

export const igGetMediaDetail = (payload: { mediaId: string; token?: string }): Promise<IgMediaDetail> =>
  api().igGetMediaDetail(payload)

export const igGetPublishingLimit = (payload?: { igUserId?: string; token?: string }): Promise<IgPublishingLimit> =>
  api().igGetPublishingLimit(payload)

// 5. Comments
export const igListComments = (payload: { mediaId: string; token?: string; limit?: number }): Promise<IgListCommentsResult> =>
  api().igListComments(payload)

export const igReplyComment = (payload: { commentId: string; token?: string; message: string }): Promise<IgCommentResult> =>
  api().igReplyComment(payload)

export const igHideComment = (payload: { commentId: string; token?: string; hide?: boolean }): Promise<IgApiResult> =>
  api().igHideComment(payload)

export const igToggleComments = (payload: { mediaId: string; token?: string; enabled?: boolean }): Promise<IgApiResult> =>
  api().igToggleComments(payload)

// 6. Insights
export const igGetAccountInsights = (payload?: IgInsightsPayload): Promise<IgInsightsResult> =>
  api().igGetAccountInsights(payload)

export const igGetMediaInsights = (payload: { mediaId: string; token?: string; metrics?: string }): Promise<IgInsightsResult> =>
  api().igGetMediaInsights(payload)

// Publish step event listener
export const onIgPublishStep = (cb: (data: IgPublishStepEvent) => void) => api().onIgPublishStep(cb)
