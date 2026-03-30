const { app, BrowserWindow, ipcMain, protocol, net } = require('electron')
const path = require('path')
const url = require('url')

// Suppress harmless EGL/GPU driver log noise on macOS
app.commandLine.appendSwitch('log-level', '3')
app.commandLine.appendSwitch('enable-logging', 'false')

// Register custom protocol scheme BEFORE app.ready (required by Electron)
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-video', privileges: { stream: true, bypassCSP: true, supportFetchAPI: true } },
])

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
    width: 800,
    height: 1050,
    minWidth: 760,
    minHeight: 500,
    title: 'Noyecode Marketing AI',
    backgroundColor: '#f8f9fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    show: false,
  })

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
  // 0. Register custom protocol for serving local video/image files securely
  protocol.handle('local-video', (request) => {
    // URL: local-video:///Users/.../file.mp4?t=123 — extract path, strip query
    let filePath = request.url.slice('local-video://'.length)
    const qIdx = filePath.indexOf('?')
    if (qIdx !== -1) filePath = filePath.slice(0, qIdx)
    return net.fetch(url.pathToFileURL(filePath).href)
  })

  // 1. Register IPC handlers BEFORE window — avoids race condition
  //    where renderer sends calls before handlers exist
  const { registerBotHandlers } = require('./ipc/bot')
  const { registerPollerHandlers } = require('./ipc/poller')
  const { registerConfigHandlers } = require('./ipc/config')
  const { registerCompanyHandlers } = require('./ipc/company')
  const { registerMarketingHandlers } = require('./ipc/marketing')
  const { registerLogoHandlers } = require('./ipc/logo')
  const { registerBrochureHandlers } = require('./ipc/brochure')
  const { registerChatHandlers } = require('./ipc/chat')
  const { registerMetaAuthHandlers } = require('./ipc/meta-auth')
  const { registerInstagramHandlers } = require('./ipc/instagram')
  const { registerPublicationHandlers } = require('./ipc/publications')
  const { registerTikTokHandlers } = require('./ipc/tiktok')
  const { registerTikTokBusinessHandlers } = require('./ipc/tiktok-business')
  const { registerJobHandlers } = require('./ipc/jobs')

  registerBotHandlers(ipcMain)
  registerPollerHandlers(ipcMain)
  registerConfigHandlers(ipcMain)
  registerCompanyHandlers(ipcMain)
  registerMarketingHandlers(ipcMain)
  registerLogoHandlers(ipcMain)
  registerBrochureHandlers(ipcMain)
  registerChatHandlers(ipcMain)
  registerMetaAuthHandlers(ipcMain)
  registerInstagramHandlers(ipcMain)
  registerPublicationHandlers(ipcMain)
  registerTikTokHandlers(ipcMain)
  registerTikTokBusinessHandlers(ipcMain)

  // 2. Create window AFTER handlers are ready
  createWindow()

  // 3. Start log watchers (lightweight)
  const { startLogWatcher, startBotLogWatcher } = require('./log-watcher')
  startLogWatcher()
  startBotLogWatcher()

  // 4. Pre-warm SQLite schemas in background (non-blocking)
  setImmediate(() => {
    try {
      const { ensureCompanyDb } = require('./data/db')
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
