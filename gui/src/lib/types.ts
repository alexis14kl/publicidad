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
  telefono: string | null
  correo: string | null
  sitio_web: string | null
  direccion: string | null
  descripcion: string | null
  activo: number
  created_at: string
  updated_at: string
  platforms: CompanyPlatformRecord[]
}

export interface SaveCompanyPlatformPayload {
  enabled: boolean
  syncToConfig: boolean
  accounts: {
    account_label?: string
    token?: string
    page_id?: string
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

export interface PromptHistoryEntry {
  text: string
  createdAt: string | null
}

export interface NoyeCodeService {
  value: string
  label: string
  emoji: string
}

export const NOYECODE_SERVICES: NoyeCodeService[] = [
  { value: 'desarrollo-a-la-medida',          label: 'Desarrollo a la Medida',              emoji: '\uD83D\uDCBB' },
  { value: 'automatizaciones-empresariales',   label: 'Automatizaciones Empresariales',      emoji: '\u2699\uFE0F' },
  { value: 'modernizacion-software-legacy',    label: 'Modernizacion de Software Legacy',    emoji: '\uD83D\uDD04' },
  { value: 'rpas-nativos',                     label: 'RPAs Nativos',                        emoji: '\uD83E\uDD16' },
  { value: 'desarrollo-android',               label: 'Desarrollo Android',                  emoji: '\uD83D\uDCF1' },
  { value: 'desarrollo-desktop',               label: 'Desarrollo Desktop',                  emoji: '\uD83D\uDDA5\uFE0F' },
  { value: 'trabaja-con-nosotros',             label: 'Trabaja con Nosotros',                emoji: '\uD83E\uDD1D' },
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
      { value: 'fb-vertical',    label: 'Vertical 4:5',       width: 1080, height: 1350, ratio: '4:5' },
      { value: 'fb-square',      label: 'Cuadrado 1:1',       width: 1080, height: 1080, ratio: '1:1' },
      { value: 'fb-horizontal',  label: 'Horizontal 1.91:1',  width: 1200, height: 628,  ratio: '1.91:1' },
      { value: 'fb-story',       label: 'Story / Reel 9:16',  width: 1080, height: 1920, ratio: '9:16' },
    ],
  },
  {
    platform: 'Instagram',
    icon: '\uD83D\uDCF7',
    formats: [
      { value: 'ig-vertical',    label: 'Vertical 4:5',       width: 1080, height: 1350, ratio: '4:5' },
      { value: 'ig-square',      label: 'Cuadrado 1:1',       width: 1080, height: 1080, ratio: '1:1' },
      { value: 'ig-story',       label: 'Story / Reel 9:16',  width: 1080, height: 1920, ratio: '9:16' },
      { value: 'ig-landscape',   label: 'Horizontal 1.91:1',  width: 1080, height: 566,  ratio: '1.91:1' },
    ],
  },
  {
    platform: 'TikTok',
    icon: '\uD83C\uDFB5',
    formats: [
      { value: 'tt-vertical',    label: 'Vertical 9:16',      width: 1080, height: 1920, ratio: '9:16' },
      { value: 'tt-square',      label: 'Cuadrado 1:1',       width: 1080, height: 1080, ratio: '1:1' },
    ],
  },
  {
    platform: 'LinkedIn',
    icon: '\uD83D\uDCBC',
    formats: [
      { value: 'li-horizontal',  label: 'Horizontal 1.91:1',  width: 1200, height: 628,  ratio: '1.91:1' },
      { value: 'li-square',      label: 'Cuadrado 1:1',       width: 1080, height: 1080, ratio: '1:1' },
      { value: 'li-vertical',    label: 'Vertical 4:5',       width: 1080, height: 1350, ratio: '4:5' },
      { value: 'li-story',       label: 'Story 9:16',         width: 1080, height: 1920, ratio: '9:16' },
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
}

export interface StartPollerPayload {
  imagePrompt?: string
  imageFormat?: string
  imageService?: string
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
  startBot: (payload?: StartBotPayload) => Promise<CommandResult>
  stopBot: () => Promise<CommandResult>
  startPoller: () => Promise<CommandResult>
  stopPoller: () => Promise<CommandResult>
  isPollerRunning: () => Promise<boolean>
  runMarketingCampaignPreview: (payload: MarketingCampaignPayload) => Promise<CommandResult>
  readLogLines: (count?: number) => Promise<string[]>
  getEnvConfig: () => Promise<Record<string, string>>
  saveEnvConfig: (config: Record<string, string>) => Promise<CommandResult>
  listCompanyRecords: (platform: CompanyPlatform) => Promise<CompanyRecord[]>
  saveCompanyRecord: (payload: SaveCompanyPayload) => Promise<CompanyRecord>
  resetBotState: () => Promise<{ success: boolean; deleted: string[] }>
  runPreflight: (force?: boolean) => Promise<PreflightResult>
  generateDefaultPrompt: () => Promise<{ success: boolean; prompt: string }>
  onLogNewLines: (callback: (lines: string[]) => void) => () => void
  onBotLogLines: (callback: (lines: string[]) => void) => () => void
  onMarketingRunUpdate: (callback: (update: MarketingRunUpdate) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
