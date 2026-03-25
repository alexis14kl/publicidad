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

export type CompanyPlatform = 'facebook' | 'tiktok' | 'linkedin' | 'instagram' | 'googleads'

export interface CompanyPlatformAccount {
  red_id?: number
  account_index: number
  account_label: string
  token: string
  page_id?: string
  account_id?: string
  activo: number
  is_primary?: number
}

export interface CompanyPlatformRecord {
  platform: CompanyPlatform
  label: string
  dbFile: string
  config_env_key: string
  accounts: CompanyPlatformAccount[]
}

export interface CompanyRecord {
  id: string
  nombre: string
  logo: string | null
  logo_url?: string | null
  telefono: string | null
  correo: string | null
  sitio_web: string | null
  direccion: string | null
  descripcion: string | null
  activo: number
  color_primario: string | null
  color_cta: string | null
  color_acento: string | null
  color_checks: string | null
  color_fondo: string | null
  created_at: string
  updated_at: string
  platforms: CompanyPlatformRecord[]
}

export const DEFAULT_BRAND_COLORS = {
  color_primario: '#3469ED',
  color_cta: '#fd9102',
  color_acento: '#00bcd4',
  color_checks: '#28a745',
  color_fondo: '#f0f0f5',
}

export interface SaveCompanyPlatformPayload {
  enabled: boolean
  syncToConfig: boolean
  accounts: {
    account_label?: string
    token?: string
    page_id?: string
    account_id?: string
  }[]
}

export interface SaveCompanyPayload {
  logo?: string
  nombre: string
  telefono?: string
  correo?: string
  sitio_web?: string
  direccion?: string
  descripcion?: string
  color_primario?: string
  color_cta?: string
  color_acento?: string
  color_checks?: string
  color_fondo?: string
  activo?: boolean
  platforms: Record<CompanyPlatform, SaveCompanyPlatformPayload>
}

export interface CompanyLogoSelectionResult {
  success: boolean
  canceled?: boolean
  error?: string
  logoPath?: string
  logoName?: string
  logoUrl?: string
}

export interface DeleteCompanyPayload {
  companyName: string
}

export interface DeleteCompanyResult {
  success: boolean
  deletedId?: number
  deletedName?: string
}

export interface ToggleCompanyActivePayload {
  companyName: string
  active: boolean
}

export interface ToggleCompanyActiveResult {
  success: boolean
  companyName?: string
  active?: number
}

export interface PromptHistoryEntry {
  text: string
  createdAt: string | null
}

export interface ImageServiceSuggestion {
  value: string
  label: string
  reason: string
  score: number
}

export interface AnalyzeImageServicesPayload {
  prePrompt: string
}

export interface AnalyzeImageServicesResult {
  suggestions: ImageServiceSuggestion[]
  error?: string
}

export interface VideoScenePlanItem {
  id: string
  label: string
  title: string
  timeRange: string
  prompt: string
  dialogue: string
}

export interface AnalyzeVideoScenesPayload {
  prePrompt: string
}

export interface AnalyzeVideoScenesResult {
  agentName: string
  sourcePath: string
  summary: string
  scenes: VideoScenePlanItem[]
  compiledPrompt: string
  error?: string
}

export interface FacebookPagePhoto {
  id: string
  name: string
  picture: string
  imageUrl: string
  createdTime: string
  link: string
}

export interface ListFacebookPagePhotosPayload {
  pageId?: string
  accessToken?: string
  pageAccessToken?: string
  adAccountId?: string
  limit?: number
}

export interface NoyeCodeService {
  value: string
  label: string
  emoji: string
}

