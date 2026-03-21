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
})
