const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getBotStatus: () => ipcRenderer.invoke('get-bot-status'),
  getLastJob: () => ipcRenderer.invoke('get-last-job'),
  startBot: (profileName) => ipcRenderer.invoke('start-bot', profileName),
  stopBot: () => ipcRenderer.invoke('stop-bot'),
  startPoller: () => ipcRenderer.invoke('start-poller'),
  stopPoller: () => ipcRenderer.invoke('stop-poller'),
  isPollerRunning: () => ipcRenderer.invoke('is-poller-running'),
  readLogLines: (count) => ipcRenderer.invoke('read-log-lines', count),
  getEnvConfig: () => ipcRenderer.invoke('get-env-config'),
  onLogNewLines: (callback) => {
    const handler = (_event, lines) => callback(lines)
    ipcRenderer.on('log-new-lines', handler)
    return () => ipcRenderer.removeListener('log-new-lines', handler)
  },
})
