const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getBotStatus: () => ipcRenderer.invoke('get-bot-status'),
  getLastJob: () => ipcRenderer.invoke('get-last-job'),
  analyzeImageServices: (payload) => ipcRenderer.invoke('analyze-image-services', payload),
  analyzeVideoScenes: (payload) => ipcRenderer.invoke('analyze-video-scenes', payload),
  startBot: (payload) => ipcRenderer.invoke('start-bot', payload),
  stopBot: () => ipcRenderer.invoke('stop-bot'),
  startPoller: (payload) => ipcRenderer.invoke('start-poller', payload),
  stopPoller: () => ipcRenderer.invoke('stop-poller'),
  isPollerRunning: () => ipcRenderer.invoke('is-poller-running'),
  runMarketingCampaignPreview: (payload) => ipcRenderer.invoke('run-marketing-campaign-preview', payload),
  readLogLines: (count) => ipcRenderer.invoke('read-log-lines', count),
  getEnvConfig: () => ipcRenderer.invoke('get-env-config'),
  saveEnvConfig: (config) => ipcRenderer.invoke('save-env-config', config),
  listCompanyRecords: (platform) => ipcRenderer.invoke('list-company-records', platform),
  saveCompanyRecord: (payload) => ipcRenderer.invoke('save-company-record', payload),
  deleteCompanyRecord: (payload) => ipcRenderer.invoke('delete-company-record', payload),
  toggleCompanyActive: (payload) => ipcRenderer.invoke('toggle-company-active', payload),
  selectCompanyPublicationAccount: (payload) => ipcRenderer.invoke('select-company-publication-account', payload),
  resetBotState: () => ipcRenderer.invoke('reset-bot-state'),
  runPreflight: (force) => ipcRenderer.invoke('run-preflight', force),
  generateDefaultPrompt: () => ipcRenderer.invoke('generate-default-prompt'),
  listFacebookPagePhotos: (payload) => ipcRenderer.invoke('list-facebook-page-photos', payload),
  changeLogo: () => ipcRenderer.invoke('change-logo'),
  selectCompanyLogoSvg: () => ipcRenderer.invoke('select-company-logo-svg'),
  getLogoPath: () => ipcRenderer.invoke('get-logo-path'),
  listLogos: () => ipcRenderer.invoke('list-logos'),
  setActiveLogo: (filename) => ipcRenderer.invoke('set-active-logo', filename),
  getBrochureHtml: () => ipcRenderer.invoke('get-brochure-html'),
  getLatestBrochure: () => ipcRenderer.invoke('get-latest-brochure'),
  listBrochures: () => ipcRenderer.invoke('list-brochures'),
  openBrochurePdf: (filePath) => ipcRenderer.invoke('open-brochure-pdf', filePath),
  runAutoCampaign: (payload) => ipcRenderer.invoke('run-auto-campaign', payload),
  chatCommand: (text) => ipcRenderer.invoke('chat-command', text),
  chatApprove: (jobId, platform) => ipcRenderer.invoke('chat-approve', jobId, platform),
  chatExtendVideo: (jobId, extendPrompt) => ipcRenderer.invoke('chat-extend-video', jobId, extendPrompt),
  chatReset: () => ipcRenderer.invoke('chat-reset'),
  onLogNewLines: (callback) => {
    const handler = (_event, lines) => callback(lines)
    ipcRenderer.on('log-new-lines', handler)
    return () => ipcRenderer.removeListener('log-new-lines', handler)
  },
  onBotLogLines: (callback) => {
    const handler = (_event, lines) => callback(lines)
    ipcRenderer.on('bot-log-lines', handler)
    return () => ipcRenderer.removeListener('bot-log-lines', handler)
  },
  onMarketingRunUpdate: (callback) => {
    const handler = (_event, update) => callback(update)
    ipcRenderer.on('marketing-run-update', handler)
    return () => ipcRenderer.removeListener('marketing-run-update', handler)
  },

  // ── OAuth generico ───────────────────────────────────────────────────────
  oauthStart: (platform) => ipcRenderer.invoke('oauth-start', { platform }),
  oauthAutoCreateAccounts: (payload) => ipcRenderer.invoke('oauth-auto-create-accounts', payload),

  // ── Meta Marketing API ────────────────────────────────────────────────────
  metaStartOAuth: () => ipcRenderer.invoke('meta-start-oauth'),
  metaGetAppToken: (payload) => ipcRenderer.invoke('meta-get-app-token', payload),
  metaGetOAuthUrl: (payload) => ipcRenderer.invoke('meta-get-oauth-url', payload),
  metaExchangeCode: (payload) => ipcRenderer.invoke('meta-exchange-code', payload),
  metaExchangeLongLived: (payload) => ipcRenderer.invoke('meta-exchange-long-lived', payload),
  metaGetPageTokens: (payload) => ipcRenderer.invoke('meta-get-page-tokens', payload),
  metaDebugToken: (payload) => ipcRenderer.invoke('meta-debug-token', payload),
  metaUploadAdImage: (payload) => ipcRenderer.invoke('meta-upload-ad-image', payload),
  metaCreateLeadgenForm: (payload) => ipcRenderer.invoke('meta-create-leadgen-form', payload),
  metaCreateCampaign: (payload) => ipcRenderer.invoke('meta-create-campaign', payload),
  metaCreateAdset: (payload) => ipcRenderer.invoke('meta-create-adset', payload),
  metaCreateAdCreative: (payload) => ipcRenderer.invoke('meta-create-ad-creative', payload),
  metaCreateAd: (payload) => ipcRenderer.invoke('meta-create-ad', payload),
  metaActivateCampaign: (payload) => ipcRenderer.invoke('meta-activate-campaign', payload),
  metaExecuteLeadPipeline: (payload) => ipcRenderer.invoke('meta-execute-lead-pipeline', payload),
  metaPublishPagePost: (payload) => ipcRenderer.invoke('meta-publish-page-post', payload),
  metaPublishPagePhoto: (payload) => ipcRenderer.invoke('meta-publish-page-photo', payload),
  onMetaPipelineStep: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('meta-pipeline-step', handler)
    return () => ipcRenderer.removeListener('meta-pipeline-step', handler)
  },

  // ── Instagram API ───────────────────────────────────────────────────────
  igGetUserId: (payload) => ipcRenderer.invoke('ig-get-user-id', payload),
  igGetAccountInfo: (payload) => ipcRenderer.invoke('ig-get-account-info', payload),
  igCreateImageContainer: (payload) => ipcRenderer.invoke('ig-create-image-container', payload),
  igCreateReelContainer: (payload) => ipcRenderer.invoke('ig-create-reel-container', payload),
  igCreateStoryContainer: (payload) => ipcRenderer.invoke('ig-create-story-container', payload),
  igCreateCarousel: (payload) => ipcRenderer.invoke('ig-create-carousel', payload),
  igCheckContainerStatus: (payload) => ipcRenderer.invoke('ig-check-container-status', payload),
  igPublishContainer: (payload) => ipcRenderer.invoke('ig-publish-container', payload),
  igPublishImage: (payload) => ipcRenderer.invoke('ig-publish-image', payload),
  igPublishReel: (payload) => ipcRenderer.invoke('ig-publish-reel', payload),
  igListMedia: (payload) => ipcRenderer.invoke('ig-list-media', payload),
  igGetMediaDetail: (payload) => ipcRenderer.invoke('ig-get-media-detail', payload),
  igGetPublishingLimit: (payload) => ipcRenderer.invoke('ig-get-publishing-limit', payload),
  igListComments: (payload) => ipcRenderer.invoke('ig-list-comments', payload),
  igReplyComment: (payload) => ipcRenderer.invoke('ig-reply-comment', payload),
  igHideComment: (payload) => ipcRenderer.invoke('ig-hide-comment', payload),
  igToggleComments: (payload) => ipcRenderer.invoke('ig-toggle-comments', payload),
  igGetAccountInsights: (payload) => ipcRenderer.invoke('ig-get-account-insights', payload),
  igGetMediaInsights: (payload) => ipcRenderer.invoke('ig-get-media-insights', payload),
  onIgPublishStep: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('ig-publish-step', handler)
    return () => ipcRenderer.removeListener('ig-publish-step', handler)
  },
})
