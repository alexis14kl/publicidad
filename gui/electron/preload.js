const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getBotStatus: () => ipcRenderer.invoke('get-bot-status'),
  getLastJob: () => ipcRenderer.invoke('get-last-job'),
  startBot: (profileName) => ipcRenderer.invoke('start-bot', profileName),
  stopBot: () => ipcRenderer.invoke('stop-bot'),
  startPoller: () => ipcRenderer.invoke('start-poller'),
  stopPoller: () => ipcRenderer.invoke('stop-poller'),
  isPollerRunning: () => ipcRenderer.invoke('is-poller-running'),
  runMarketingCampaignPreview: (payload) => ipcRenderer.invoke('run-marketing-campaign-preview', payload),
  readLogLines: (count) => ipcRenderer.invoke('read-log-lines', count),
  getEnvConfig: () => ipcRenderer.invoke('get-env-config'),
  saveEnvConfig: (config) => ipcRenderer.invoke('save-env-config', config),
  resetBotState: () => ipcRenderer.invoke('reset-bot-state'),
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