export const NOYECODE_SERVICES: NoyeCodeService[] = [
  { value: 'desarrollo-a-la-medida', label: 'Desarrollo a la Medida', emoji: '\uD83D\uDCBB' },
  { value: 'automatizaciones-empresariales', label: 'Automatizaciones Empresariales', emoji: '\u2699\uFE0F' },
  { value: 'modernizacion-software-legacy', label: 'Modernizacion de Software Legacy', emoji: '\uD83D\uDD04' },
  { value: 'rpas-nativos', label: 'RPAs Nativos', emoji: '\uD83E\uDD16' },
  { value: 'desarrollo-android', label: 'Desarrollo Android', emoji: '\uD83D\uDCF1' },
  { value: 'desarrollo-desktop', label: 'Desarrollo Desktop', emoji: '\uD83D\uDDA5\uFE0F' },
  { value: 'trabaja-con-nosotros', label: 'Trabaja con Nosotros', emoji: '\uD83E\uDD1D' },
]

export interface ImageFormatOption {
  value: string
  label: string
  width: number
  height: number
  ratio: string
}

export interface ImageFormatGroup {
  platform: string
  icon: string
  formats: ImageFormatOption[]
}

export const IMAGE_FORMAT_GROUPS: ImageFormatGroup[] = [
  {
    platform: 'Facebook',
    icon: '\uD83D\uDCD8',
    formats: [
      { value: 'fb-vertical', label: 'Vertical 4:5', width: 1080, height: 1350, ratio: '4:5' },
      { value: 'fb-square', label: 'Cuadrado 1:1', width: 1080, height: 1080, ratio: '1:1' },
      { value: 'fb-horizontal', label: 'Horizontal 1.91:1', width: 1200, height: 628, ratio: '1.91:1' },
      { value: 'fb-story', label: 'Story / Reel 9:16', width: 1080, height: 1920, ratio: '9:16' },
    ],
  },
  {
    platform: 'Instagram',
    icon: '\uD83D\uDCF7',
    formats: [
      { value: 'ig-vertical', label: 'Vertical 4:5', width: 1080, height: 1350, ratio: '4:5' },
      { value: 'ig-square', label: 'Cuadrado 1:1', width: 1080, height: 1080, ratio: '1:1' },
      { value: 'ig-story', label: 'Story / Reel 9:16', width: 1080, height: 1920, ratio: '9:16' },
      { value: 'ig-landscape', label: 'Horizontal 1.91:1', width: 1080, height: 566, ratio: '1.91:1' },
    ],
  },
  {
    platform: 'TikTok',
    icon: '\uD83C\uDFB5',
    formats: [
      { value: 'tt-vertical', label: 'Vertical 9:16', width: 1080, height: 1920, ratio: '9:16' },
      { value: 'tt-square', label: 'Cuadrado 1:1', width: 1080, height: 1080, ratio: '1:1' },
    ],
  },
  {
    platform: 'LinkedIn',
    icon: '\uD83D\uDCBC',
    formats: [
      { value: 'li-horizontal', label: 'Horizontal 1.91:1', width: 1200, height: 628, ratio: '1.91:1' },
      { value: 'li-square', label: 'Cuadrado 1:1', width: 1080, height: 1080, ratio: '1:1' },
      { value: 'li-vertical', label: 'Vertical 4:5', width: 1080, height: 1350, ratio: '4:5' },
      { value: 'li-story', label: 'Story 9:16', width: 1080, height: 1920, ratio: '9:16' },
    ],
  },
]

export interface SelectCompanyPublicationAccountPayload {
  companyName: string
  platform: CompanyPlatform
  accountIndex: number
}

export interface SelectCompanyPublicationAccountResult {
  success: boolean
  companyName?: string
  platform?: CompanyPlatform
  accountIndex?: number
  envKey?: string
}

export interface StartBotPayload {
  profileName?: string
  imagePrompt?: string
  imageFormat?: string
  imageService?: string
  companyName?: string
  publishPlatforms?: string[]
  contentType?: string
  reelTitle?: string
  reelCaption?: string
}

export interface StartPollerPayload {
  imagePrompt?: string
  imageFormat?: string
  imageService?: string
  companyName?: string
}

