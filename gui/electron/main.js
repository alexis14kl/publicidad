const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const state = require('./state')
const { PROJECT_ROOT } = require('./config/project-paths')

// Lazy load heavy modules — only when needed, not at startup
let _killProcessTree = null
function getKillProcessTree() {
  if (!_killProcessTree) _killProcessTree = require('./utils/process').killProcessTree
  return _killProcessTree
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  state.mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 760,
    minHeight: 500,
    title: 'Bot Publicitario NoyeCode',
    backgroundColor: '#0a0a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    show: false,
  })

  state.mainWindow.maximize()

  if (process.env.VITE_DEV_SERVER_URL) {
    state.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    if (String(process.env.OPEN_DEVTOOLS || '').trim() === '1') {
      state.mainWindow.webContents.openDevTools()
    }
  } else {
    state.mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  state.mainWindow.once('ready-to-show', () => {
    state.mainWindow.show()
  })

  state.mainWindow.on('closed', () => {
    state.mainWindow = null
  })
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // 1. Create window FIRST — show UI as fast as possible
  createWindow()

  // 2. Register IPC handlers AFTER window created (lazy-loaded modules)
  const { registerBotHandlers } = require('./ipc/bot')
  const { registerPollerHandlers } = require('./ipc/poller')
  const { registerConfigHandlers } = require('./ipc/config')
  const { registerCompanyHandlers } = require('./ipc/company')
  const { registerMarketingHandlers } = require('./ipc/marketing')
  const { registerLogoHandlers } = require('./ipc/logo')

  registerBotHandlers(ipcMain)
  registerPollerHandlers(ipcMain)
  registerConfigHandlers(ipcMain)
  registerCompanyHandlers(ipcMain)
  registerMarketingHandlers(ipcMain)
  registerLogoHandlers(ipcMain)

  // 3. Start log watchers (lightweight)
  const { startLogWatcher, startBotLogWatcher } = require('./log-watcher')
  startLogWatcher()
  startBotLogWatcher()

  // 4. Pre-warm SQLite schemas in background (non-blocking)
  setImmediate(() => {
    try {
      const { ensureCompanyDb } = require('./company/db')
      for (const platform of ['facebook', 'instagram', 'linkedin', 'tiktok', 'googleads']) {
        try { ensureCompanyDb(platform) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (state.logWatcherInterval) clearInterval(state.logWatcherInterval)
  if (state.botLogWatcherInterval) clearInterval(state.botLogWatcherInterval)

  if (state.pollerProcess && state.pollerProcess.exitCode === null) {
    if (process.platform === 'darwin') {
      try { process.kill(state.pollerProcess.pid, 'SIGINT') } catch { getKillProcessTree()(state.pollerProcess.pid) }
    } else {
      getKillProcessTree()(state.pollerProcess.pid)
    }
  }

  if (process.platform !== 'darwin') app.quit()
})
