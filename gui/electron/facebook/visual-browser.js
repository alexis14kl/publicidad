const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { app } = require('electron')
const state = require('../state')
const { sleep } = require('../utils/helpers')
const { killProcessTree } = require('../utils/process')

function getChromeExecutablePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ]

  return candidates.find((candidate) => fs.existsSync(candidate)) || ''
}

function getPlaywrightChromium() {
  try {
    return require('playwright').chromium
  } catch {
    return null
  }
}

function listFacebookVisualBrowserPids(userDataDir) {
  try {
    const escaped = String(userDataDir || '').replace(/(["\\$`])/g, '\\$1')
    const output = execSync(`pgrep -fal "${escaped}"`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output
      .split('\n')
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+/)
        return match ? Number(match[1]) : 0
      })
      .filter((pid) => pid > 0)
  } catch {
    return []
  }
}

function cleanupFacebookVisualProfileLocks(userDataDir) {
  const pids = listFacebookVisualBrowserPids(userDataDir)
  for (const pid of pids) {
    killProcessTree(pid)
  }

  for (const lockName of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const lockPath = path.join(userDataDir, lockName)
    try {
      if (fs.existsSync(lockPath) || fs.lstatSync(lockPath)) {
        fs.rmSync(lockPath, { force: true })
      }
    } catch {
      // ignore stale lock cleanup errors
    }
  }
}

async function ensureFacebookVisualBrowser(actId) {
  if (state.facebookVisualPage && !state.facebookVisualPage.isClosed()) {
    return state.facebookVisualPage
  }

  const chromium = getPlaywrightChromium()
  if (!chromium) {
    throw new Error('Playwright no esta disponible para abrir el navegador visual.')
  }

  state.facebookVisualExecutable = getChromeExecutablePath()
  if (!state.facebookVisualExecutable) {
    throw new Error('No encontre Google Chrome o Brave instalados en /Applications.')
  }

  const userDataDir = path.join(app.getPath('userData'), 'facebook-visual-profile')
  cleanupFacebookVisualProfileLocks(userDataDir)
  await sleep(800)
  state.facebookVisualContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: state.facebookVisualExecutable,
    viewport: null,
    args: ['--start-maximized'],
  })

  state.facebookVisualContext.on('page', (page) => {
    state.facebookVisualPage = page
  })

  state.facebookVisualPage = state.facebookVisualContext.pages()[0] || await state.facebookVisualContext.newPage()
  await state.facebookVisualPage.bringToFront()
  await state.facebookVisualPage.goto(`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(actId)}`, {
    waitUntil: 'domcontentloaded',
  })
  return state.facebookVisualPage
}

async function logFacebookUiStep(emitMarketingUpdate, message, status = 'running') {
  emitMarketingUpdate({
    type: 'log',
    status,
    line: `[FACEBOOK-UI] ${message}`,
    summary: 'Automatizando Ads Manager en navegador normal.',
  })
}

async function pushFacebookVisualEvent(update) {
  if (!state.facebookVisualPage || state.facebookVisualPage.isClosed()) return
  const event = {
    title:
      update.type === 'log'
        ? 'Paso de ejecucion'
        : update.type === 'done'
          ? 'Resultado final'
          : 'Estado del flujo',
    text: update.line || update.summary || 'Sin detalle',
    status: update.status || (update.type === 'done' ? 'success' : 'running'),
    summary: update.summary || '',
    time: new Date().toLocaleTimeString('es-CO', { hour12: false }),
  }

  try {
    await state.facebookVisualPage.evaluate((payload) => {
      const ensureRoot = () => {
        let root = document.getElementById('noye-live-overlay')
        if (root) return root

        root = document.createElement('div')
        root.id = 'noye-live-overlay'
        root.style.position = 'fixed'
        root.style.top = '16px'
        root.style.right = '16px'
        root.style.width = '360px'
        root.style.maxHeight = '70vh'
        root.style.overflow = 'auto'
        root.style.zIndex = '2147483647'
        root.style.background = 'rgba(9, 14, 30, 0.94)'
        root.style.color = '#eef2ff'
        root.style.border = '1px solid rgba(96, 165, 250, 0.45)'
        root.style.borderRadius = '16px'
        root.style.boxShadow = '0 12px 40px rgba(0,0,0,0.35)'
        root.style.fontFamily = 'Arial, sans-serif'
        root.style.padding = '14px'
        root.style.pointerEvents = 'none'
        root.innerHTML = '<div style="font-weight:700;font-size:16px;margin-bottom:6px;">Noyecode Live</div><div id="noye-live-summary" style="font-size:12px;color:#cbd5e1;margin-bottom:10px;">Sin actividad</div><div id="noye-live-events" style="display:grid;gap:8px;"></div>'
        document.body.appendChild(root)
        return root
      }

      const root = ensureRoot()
      const summary = root.querySelector('#noye-live-summary')
      const events = root.querySelector('#noye-live-events')
      if (summary && payload.summary) {
        summary.textContent = payload.summary
      }
      if (events) {
        const item = document.createElement('div')
        item.style.borderLeft = `4px solid ${payload.status === 'success' ? '#34d399' : payload.status === 'warning' ? '#fbbf24' : payload.status === 'error' ? '#f87171' : '#60a5fa'}`
        item.style.padding = '8px 10px'
        item.style.borderRadius = '10px'
        item.style.background = 'rgba(15, 23, 42, 0.96)'
        item.innerHTML = `<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">${payload.time}</div><div style="font-size:13px;font-weight:700;margin-bottom:4px;">${payload.title}</div><div style="font-size:12px;line-height:1.4;white-space:pre-wrap;">${payload.text}</div>`
        events.prepend(item)
      }
    }, event)
  } catch {
    // Ignore overlay sync failures during navigation or auth redirects
  }
}

module.exports = {
  getChromeExecutablePath,
  getPlaywrightChromium,
  listFacebookVisualBrowserPids,
  cleanupFacebookVisualProfileLocks,
  ensureFacebookVisualBrowser,
  logFacebookUiStep,
  pushFacebookVisualEvent,
}