export interface MarketingCampaignPayload {
  campaignIdea: string
  city: string
  zones: string[]
  contactMode: 'lead_form' | 'whatsapp'
  companyName?: string
  prePrompt?: string
  useZoneIntelligence?: boolean
  useAudienceSegmentation?: boolean
  generateImageFromMarketingPrompt?: boolean
  marketingPrompt?: string
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
    companyName?: string
    city?: string
    zones?: string[]
    campaignIdea?: string
    prePrompt?: string
    contactMode?: 'lead_form' | 'whatsapp'
    zoneIntelligenceEnabled?: boolean
    audienceSegmentationEnabled?: boolean
    generateImageFromMarketingPrompt?: boolean
    marketingPrompt?: string
    generatedImagePrompt?: string
    generatedImageStatus?: string
    generatedImageError?: string
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
    zoneInsights?: {
      summary: string
      topZones: {
        zone: string
        scoreLabel: string
        reason: string
        source: string
      }[]
      searchSignals: string[]
    } | null
    audienceInsights?: {
      summary: string
      segments: {
        label: string
        reason: string
        interests: string[]
        intentSignals: string[]
      }[]
    } | null
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
        city?: string
        zones?: string[]
        service?: string
        zoneFocus?: string
        audienceSegments?: string[]
        assumptions: string[]
      }
      seoAnalyzer?: {
        zoneSummary: string
        searchIntent: string[]
        audienceSignals: string[]
        recommendedContentAngles: string[]
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
        prompt?: string
        notes: string[]
      }
      execution: {
        accountHint: string
        pageId: string
        campaignType: string
        budgetCap: string
        formFields: string[]
        prePrompt?: string
        city?: string
        zones?: string[]
        recommendedZones?: string[]
        audienceSegments?: string[]
        contactChannel?: string
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

// ── Meta Marketing API Types ──────────────────────────────────────────────────

export interface MetaApiResult {
  success: boolean
  error?: string
}

export interface MetaAppTokenResult extends MetaApiResult {
  access_token?: string
  token_type?: string
}

export interface MetaOAuthUrlResult extends MetaApiResult {
  url?: string
}

export interface MetaExchangeCodePayload {
  code: string
  appId?: string
  appSecret?: string
  redirectUri?: string
}

export interface MetaTokenResult extends MetaApiResult {
  access_token?: string
  token_type?: string
  expires_in?: number | null
}

export interface MetaExchangeLongLivedPayload {
  shortLivedToken: string
  appId?: string
  appSecret?: string
}

export interface MetaPageToken {
  id: string
  name: string
  access_token: string
  category: string
  tasks: string[]
}

export interface MetaPageTokensResult extends MetaApiResult {
  pages?: MetaPageToken[]
}

export interface MetaDebugTokenPayload {
  inputToken: string
  appToken?: string
  appId?: string
  appSecret?: string
}

export interface MetaDebugTokenResult extends MetaApiResult {
  app_id?: string
  type?: string
  is_valid?: boolean
  expires_at?: number
  scopes?: string[]
  user_id?: string
}

export interface MetaUploadAdImagePayload {
  adAccountId?: string
  imageBase64?: string
  imagePath?: string
  token?: string
}

export interface MetaUploadAdImageResult extends MetaApiResult {
  image_hash?: string
  url?: string
  name?: string
}

export interface MetaCreateLeadgenFormPayload {
  pageId?: string
  token?: string
  name?: string
  questions?: { type: string }[]
  privacyPolicyUrl?: string
  thankYouTitle?: string
  thankYouBody?: string
  locale?: string
}

export interface MetaCreateLeadgenFormResult extends MetaApiResult {
  form_id?: string
}

export interface MetaCreateCampaignPayload {
  adAccountId?: string
  token?: string
  name?: string
  objective?: string
  status?: string
  specialAdCategories?: string[]
  bidStrategy?: string
}

export interface MetaCreateCampaignResult extends MetaApiResult {
  campaign_id?: string
}

export interface MetaCreateAdSetPayload {
  adAccountId?: string
  token?: string
  name?: string
  campaignId: string
  optimizationGoal?: string
  billingEvent?: string
  dailyBudget?: number
  bidAmount?: number
  status?: string
  pageId?: string
  targeting?: {
    geo_locations?: { countries?: string[]; cities?: { key: string }[] }
    age_min?: number
    age_max?: number
    genders?: number[]
    interests?: { id: string; name: string }[]
  }
}

export interface MetaCreateAdSetResult extends MetaApiResult {
  adset_id?: string
}

export interface MetaCreateAdCreativePayload {
  adAccountId?: string
  token?: string
  name?: string
  pageId?: string
  imageHash: string
  message?: string
  caption?: string
  callToActionType?: string
  leadgenFormId?: string
}

export interface MetaCreateAdCreativeResult extends MetaApiResult {
  creative_id?: string
}

export interface MetaCreateAdPayload {
  adAccountId?: string
  token?: string
  name?: string
  adsetId: string
  creativeId: string
  status?: string
}

export interface MetaCreateAdResult extends MetaApiResult {
  ad_id?: string
}

export interface MetaActivateCampaignPayload {
  campaignId: string
  token?: string
}

export interface MetaActivateCampaignResult extends MetaApiResult {
  campaign_id?: string
}

export interface MetaLeadPipelinePayload {
  token?: string
  pageToken?: string
  adAccountId?: string
  pageId?: string
  imageBase64?: string
  imagePath?: string
  formName?: string
  formQuestions?: { type: string }[]
  privacyPolicyUrl?: string
  campaignName?: string
  campaignObjective?: string
  bidStrategy?: string
  adsetName?: string
  dailyBudget?: number
  bidAmount?: number
  targeting?: MetaCreateAdSetPayload['targeting']
  creativeName?: string
  message?: string
  caption?: string
  callToActionType?: string
  adName?: string
}

export interface MetaLeadPipelineResult extends MetaApiResult {
  image_hash?: string | null
  form_id?: string | null
  campaign_id?: string | null
  adset_id?: string | null
  creative_id?: string | null
  ad_id?: string | null
  errors?: string[]
}

export interface MetaPipelineStepEvent {
  step: number
  message: string
}

export interface MetaPublishPagePostPayload {
  pageId?: string
  token?: string
  message?: string
  link?: string
  published?: boolean
}

export interface MetaPublishPagePostResult extends MetaApiResult {
  post_id?: string
}

export interface MetaPublishPagePhotoPayload {
  pageId?: string
  token?: string
  imageUrl: string
  message?: string
  published?: boolean
}

export interface MetaPublishPagePhotoResult extends MetaApiResult {
  post_id?: string
  photo_id?: string
}

export interface PreflightCheck {
  name: string
  required: string
  current: string | null
  ok: boolean
  fix: string | null
}

export interface PreflightResult {
  ok: boolean
  checks: PreflightCheck[]
}

export interface ElectronAPI {
  getBotStatus: () => Promise<BotStatus>
  getLastJob: () => Promise<LastJob | null>
  analyzeImageServices: (payload: AnalyzeImageServicesPayload) => Promise<AnalyzeImageServicesResult>
  analyzeVideoScenes: (payload: AnalyzeVideoScenesPayload) => Promise<AnalyzeVideoScenesResult>
  startBot: (payload?: StartBotPayload) => Promise<CommandResult>
  stopBot: () => Promise<CommandResult>
  startPoller: (payload?: StartPollerPayload) => Promise<CommandResult>
  stopPoller: () => Promise<CommandResult>
  isPollerRunning: () => Promise<boolean>
  runMarketingCampaignPreview: (payload: MarketingCampaignPayload) => Promise<CommandResult>
  readLogLines: (count?: number) => Promise<string[]>
  getEnvConfig: () => Promise<Record<string, string>>
  saveEnvConfig: (config: Record<string, string>) => Promise<CommandResult>
  listCompanyRecords: (platform?: CompanyPlatform) => Promise<CompanyRecord[]>
  saveCompanyRecord: (payload: SaveCompanyPayload) => Promise<CompanyRecord>
  deleteCompanyRecord: (payload: DeleteCompanyPayload) => Promise<DeleteCompanyResult>
  toggleCompanyActive: (payload: ToggleCompanyActivePayload) => Promise<ToggleCompanyActiveResult>
  selectCompanyPublicationAccount: (
    payload: SelectCompanyPublicationAccountPayload
  ) => Promise<SelectCompanyPublicationAccountResult>
  resetBotState: () => Promise<{ success: boolean; deleted: string[] }>
  runPreflight: (force?: boolean) => Promise<PreflightResult>
  generateDefaultPrompt: () => Promise<{ success: boolean; prompt: string }>
  listFacebookPagePhotos: (payload?: ListFacebookPagePhotosPayload) => Promise<FacebookPagePhoto[]>
  changeLogo: () => Promise<{ success: boolean; logoUrl?: string; canceled?: boolean }>
  selectCompanyLogoSvg: () => Promise<CompanyLogoSelectionResult>
  getLogoPath: () => Promise<string | null>
  listLogos: () => Promise<{ filename: string; url: string }[]>
  setActiveLogo: (filename: string) => Promise<{ success: boolean; logoUrl?: string }>
  onLogNewLines: (callback: (lines: string[]) => void) => () => void
  onBotLogLines: (callback: (lines: string[]) => void) => () => void
  onMarketingRunUpdate: (callback: (update: MarketingRunUpdate) => void) => () => void
  // Meta Marketing API
  metaGetAppToken: (payload?: Record<string, string>) => Promise<MetaAppTokenResult>
  metaGetOAuthUrl: (payload?: Record<string, string | string[]>) => Promise<MetaOAuthUrlResult>
  metaExchangeCode: (payload: MetaExchangeCodePayload) => Promise<MetaTokenResult>
  metaExchangeLongLived: (payload: MetaExchangeLongLivedPayload) => Promise<MetaTokenResult>
  metaGetPageTokens: (payload?: { userToken?: string }) => Promise<MetaPageTokensResult>
  metaDebugToken: (payload: MetaDebugTokenPayload) => Promise<MetaDebugTokenResult>
  metaUploadAdImage: (payload: MetaUploadAdImagePayload) => Promise<MetaUploadAdImageResult>
  metaCreateLeadgenForm: (payload?: MetaCreateLeadgenFormPayload) => Promise<MetaCreateLeadgenFormResult>
  metaCreateCampaign: (payload?: MetaCreateCampaignPayload) => Promise<MetaCreateCampaignResult>
  metaCreateAdset: (payload: MetaCreateAdSetPayload) => Promise<MetaCreateAdSetResult>
  metaCreateAdCreative: (payload: MetaCreateAdCreativePayload) => Promise<MetaCreateAdCreativeResult>
  metaCreateAd: (payload: MetaCreateAdPayload) => Promise<MetaCreateAdResult>
  metaActivateCampaign: (payload: MetaActivateCampaignPayload) => Promise<MetaActivateCampaignResult>
  metaExecuteLeadPipeline: (payload: MetaLeadPipelinePayload) => Promise<MetaLeadPipelineResult>
  metaPublishPagePost: (payload?: MetaPublishPagePostPayload) => Promise<MetaPublishPagePostResult>
  metaPublishPagePhoto: (payload: MetaPublishPagePhotoPayload) => Promise<MetaPublishPagePhotoResult>
  onMetaPipelineStep: (callback: (data: MetaPipelineStepEvent) => void) => () => void
}
