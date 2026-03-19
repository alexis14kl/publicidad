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

  try {
    await state.facebookVisualPage.evaluate(() => {
      const root = document.getElementById('noye-live-overlay')
      if (root) {
        root.remove()
      }
    })
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
