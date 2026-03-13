const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const { spawn, exec, execFileSync } = require('child_process')

// Project root is two levels up from gui/electron/
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

// State
let mainWindow = null
let pollerProcess = null
let botProcess = null
let logWatcherInterval = null
let botLogWatcherInterval = null
let lastLogSize = 0
let lastBotLogSize = 0
let marketingRunInProgress = false
let marketingMonitorServer = null
let marketingMonitorPort = 0
let marketingMonitorClients = []
let marketingMonitorEvents = []
let marketingMonitorNextId = 1
let facebookVisualContext = null
let facebookVisualPage = null
let facebookVisualExecutable = ''

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
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

  // In dev mode load from vite server, in prod load built files
  if (process.env.VITE_DEV_SERVER_URL) {
    // Disable cache so Electron always gets fresh files from Vite
    mainWindow.webContents.session.clearCache()
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

function parseEnvFile(filePath) {
  const env = {}
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.substring(0, eqIndex).trim()
      let value = trimmed.substring(eqIndex + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      env[key] = value
    }
  } catch { /* ignore */ }
  return env
}

function getProjectEnv() {
  return { ...process.env, ...parseEnvFile(path.join(PROJECT_ROOT, '.env')) }
}

function findPython() {
  // Try common Python binary names
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python']

  for (const name of candidates) {
    try {
      const result = require('child_process').execSync(
        process.platform === 'win32' ? `where ${name}` : `which ${name}`,
        { timeout: 5000, encoding: 'utf-8' }
      )
      if (result.trim()) return name
    } catch { /* not found */ }
  }
  return null
}

function killProcessTree(pid) {
  if (!pid || pid <= 0) return
  try {
    if (process.platform === 'win32') {
      exec(`taskkill /F /T /PID ${pid}`)
    } else {
      // On Mac/Linux: kill process group
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        exec(`kill -9 ${pid}`)
      }
    }
  } catch { /* ignore */ }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeUiText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function ensureAbsoluteUrl(value, fallback = 'https://noyecode.com') {
  let raw = String(value || '').trim()
  if (!raw) {
    raw = fallback
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw.replace(/^\/+/, '')}`
  }
  return raw
}

function buildPrivacyPolicyUrl(baseUrl = '') {
  const absolute = ensureAbsoluteUrl(baseUrl || getProjectEnv().BUSINESS_WEBSITE || 'https://noyecode.com')
  try {
    return new URL('/privacidad', absolute).toString()
  } catch {
    return `${absolute.replace(/\/+$/, '')}/privacidad`
  }
}

function normalizeBudgetForUi(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) {
    throw new Error('El presupuesto maximo de la GUI no es valido para rellenar Ads Manager.')
  }
  return String(Number(digits))
}

function parseGuiDateParts(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    throw new Error(`La fecha "${value}" no tiene el formato esperado YYYY-MM-DD.`)
  }
  return {
    year: match[1],
    month: match[2],
    day: match[3],
  }
}

function formatGuiDateForSlash(value) {
  const { year, month, day } = parseGuiDateParts(value)
  return `${day}/${month}/${year}`
}

function formatGuiDateForLong(value) {
  const { year, month, day } = parseGuiDateParts(value)
  const date = new Date(`${year}-${month}-${day}T12:00:00-05:00`)
  return date.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildMarketingMonitorHtml() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Monitor de Construccion de Campana</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: Arial, sans-serif; background: #0b1020; color: #eef2ff; }
    .wrap { max-width: 1040px; margin: 0 auto; padding: 24px; }
    .hero { background: linear-gradient(135deg, #13203d, #1c3258); border: 1px solid #31456e; border-radius: 20px; padding: 20px; }
    .hero h1 { margin: 0 0 8px; font-size: 28px; }
    .hero p { margin: 0; color: #cbd5e1; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 16px; }
    .card { background: rgba(15, 23, 42, 0.86); border: 1px solid #243b63; border-radius: 16px; padding: 14px; }
    .label { display: block; color: #93c5fd; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
    #events { display: grid; gap: 12px; margin-top: 20px; }
    .event { background: rgba(15, 23, 42, 0.92); border: 1px solid #243b63; border-left: 5px solid #60a5fa; border-radius: 16px; padding: 14px; }
    .event.success { border-left-color: #34d399; }
    .event.warning { border-left-color: #fbbf24; }
    .event.error { border-left-color: #f87171; }
    .event.running { border-left-color: #60a5fa; }
    .event .time { color: #94a3b8; font-size: 12px; margin-bottom: 6px; }
    .event .title { font-weight: 700; margin-bottom: 4px; }
    .event .text { color: #e2e8f0; white-space: pre-wrap; }
    .empty { color: #94a3b8; padding: 18px 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Construccion paso a paso de la campana</h1>
      <p>Esta vista se actualiza en vivo mientras el orquestador y Meta Ads van armando el borrador.</p>
      <div class="meta">
        <div class="card"><span class="label">Estado</span><strong id="state">Esperando ejecucion</strong></div>
        <div class="card"><span class="label">Ultimo resumen</span><strong id="summary">Sin actividad</strong></div>
        <div class="card"><span class="label">Monitor</span><strong>Tiempo real</strong></div>
      </div>
    </section>
    <section id="events"><div class="empty">Aun no hay eventos.</div></section>
  </div>
  <script>
    const eventsEl = document.getElementById('events')
    const stateEl = document.getElementById('state')
    const summaryEl = document.getElementById('summary')
    function renderEvent(event) {
      const empty = eventsEl.querySelector('.empty')
      if (empty) empty.remove()
      const div = document.createElement('div')
      div.className = 'event ' + (event.status || 'running')
      div.innerHTML = '<div class="time">' + event.time + '</div>' +
        '<div class="title">' + event.title + '</div>' +
        '<div class="text">' + event.text + '</div>'
      eventsEl.prepend(div)
    }
    function applyEvent(event) {
      if (event.status) stateEl.textContent = event.status
      if (event.summary) summaryEl.textContent = event.summary
      renderEvent(event)
    }
    fetch('/snapshot').then(r => r.json()).then(data => {
      if (Array.isArray(data.events)) {
        data.events.forEach((event) => applyEvent(event))
      }
    }).catch(() => {})
    const source = new EventSource('/events')
    source.onmessage = (message) => {
      try {
        applyEvent(JSON.parse(message.data))
      } catch (_) {}
    }
  </script>
</body>
</html>`
}

function broadcastMarketingMonitorEvent(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`
  marketingMonitorClients = marketingMonitorClients.filter((response) => {
    if (response.destroyed || response.writableEnded) return false
    try {
      response.write(payload)
      return true
    } catch {
      return false
    }
  })
}

function pushMarketingBrowserEvent(update) {
  const title =
    update.type === 'log'
      ? 'Paso de ejecucion'
      : update.type === 'done'
        ? 'Resultado final'
        : 'Estado del flujo'
  const text = update.line || update.summary || 'Sin detalle'
  const event = {
    id: marketingMonitorNextId++,
    time: new Date().toLocaleTimeString('es-CO', { hour12: false }),
    title,
    text,
    status: update.status || (update.type === 'done' ? 'success' : 'running'),
    summary: update.summary || '',
  }
  marketingMonitorEvents.push(event)
  marketingMonitorEvents = marketingMonitorEvents.slice(-120)
  broadcastMarketingMonitorEvent(event)
}

async function ensureMarketingMonitorServer() {
  if (marketingMonitorServer && marketingMonitorPort) {
    return `http://127.0.0.1:${marketingMonitorPort}`
  }

  marketingMonitorServer = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      response.write('\n')
      marketingMonitorClients.push(response)
      request.on('close', () => {
        marketingMonitorClients = marketingMonitorClients.filter((client) => client !== response)
      })
      return
    }

    if (url.pathname === '/snapshot') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ events: marketingMonitorEvents.slice().reverse() }))
      return
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(buildMarketingMonitorHtml())
  })

  await new Promise((resolve, reject) => {
    marketingMonitorServer.once('error', reject)
    marketingMonitorServer.listen(0, '127.0.0.1', () => {
      const address = marketingMonitorServer.address()
      marketingMonitorPort = typeof address === 'object' && address ? address.port : 0
      resolve()
    })
  })

  return `http://127.0.0.1:${marketingMonitorPort}`
}

async function openMarketingBrowserMonitor() {
  const url = await ensureMarketingMonitorServer()
  await shell.openExternal(url)
  return url
}

async function pushFacebookVisualEvent(update) {
  if (!facebookVisualPage || facebookVisualPage.isClosed()) return
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
    await facebookVisualPage.evaluate((payload) => {
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

async function ensureFacebookVisualBrowser(actId) {
  if (facebookVisualPage && !facebookVisualPage.isClosed()) {
    return facebookVisualPage
  }

  const chromium = getPlaywrightChromium()
  if (!chromium) {
    throw new Error('Playwright no esta disponible para abrir el navegador visual.')
  }

  facebookVisualExecutable = getChromeExecutablePath()
  if (!facebookVisualExecutable) {
    throw new Error('No encontre Google Chrome o Brave instalados en /Applications.')
  }

  const userDataDir = path.join(app.getPath('userData'), 'facebook-visual-profile')
  cleanupFacebookVisualProfileLocks(userDataDir)
  await sleep(800)
  facebookVisualContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: facebookVisualExecutable,
    viewport: null,
    args: ['--start-maximized'],
  })

  facebookVisualContext.on('page', (page) => {
    facebookVisualPage = page
  })

  facebookVisualPage = facebookVisualContext.pages()[0] || await facebookVisualContext.newPage()
  await facebookVisualPage.bringToFront()
  await facebookVisualPage.goto(`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(actId)}`, {
    waitUntil: 'domcontentloaded',
  })
  return facebookVisualPage
}

async function logFacebookUiStep(message, status = 'running') {
  emitMarketingUpdate({
    type: 'log',
    status,
    line: `[FACEBOOK-UI] ${message}`,
    summary: 'Automatizando Ads Manager en navegador normal.',
  })
}

async function findVisibleLocator(page, builders, timeout = 1800) {
  for (const build of builders) {
    try {
      const locator = build(page).first()
      await locator.waitFor({ state: 'visible', timeout })
      return locator
    } catch {
      // Try the next selector.
    }
  }
  return null
}

function resolveCampaignObjectiveRule(preview, orchestrator = null) {
  const candidates = [
    { source: 'preview.objective', value: preview?.objective },
    { source: 'orchestrator.execution.campaignType', value: orchestrator?.execution?.campaignType },
    { source: 'orchestrator.adsAnalyst.objective', value: orchestrator?.adsAnalyst?.objective },
  ]

  for (const candidate of candidates) {
    const normalized = normalizeUiText(candidate.value)
    if (!normalized) continue
    if (
      normalized.includes('lead') ||
      normalized.includes('cliente potencial') ||
      normalized.includes('clientes potenciales') ||
      normalized.includes('instant form')
    ) {
      return {
        apiObjective: 'OUTCOME_LEADS',
        uiLabel: 'Clientes potenciales',
        uiAliases: ['Clientes potenciales', 'Lead generation', 'Leads'],
        source: candidate.source,
      }
    }
  }

  return {
    apiObjective: 'OUTCOME_LEADS',
    uiLabel: 'Clientes potenciales',
    uiAliases: ['Clientes potenciales', 'Lead generation', 'Leads'],
    source: 'runner.default.objective',
  }
}

async function clickObjectiveInCampaignModal(page, objectiveRule) {
  const modal = await findVisibleLocator(page, [
    (ctx) => ctx.locator('[role="dialog"]'),
    (ctx) => ctx.locator('[aria-modal="true"]'),
  ], 5000)

  const searchRoot = modal || page
  const objectivePattern = new RegExp(objectiveRule.uiAliases.join('|'), 'i')

  const directHit = await findVisibleLocator(searchRoot, [
    (ctx) => ctx.getByRole('radio', { name: objectivePattern }),
    (ctx) => ctx.locator('[role="radio"]').filter({ hasText: objectivePattern }),
    (ctx) => ctx.locator('label').filter({ hasText: objectivePattern }),
    (ctx) => ctx.getByText(objectivePattern),
  ], 2200)

  if (directHit) {
    try {
      await directHit.click({ timeout: 6000, force: true })
      return {
        ok: true,
        method: 'locator',
        label: objectiveRule.uiLabel,
      }
    } catch {
      // fall through to DOM strategy
    }
  }

  return page.evaluate((payload) => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const labels = (payload?.uiAliases || []).map(normalize).filter(Boolean)
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const roots = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter(isVisible)
    const root = roots.find((element) => {
      const text = normalize(element.textContent)
      return text.includes('crear nueva campana') || text.includes('elige un objetivo')
    }) || roots[0] || document.body

    const all = Array.from(root.querySelectorAll('*')).filter(isVisible)
    const pickClickable = (element) => {
      const chain = [
        element,
        element?.closest?.('[role="radio"]'),
        element?.closest?.('label'),
        element?.closest?.('button'),
        element?.closest?.('[role="button"]'),
        element?.closest?.('li'),
        element?.closest?.('div'),
      ].filter(Boolean)
      return chain.find((candidate) => candidate !== root && isVisible(candidate)) || null
    }

    for (const label of labels) {
      const match = all.find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return text === label || text.startsWith(label) || text.includes(label)
      })
      if (!match) continue
      const clickable = pickClickable(match)
      if (!clickable) continue
      clickable.click()
      return {
        ok: true,
        method: 'dom-click',
        label: payload.uiLabel,
        matchedText: String(match.innerText || match.textContent || '').trim(),
      }
    }

    return {
      ok: false,
      label: payload.uiLabel,
    }
  }, objectiveRule)
}

async function continueCampaignCreationModal(page) {
  const modal = await findVisibleLocator(page, [
    (ctx) => ctx.locator('[role="dialog"]'),
    (ctx) => ctx.locator('[aria-modal="true"]'),
  ], 5000)
  const searchRoot = modal || page
  const continueButton = await findVisibleLocator(searchRoot, [
    (ctx) => ctx.getByRole('button', { name: /continuar|continue|siguiente|next/i }),
    (ctx) => ctx.locator('button, [role="button"]').filter({ hasText: /continuar|continue|siguiente|next/i }),
  ], 3000)

  if (!continueButton) {
    throw new Error('No encontre el boton Continuar del modal de campaña.')
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await continueButton.isEnabled().catch(() => false)) {
      await continueButton.click({ timeout: 5000, force: true })
      return
    }
    await page.waitForTimeout(500)
  }

  throw new Error('El boton Continuar no se habilito despues de seleccionar el objetivo.')
}

async function clickBudgetTypeTrigger(page) {
  const trigger = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('button', { name: /presupuesto diario|presupuesto total|daily budget|lifetime budget/i }),
    (ctx) => ctx.locator('button, [role="button"], [aria-haspopup="listbox"], [aria-expanded]').filter({ hasText: /presupuesto diario|presupuesto total|daily budget|lifetime budget/i }),
  ], 2600)

  if (trigger) {
    await trigger.click({ timeout: 5000, force: true })
    return true
  }

  return page.evaluate(() => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const all = Array.from(document.querySelectorAll('button, [role="button"], [aria-haspopup="listbox"], [aria-expanded], div'))
      .filter(isVisible)
    const match = all.find((element) => {
      const text = normalize(element.innerText || element.textContent)
      return text === 'presupuesto diario' || text === 'daily budget' || text === 'presupuesto total' || text === 'lifetime budget'
    })
    if (!match) return false
    match.click()
    return true
  })
}

async function selectTotalBudgetMode(page) {
  const triggerClicked = await clickBudgetTypeTrigger(page)
  if (!triggerClicked) {
    throw new Error('No encontre el selector del tipo de presupuesto.')
  }

  await page.waitForTimeout(600)

  const totalOption = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('option', { name: /presupuesto total|lifetime budget/i }),
    (ctx) => ctx.getByRole('menuitem', { name: /presupuesto total|lifetime budget/i }),
    (ctx) => ctx.locator('[role="option"], [role="menuitem"], li, button, div').filter({ hasText: /presupuesto total|lifetime budget/i }),
  ], 2200)

  if (totalOption) {
    await totalOption.click({ timeout: 5000, force: true })
    return
  }

  const changed = await page.evaluate(() => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const match = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, button, div'))
      .filter(isVisible)
      .find((element) => {
        const text = normalize(element.innerText || element.textContent)
        return text === 'presupuesto total' || text === 'lifetime budget'
      })
    if (!match) return false
    match.click()
    return true
  })

  if (!changed) {
    throw new Error('No pude cambiar el selector a Presupuesto total.')
  }
}

async function fillCampaignBudgetValue(page, budgetValue) {
  const normalizedBudget = normalizeBudgetForUi(budgetValue)
  const input = await findVisibleLocator(page, [
    (ctx) => ctx.locator('input[inputmode="numeric"], input[aria-label*="presupuesto" i], input[placeholder*="presupuesto" i]'),
  ], 2600)

  if (input) {
    try {
      await input.click({ timeout: 5000, force: true })
      await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {})
      await input.fill(normalizedBudget)
      await input.press('Tab').catch(() => {})
      return
    } catch {
      // fall through to DOM setter
    }
  }

  const setByDom = await page.evaluate((value) => {
    const normalize = (text) => String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const candidates = Array.from(document.querySelectorAll('input'))
      .filter(isVisible)
      .filter((element) => {
        const label = normalize(element.getAttribute('aria-label'))
        const placeholder = normalize(element.getAttribute('placeholder'))
        const valueText = normalize(element.value)
        const parentText = normalize(element.closest('section, form, div')?.textContent)
        return (
          label.includes('presupuesto') ||
          placeholder.includes('presupuesto') ||
          /^\d[\d.,]*$/.test(valueText) ||
          parentText.includes('presupuesto')
        )
      })
    const target = candidates.find((element) => /^\d[\d.,]*$/.test(String(element.value || '').trim())) || candidates[0]
    if (!target) return false
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    if (descriptor?.set) {
      descriptor.set.call(target, value)
    } else {
      target.value = value
    }
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    target.dispatchEvent(new Event('blur', { bubbles: true }))
    return true
  }, normalizedBudget)

  if (!setByDom) {
    throw new Error('No pude escribir el presupuesto maximo en el campo monetario de la campaña.')
  }
}

async function clickCampaignEditorNext(page) {
  const nextButton = await findVisibleLocator(page, [
    (ctx) => ctx.getByRole('button', { name: /siguiente|next/i }),
    (ctx) => ctx.locator('button, [role="button"]').filter({ hasText: /siguiente|next/i }),
  ], 3000)
  if (!nextButton) {
    throw new Error('No encontre el boton Siguiente en el editor de campaña.')
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await nextButton.isEnabled().catch(() => false)) {
      await nextButton.click({ timeout: 5000, force: true })
      return
    }
    await page.waitForTimeout(450)
  }

  throw new Error('El boton Siguiente no se habilito despues de configurar la campaña.')
}

async function getAdsetSchedulePanel(page) {
  return await findVisibleLocator(page, [
    (ctx) => ctx.locator('section, div').filter({ hasText: /presupuesto y calendario|calendario/i }),
  ], 5000)
}

async function findScheduleInput(root, labelText, fallbackIndex = 1, timeout = 2600) {
  return await findVisibleLocator(root, [
    (ctx) => ctx.getByLabel(new RegExp(labelText, 'i')),
    (ctx) => ctx.locator(`xpath=(.//*[contains(normalize-space(.), "${labelText}")])[1]/following::input[${fallbackIndex}]`),
  ], timeout)
}

async function setDateInputValue(locator, guiDate) {
  const inputType = await locator.evaluate((element) => (element.getAttribute('type') || element.type || '').toLowerCase()).catch(() => '')
  const values = inputType === 'date'
    ? [String(guiDate).trim(), formatGuiDateForSlash(guiDate), formatGuiDateForLong(guiDate)]
    : [formatGuiDateForSlash(guiDate), formatGuiDateForLong(guiDate), String(guiDate).trim()]

  for (const value of values) {
    try {
      await locator.click({ timeout: 5000, force: true })
      await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {})
      await locator.fill(value)
      await locator.press('Tab').catch(() => {})
      return
    } catch {
      // Try the next representation.
    }
  }

  const finalValue = inputType === 'date' ? String(guiDate).trim() : formatGuiDateForSlash(guiDate)
  await locator.evaluate((element, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    if (descriptor?.set) {
      descriptor.set.call(element, value)
    } else {
      element.value = value
    }
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new Event('blur', { bubbles: true }))
  }, finalValue)
}

async function enableAdsetEndDate(root) {
  const endCheckbox = await findVisibleLocator(root, [
    (ctx) => ctx.getByRole('checkbox', { name: /definir una fecha de finalizacion/i }),
    (ctx) => ctx.locator('input[type="checkbox"]'),
  ], 2000)

  if (endCheckbox) {
    const checked = await endCheckbox.isChecked().catch(() => false)
    if (!checked) {
      await endCheckbox.click({ timeout: 5000, force: true }).catch(() => {})
    }
    return
  }

  const toggled = await root.evaluate(() => {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const isVisible = (element) => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const target = Array.from(document.querySelectorAll('label, div, span, button'))
      .filter(isVisible)
      .find((element) => normalize(element.innerText || element.textContent) === 'definir una fecha de finalizacion')
    if (!target) return false
    target.click()
    return true
  }).catch(() => false)

  if (!toggled) {
    throw new Error('No pude habilitar la fecha de finalización del conjunto de anuncios.')
  }
}

async function tryFacebookUiConfigureAdsetSchedule(preview) {
  if (!facebookVisualPage || facebookVisualPage.isClosed()) {
    return
  }

  const page = facebookVisualPage
  await page.bringToFront()
  await page.waitForTimeout(2400)

  const schedulePanel = await getAdsetSchedulePanel(page)
  if (!schedulePanel) {
    await logFacebookUiStep('No encontre la seccion Presupuesto y calendario del conjunto de anuncios.', 'warning')
    return
  }

  try {
    const startInput = await findScheduleInput(schedulePanel, 'Fecha de inicio', 1, 4000)
    if (!startInput) {
      throw new Error('No encontre el campo de Fecha de inicio.')
    }
    await setDateInputValue(startInput, preview?.startDate)
    await logFacebookUiStep(`Fecha de inicio del conjunto de anuncios ajustada a ${preview?.startDate}.`)
    await page.waitForTimeout(700)
  } catch (error) {
    await logFacebookUiStep(`No pude configurar la fecha de inicio del conjunto de anuncios: ${error.message || error}`, 'warning')
  }

  try {
    await enableAdsetEndDate(schedulePanel)
    await page.waitForTimeout(700)
    const endInput = await findScheduleInput(schedulePanel, 'Fecha de finalización', 1, 4000)
    if (!endInput) {
      throw new Error('No encontre el campo de Fecha de finalización.')
    }
    await setDateInputValue(endInput, preview?.endDate)
    await logFacebookUiStep(`Fecha de finalización del conjunto de anuncios ajustada a ${preview?.endDate}.`)
    await page.waitForTimeout(800)
  } catch (error) {
    await logFacebookUiStep(`No pude configurar la fecha de finalización del conjunto de anuncios: ${error.message || error}`, 'warning')
  }

  try {
    await clickCampaignEditorNext(page)
    await logFacebookUiStep('Conjunto de anuncios configurado; avanzando al siguiente paso.')
    await page.waitForTimeout(1800)
  } catch (error) {
    await logFacebookUiStep(`No pude avanzar despues de configurar el calendario del conjunto de anuncios: ${error.message || error}`, 'warning')
  }
}

async function tryFacebookUiConfigureCampaignEditor(preview) {
  if (!facebookVisualPage || facebookVisualPage.isClosed()) {
    return
  }

  const page = facebookVisualPage
  await page.bringToFront()
  await page.waitForTimeout(2200)

  const campaignName = buildDraftCampaignName(preview, preview?.orchestrator || null)

  try {
    const input = await findVisibleLocator(page, [
      (ctx) => ctx.getByLabel(/nombre de la campa|campaign name/i),
      (ctx) => ctx.locator('input[aria-label*="campa" i]'),
      (ctx) => ctx.locator('input[placeholder*="campa" i]'),
      (ctx) => ctx.locator('input[aria-label*="campaign" i]'),
      (ctx) => ctx.locator('input[placeholder*="campaign" i]'),
    ], 5000)
    if (!input) {
      throw new Error('No encontre el campo de nombre en el editor de campaña.')
    }
    await input.click({ timeout: 5000, force: true })
    await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {})
    await input.fill(campaignName)
    await input.press('Tab').catch(() => {})
    await logFacebookUiStep(`Nombre de campaña corregido en el editor: ${campaignName}`)
  } catch (error) {
    await logFacebookUiStep(`No pude corregir el nombre de campaña en el editor: ${error.message || error}`, 'warning')
  }

  try {
    await selectTotalBudgetMode(page)
    await logFacebookUiStep('Tipo de presupuesto cambiado a Presupuesto total.')
    await page.waitForTimeout(700)
    await fillCampaignBudgetValue(page, preview?.budget)
    await logFacebookUiStep(`Presupuesto total rellenado con el maximo de la GUI: ${normalizeBudgetForUi(preview?.budget)}.`)
    await page.waitForTimeout(900)
  } catch (error) {
    await logFacebookUiStep(`No pude configurar el presupuesto total en el editor: ${error.message || error}`, 'warning')
  }

  try {
    await clickCampaignEditorNext(page)
    await logFacebookUiStep('Campaña configurada; avanzando al siguiente paso del editor.')
    await page.waitForTimeout(1800)
  } catch (error) {
    await logFacebookUiStep(`No pude avanzar al siguiente paso del editor de campaña: ${error.message || error}`, 'warning')
  }
}

async function tryFacebookUiCreateCampaign(preview) {
  if (!facebookVisualPage || facebookVisualPage.isClosed()) {
    return
  }

  const page = facebookVisualPage
  await page.bringToFront()
  await page.waitForTimeout(1500)

  try {
    await logFacebookUiStep('Buscando boton Crear en Ads Manager...')
    const createButton = page.locator('button, div[role="button"], a').filter({
      hasText: /crear|create/i,
    }).first()
    await createButton.waitFor({ timeout: 10000 })
    await createButton.click({ timeout: 10000 })
    await logFacebookUiStep('Boton Crear presionado.')
    await page.waitForTimeout(1500)
  } catch (error) {
    await logFacebookUiStep(`No pude presionar el boton Crear: ${error.message || error}`, 'warning')
    return
  }

  try {
    const objectiveRule = resolveCampaignObjectiveRule(preview, preview?.orchestrator || null)
    await logFacebookUiStep(`Regla activa: seleccionar "${objectiveRule.uiLabel}" desde ${objectiveRule.source} antes de continuar.`)
    const objectiveSelection = await clickObjectiveInCampaignModal(page, objectiveRule)
    if (!objectiveSelection?.ok) {
      throw new Error(`No pude localizar la tarjeta del objetivo "${objectiveRule.uiLabel}" en el modal.`)
    }
    await logFacebookUiStep(`Objetivo de campaña seleccionado en la UI: ${objectiveRule.uiLabel}.`)
    await page.waitForTimeout(900)

    await continueCampaignCreationModal(page)
    await logFacebookUiStep('Modal de objetivo completado; avanzando al siguiente paso de creación.')
    await page.waitForTimeout(1800)
  } catch (error) {
    await logFacebookUiStep(`No pude completar el modal de objetivo de campaña: ${error.message || error}`, 'warning')
    return
  }

  try {
    const campaignName = buildDraftCampaignName(preview, preview?.orchestrator || null)
    const input = await findVisibleLocator(page, [
      (ctx) => ctx.getByLabel(/nombre de la campa|campaign name/i),
      (ctx) => ctx.locator('input[aria-label*="campa" i]'),
      (ctx) => ctx.locator('input[placeholder*="campa" i]'),
      (ctx) => ctx.locator('input[aria-label*="campaign" i]'),
      (ctx) => ctx.locator('input[placeholder*="campaign" i]'),
    ], 2200)
    if (!input) {
      throw new Error('No encontre un campo visible para el nombre de la campaña.')
    }
    await input.fill('')
    await input.fill(campaignName)
    await logFacebookUiStep(`Nombre de campana rellenado en UI: ${campaignName}`)
  } catch (error) {
    await logFacebookUiStep(`No pude rellenar el nombre de la campana en la UI: ${error.message || error}`, 'warning')
  }
}

function getFacebookAdsMcpInfo() {
  const env = getProjectEnv()
  const serverPath = path.join(PROJECT_ROOT, 'utils', 'AgenteMarketing', 'MCP', 'fb-ads-mcp-server', 'server.py')
  const helperPath = path.join(__dirname, 'fb_ads_mcp_run.py')
  const token =
    env.FB_ACCESS_TOKEN ||
    env.FACEBOOK_ACCESS_TOKEN ||
    env.META_ACCESS_TOKEN ||
    ''

  return {
    serverPath,
    helperPath,
    serverExists: fs.existsSync(serverPath),
    helperExists: fs.existsSync(helperPath),
    pythonBin: findPython(),
    token,
  }
}

function getMetaPageId() {
  const env = getProjectEnv()
  const configuredPageId = (
    env.FB_PAGE_ID ||
    env.FACEBOOK_PAGE_ID ||
    env.META_PAGE_ID ||
    '1675432206759799'
  )
  const targetAdAccountId = (
    env.FB_AD_ACCOUNT_ID ||
    env.FACEBOOK_AD_ACCOUNT_ID ||
    env.META_AD_ACCOUNT_ID ||
    '438871067037500'
  )

  const normalizedPageId = String(configuredPageId || '').replace(/^act_/, '').trim()
  const normalizedAdAccountId = String(targetAdAccountId || '').replace(/^act_/, '').trim()

  if (!normalizedPageId || normalizedPageId === normalizedAdAccountId) {
    return '1675432206759799'
  }

  return normalizedPageId
}

function getTargetAdAccountId() {
  const env = getProjectEnv()
  return (
    env.FB_AD_ACCOUNT_ID ||
    env.FACEBOOK_AD_ACCOUNT_ID ||
    env.META_AD_ACCOUNT_ID ||
    '438871067037500'
  )
}

function getMarketingImagesDir() {
  return path.join(PROJECT_ROOT, 'img_publicitarias')
}

function getLatestMarketingImage() {
  const imagesDir = getMarketingImagesDir()
  if (!fs.existsSync(imagesDir)) {
    return null
  }

  const imageFiles = fs.readdirSync(imagesDir)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .map((name) => {
      const fullPath = path.join(imagesDir, name)
      const stat = fs.statSync(fullPath)
      return { name, fullPath, mtimeMs: stat.mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  return imageFiles[0] || null
}

function getImageDimensionsWithSips(filePath) {
  const output = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], {
    encoding: 'utf-8',
  })
  const widthMatch = output.match(/pixelWidth:\s+(\d+)/)
  const heightMatch = output.match(/pixelHeight:\s+(\d+)/)
  const width = widthMatch ? Number(widthMatch[1]) : 0
  const height = heightMatch ? Number(heightMatch[1]) : 0
  return { width, height }
}

function prepareLatestMarketingImageAsset() {
  const latest = getLatestMarketingImage()
  if (!latest) {
    return null
  }

  const sourcePath = latest.fullPath
  let dimensions = { width: 0, height: 0 }
  try {
    dimensions = getImageDimensionsWithSips(sourcePath)
  } catch {
    return {
      sourcePath,
      preparedPath: sourcePath,
      fileName: latest.name,
      width: 0,
      height: 0,
      adjusted: false,
      adjustmentReason: 'No se pudieron leer las dimensiones; se usara el archivo original.',
      status: 'original',
    }
  }

  const targetWidth = 1200
  const targetHeight = 628
  const targetRatio = targetWidth / targetHeight
  const currentRatio = dimensions.width > 0 && dimensions.height > 0 ? dimensions.width / dimensions.height : 0
  const alreadyClose = currentRatio > 0 && Math.abs(currentRatio - targetRatio) < 0.03

  if (alreadyClose) {
    return {
      sourcePath,
      preparedPath: sourcePath,
      fileName: latest.name,
      width: dimensions.width,
      height: dimensions.height,
      adjusted: false,
      adjustmentReason: 'La imagen ya tiene una proporcion cercana a Facebook Feed.',
      status: 'ready',
    }
  }

  const preparedDir = path.join(getMarketingImagesDir(), '_prepared')
  fs.mkdirSync(preparedDir, { recursive: true })
  const preparedPath = path.join(preparedDir, `feed_${latest.name.replace(/\.(png|jpe?g|webp)$/i, '.png')}`)

  try {
    const cropWidth = currentRatio >= targetRatio
      ? Math.round(dimensions.height * targetRatio)
      : dimensions.width
    const cropHeight = currentRatio >= targetRatio
      ? dimensions.height
      : Math.round(dimensions.width / targetRatio)

    execFileSync('/usr/bin/sips', ['-c', String(cropHeight), String(cropWidth), sourcePath, '--out', preparedPath], {
      encoding: 'utf-8',
    })
    execFileSync('/usr/bin/sips', ['-z', String(targetHeight), String(targetWidth), preparedPath], {
      encoding: 'utf-8',
    })

    return {
      sourcePath,
      preparedPath,
      fileName: latest.name,
      width: dimensions.width,
      height: dimensions.height,
      adjusted: true,
      adjustmentReason: `El agente preparo una version Facebook Feed ${targetWidth}x${targetHeight} desde ${dimensions.width}x${dimensions.height}.`,
      status: 'prepared',
    }
  } catch (error) {
    return {
      sourcePath,
      preparedPath: sourcePath,
      fileName: latest.name,
      width: dimensions.width,
      height: dimensions.height,
      adjusted: false,
      adjustmentReason: `No se pudo preparar la imagen automaticamente: ${error.message || error}`,
      status: 'fallback_original',
    }
  }
}

function validateMetaToken(token) {
  return new Promise((resolve) => {
    if (!token) {
      resolve({
        ok: false,
        reason: 'No hay token configurado en FB_ACCESS_TOKEN, FACEBOOK_ACCESS_TOKEN o META_ACCESS_TOKEN.',
      })
      return
    }

    const url = new URL('https://graph.facebook.com/v22.0/me/adaccounts')
    url.searchParams.set('limit', '1')
    url.searchParams.set('fields', 'id,name')
    url.searchParams.set('access_token', token)

    const request = https.get(
      url,
      {
        timeout: 8000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'noyecode-facebook-ads-preflight/1.0',
        },
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          try {
            const data = body ? JSON.parse(body) : {}
            if (response.statusCode >= 200 && response.statusCode < 300 && !data.error) {
              const count = Array.isArray(data.data) ? data.data.length : 0
              resolve({
                ok: true,
                reason: count > 0
                  ? `Token valido. Meta devolvio ${count} cuenta(s) en la verificacion rapida.`
                  : 'Token valido. La verificacion contra Meta respondio correctamente.',
              })
              return
            }

            const message = data?.error?.message || `HTTP ${response.statusCode}`
            resolve({
              ok: false,
              reason: `Meta rechazo la verificacion del token: ${message}`,
            })
          } catch (error) {
            resolve({
              ok: false,
              reason: `No se pudo interpretar la respuesta de Meta: ${error.message || error}`,
            })
          }
        })
      }
    )

    request.on('timeout', () => {
      request.destroy(new Error('timeout'))
    })

    request.on('error', (error) => {
      resolve({
        ok: false,
        reason: `No se pudo verificar Meta Graph API: ${error.message || error}`,
      })
    })
  })
}

function facebookApiRequest(method, pathName, params = {}, token = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://graph.facebook.com/v22.0/${pathName.replace(/^\/+/, '')}`)
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'noyecode-facebook-ads-mcp/1.0',
    }

    let body = null
    if (method === 'GET') {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value))
        }
      }
      if (token) {
        url.searchParams.set('access_token', token)
      }
    } else {
      const form = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          form.set(key, typeof value === 'string' ? value : JSON.stringify(value))
        }
      }
      if (token) {
        form.set('access_token', token)
      }
      body = form.toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      headers['Content-Length'] = Buffer.byteLength(body)
    }

    const request = https.request(
      url,
      { method, timeout: 15000, headers },
      (response) => {
        let raw = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          raw += chunk
        })
        response.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : {}
            if (response.statusCode >= 200 && response.statusCode < 300 && !data.error) {
              resolve(data)
              return
            }
            const errorMessage = [
              data?.error?.message || `HTTP ${response.statusCode}`,
              data?.error?.error_user_title ? `title=${data.error.error_user_title}` : '',
              data?.error?.error_user_msg ? `detail=${data.error.error_user_msg}` : '',
              data?.error?.error_subcode ? `subcode=${data.error.error_subcode}` : '',
              `path=${pathName}`,
            ].filter(Boolean).join(' | ')
            reject(new Error(errorMessage))
          } catch (error) {
            reject(new Error(`Respuesta invalida de Meta: ${error.message || error}`))
          }
        })
      }
    )

    request.on('timeout', () => {
      request.destroy(new Error('timeout'))
    })
    request.on('error', reject)
    if (body) {
      request.write(body)
    }
    request.end()
  })
}

async function getPrimaryAdAccount(token) {
  const result = await facebookApiRequest(
    'GET',
    'me/adaccounts',
    {
      limit: 1,
      fields: 'id,account_id,name,account_status,currency',
    },
    token
  )

  const account = Array.isArray(result?.data) ? result.data[0] : null
  if (!account) {
    throw new Error('El token no devolvio cuentas publicitarias disponibles.')
  }
  return account
}

async function getAdAccountByName(token, accountHint) {
  const result = await facebookApiRequest(
    'GET',
    'me/adaccounts',
    {
      limit: 100,
      fields: 'id,account_id,name,account_status,currency',
    },
    token
  )

  const accounts = Array.isArray(result?.data) ? result.data : []
  const normalizedHint = String(accountHint || '').trim().toLowerCase()
  const exact = accounts.find((account) => String(account?.name || '').trim().toLowerCase() === normalizedHint)
  if (exact) return exact

  const partial = accounts.find((account) => String(account?.name || '').toLowerCase().includes(normalizedHint))
  if (partial) return partial

  if (accounts.length > 0) {
    throw new Error(`No encontre la cuenta publicitaria "${accountHint}" en el token actual.`)
  }
  throw new Error('El token no devolvio cuentas publicitarias disponibles.')
}

async function getAdAccountById(token, accountId) {
  const result = await facebookApiRequest(
    'GET',
    'me/adaccounts',
    {
      limit: 100,
      fields: 'id,account_id,name,account_status,currency',
    },
    token
  )

  const accounts = Array.isArray(result?.data) ? result.data : []
  const normalizedTarget = String(accountId || '').replace(/^act_/, '').trim()
  const exact = accounts.find((account) => String(account?.account_id || '').trim() === normalizedTarget)
  if (exact) return exact

  if (accounts.length > 0) {
    throw new Error(`No encontre la cuenta publicitaria con ID ${normalizedTarget} en el token actual.`)
  }
  throw new Error('El token no devolvio cuentas publicitarias disponibles.')
}

function getDefaultMarketingSegment() {
  return {
    key: 'logistics-ops-co',
    shortLabel: 'Logistics Ops CO',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Logistics & Distribution',
    role: 'Operations Manager',
    companySize: '20-80 employees',
    pain: 'Manual dispatch assignment, route updates by WhatsApp, and late delivery notifications.',
    consequence: 'Delivery delays, SLA breaches, and a high coordination cost.',
    trigger: 'Active hiring in operations, expansion to new cities, or rising shipment volume.',
    affectedKpi: 'On-time delivery, cost per route, and claims rate.',
    categoryStatement: 'Specialists in eliminating operational friction for growth-stage companies before chaos scales.',
    strategicAngle: 'Operational chaos in dispatch and tracking is usually a systems problem, not a staffing problem.',
    primaryCta: 'If useful, I can share a 3-bullet diagnosis for dispatch + tracking in 24h.',
    hook: 'Reduce dispatch friction before delivery chaos scales.',
    visualReference: 'Operations team in a Colombian logistics company, dispatch board, route tracking dashboard, warehouse activity, premium B2B tech aesthetic.',
    ageMin: 24,
    ageMax: 54,
  }
}

function buildAudienceSummary(segment = getDefaultMarketingSegment()) {
  return `${segment.country} | ${segment.industry} | ${segment.role} | ${segment.companySize}`
}

function buildTargetingSummary(segment = getDefaultMarketingSegment()) {
  return `${segment.country}, ${segment.role}, ${segment.industry}, ${segment.ageMin}-${segment.ageMax}`
}

function buildLeadTargeting(orchestrator = null) {
  const segment = orchestrator?.execution?.segment || getDefaultMarketingSegment()
  return {
    geo_locations: {
      countries: [segment.countryCode || 'CO'],
    },
    age_min: segment.ageMin || 24,
    age_max: segment.ageMax || 54,
  }
}

function buildLeadFormSpec(preview, orchestrator) {
  const segment = orchestrator?.execution?.segment || getDefaultMarketingSegment()
  const websiteUrl = ensureAbsoluteUrl(preview?.url || getProjectEnv().BUSINESS_WEBSITE || 'https://noyecode.com')
  return {
    page_id: String(orchestrator?.execution?.pageId || getMetaPageId()).trim(),
    form_id: String(preview?.selectedLeadgenFormId || '').trim(),
    discover: true,
    create_if_missing: true,
    name: `Formulario | ${segment.shortLabel} | ${preview.startDate} -> ${preview.endDate}`,
    locale: 'es_LA',
    required_fields: ['full_name', 'email', 'phone_number'],
    follow_up_action_url: websiteUrl,
    privacy_policy_url: buildPrivacyPolicyUrl(websiteUrl),
    privacy_policy_link_text: 'Politica de privacidad',
  }
}

function buildDraftCampaignName(preview, orchestrator = null) {
  const segmentLabel = orchestrator?.execution?.segment?.shortLabel || getDefaultMarketingSegment().shortLabel
  return `Lead Gen | ${segmentLabel} | ${preview.startDate} -> ${preview.endDate}`
}

function buildOrchestratorPlan(preview, segment = getDefaultMarketingSegment()) {
  return {
    task: `Configurar borrador de campana Facebook Ads para ${segment.role} de ${segment.industry} en ${segment.country}, con presupuesto maximo ${preview.budget} entre ${preview.startDate} y ${preview.endDate}.`,
    agent: 'orchestrator',
    reason: 'Coordina ads-analyst, image-creator y marketing antes de enviar la configuracion a Meta Ads.',
    cost: 'medio',
    approvedByUser: true,
  }
}

function runLocalMarketingOrchestrator(preview) {
  const segment = getDefaultMarketingSegment()
  const plan = buildOrchestratorPlan(preview, segment)
  const pageId = getMetaPageId()
  const selectedImage = preview?.imageAsset || null
  const adsAnalyst = {
    platform: 'Facebook Ads',
    format: 'Imagen unica para Lead Ads',
    objective: 'Leads',
    audience: buildAudienceSummary(segment),
    hook: segment.hook,
    copy:
      `Si tu operacion de despacho sigue coordinandose entre WhatsApp, hojas de calculo y sistemas desconectados, Noyecode te ayuda a modernizar tracking, alertas y handoffs para reducir retrasos, errores y costo operativo. ${segment.primaryCta}`,
    cta: segment.primaryCta,
    visualReference: segment.visualReference,
    industry: segment.industry,
    role: segment.role,
    pain: segment.pain,
    consequence: segment.consequence,
    trigger: segment.trigger,
    strategicAngle: segment.strategicAngle,
    assumptions: [
      `Se tomo el micro-segmento predefinido ${segment.shortLabel} porque la UI actual solo solicita presupuesto y fechas.`,
      'La promesa se centra en eficiencia operativa y modernizacion, sin metricas inventadas.',
    ],
  }

  const imageCreator = {
    dimensions: '1200x628',
    style: 'Premium tech corporativo',
    prompt:
      'Create a premium Facebook lead ad image for Noyecode focused on Colombian logistics operations managers. Show a LATAM dispatch team, route tracking dashboard, delivery flow automation, clean orange-accent brand palette, premium B2B lighting, realistic warehouse-office hybrid environment, no clutter, no tiny unreadable text, landscape 1200x628.',
    status: selectedImage?.preparedPath ? 'asset_local_listo' : 'brief_listo',
    selectedAsset: selectedImage
      ? {
        sourcePath: selectedImage.sourcePath,
        preparedPath: selectedImage.preparedPath,
        adjusted: selectedImage.adjusted,
        adjustmentReason: selectedImage.adjustmentReason,
      }
      : null,
  }

  const marketing = {
    status: 'approved_with_assumptions',
    verdict: 'APROBADO para borrador',
    notes: [
      `CTA de baja friccion alineado con el segmento ${segment.shortLabel}.`,
      `Narrativa B2B centrada en ${segment.pain.toLowerCase()}`,
      'Pendiente activo visual final y leadgen_form_id para completar creative y anuncio.',
    ],
    compliance: {
      specialAdCategories: [],
      categoryStatement: segment.categoryStatement,
    },
  }
  const objectiveRule = resolveCampaignObjectiveRule(preview, {
    execution: { campaignType: 'Instant Form', segment },
    adsAnalyst,
  })

  return {
    plan,
    adsAnalyst,
    imageCreator,
    marketing,
    execution: {
      accountHint: `act_${getTargetAdAccountId()}`,
      accountId: getTargetAdAccountId(),
      pageId,
      campaignType: 'Instant Form',
      budgetCap: preview.budget,
      formFields: preview.formFields,
      segment,
      targetingSummary: buildTargetingSummary(segment),
      objectiveUiLabel: objectiveRule.uiLabel,
      apiObjective: objectiveRule.apiObjective,
    },
  }
}

function toMetaMoney(value) {
  const numeric = Number(String(value || '').replace(',', '.'))
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('El presupuesto ingresado no es valido para Meta Ads.')
  }
  return String(Math.round(numeric))
}

function toMetaDateTime(dateValue, endOfDay = false) {
  const suffix = endOfDay ? 'T23:59:00-0500' : 'T00:00:00-0500'
  return `${dateValue}${suffix}`
}

async function createDraftCampaign(preview, token, accountHint = '') {
  const normalizedHint = String(accountHint || '').trim()
  const account = normalizedHint
    ? /^act?_?\d+$/.test(normalizedHint.replace(/^act_/, 'act'))
      ? await getAdAccountById(token, normalizedHint)
      : await getAdAccountByName(token, normalizedHint)
    : await getPrimaryAdAccount(token)
  const campaignName = buildDraftCampaignName(preview)
  const accountNode = String(account.id || '').trim()
  if (!accountNode) {
    throw new Error('Meta no devolvio el identificador de la cuenta publicitaria.')
  }

  let created
  try {
    created = await facebookApiRequest(
      'POST',
      `${accountNode}/campaigns`,
      {
        name: campaignName,
        objective: 'OUTCOME_LEADS',
        status: 'PAUSED',
        is_adset_budget_sharing_enabled: false,
        special_ad_categories: [],
      },
      token
    )
  } catch (error) {
    throw new Error(
      `Fallo creando campaign en ${accountNode} | objective=OUTCOME_LEADS | status=PAUSED | is_adset_budget_sharing_enabled=false | ${error.message || error}`
    )
  }

  return {
    account,
    campaignId: created?.id || '',
    campaignName,
  }
}

async function createDraftAdSet(preview, token, creation) {
  const accountNode = String(creation?.account?.id || '').trim()
  const campaignId = String(creation?.campaignId || '').trim()
  if (!accountNode || !campaignId) {
    throw new Error('No tengo datos suficientes para crear el conjunto de anuncios.')
  }

  const adsetName = `Ad Set Borrador | Leads CO | ${preview.startDate} -> ${preview.endDate}`
  let created
  try {
    created = await facebookApiRequest(
      'POST',
      `${accountNode}/adsets`,
      {
        name: adsetName,
        campaign_id: campaignId,
        lifetime_budget: toMetaMoney(preview.budget),
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LEAD_GENERATION',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        destination_type: 'ON_AD',
        status: 'PAUSED',
        start_time: toMetaDateTime(preview.startDate, false),
        end_time: toMetaDateTime(preview.endDate, true),
        promoted_object: {
          page_id: getMetaPageId(),
        },
        targeting: {
          geo_locations: {
            countries: ['CO'],
          },
          age_min: 18,
          age_max: 65,
        },
      },
      token
    )
  } catch (error) {
    throw new Error(
      `Fallo creando adset en ${accountNode} | campaign_id=${campaignId} | budget=${preview.budget} | page_id=${getMetaPageId()} | ${error.message || error}`
    )
  }

  return {
    adsetId: created?.id || '',
    adsetName,
    targetingSummary: 'Colombia, 18-65, segmentacion amplia',
  }
}

async function listLeadgenForms(token, pageId) {
  const result = await facebookApiRequest(
    'GET',
    `${String(pageId || '').trim()}/leadgen_forms`,
    {
      fields: 'id,name,status',
      limit: 50,
    },
    token
  )

  const forms = Array.isArray(result?.data) ? result.data : []
  return forms
    .map((form) => ({
      id: String(form?.id || ''),
      name: String(form?.name || 'Sin nombre'),
      status: String(form?.status || 'UNKNOWN'),
    }))
    .filter((form) => form.id)
}

function normalizeLeadQuestionKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

function summarizeLeadgenRequirements(questions) {
  const keys = new Set((questions || []).map((question) => normalizeLeadQuestionKey(question.key)))
  const hasEmail = keys.has('email')
  const hasPhone = keys.has('phone_number') || keys.has('phone')
  const hasFirstName = keys.has('first_name')
  const hasLastName = keys.has('last_name')
  const hasFullName = keys.has('full_name')

  return {
    hasEmail,
    hasPhone,
    hasFirstName,
    hasLastName,
    hasFullName,
    exactMatch: hasEmail && hasPhone && hasFullName,
    acceptableMatch: hasEmail && hasPhone && hasFirstName && hasLastName,
  }
}

async function getLeadgenFormQuestions(token, formId) {
  const result = await facebookApiRequest(
    'GET',
    String(formId || '').trim(),
    {
      fields: 'id,name,questions',
    },
    token
  )

  const questions = Array.isArray(result?.questions) ? result.questions : []
  return questions.map((question) => ({
    key: normalizeLeadQuestionKey(question?.key || question?.type || ''),
    label: String(question?.label || question?.key || question?.type || 'Sin etiqueta'),
    type: String(question?.type || ''),
  }))
}

async function enrichLeadgenFormsWithQuestions(token, forms) {
  const enriched = []

  for (const form of forms) {
    try {
      const questions = await getLeadgenFormQuestions(token, form.id)
      const requirements = summarizeLeadgenRequirements(questions)
      enriched.push({
        ...form,
        questions,
        requirements,
      })
    } catch (error) {
      enriched.push({
        ...form,
        questions: [],
        requirements: summarizeLeadgenRequirements([]),
        questionsError: error?.message || String(error),
      })
    }
  }

  return enriched
}

function selectBestLeadgenForm(forms) {
  const allForms = Array.isArray(forms) ? forms : []
  const exact = allForms.find((form) => form?.requirements?.exactMatch)
  if (exact) {
    return {
      id: exact.id,
      name: exact.name,
      matchType: 'exact',
      selectionReason: 'Seleccionado automaticamente por cumplir exacto con nombre completo, correo electronico y telefono movil.',
    }
  }

  const acceptable = allForms.find((form) => form?.requirements?.acceptableMatch)
  if (acceptable) {
    return {
      id: acceptable.id,
      name: acceptable.name,
      matchType: 'acceptable',
      selectionReason: 'No hubo coincidencia exacta; se encontro un formulario con nombre y apellido separados, correo y telefono.',
    }
  }

  return {
    id: '',
    name: '',
    matchType: 'none',
    selectionReason: 'No se encontro un formulario que cumpla con los campos requeridos.',
  }
}

function buildDraftCreativeConfig(preview, orchestrator) {
  const leadgenFormId = String(preview?.selectedLeadgenFormId || '').trim()
  const pageId = String(orchestrator?.execution?.pageId || getMetaPageId()).trim()
  const imageAssetPath = String(preview?.imageAsset?.preparedPath || '').trim()
  if (!leadgenFormId || !pageId || !imageAssetPath) {
    return null
  }

  return {
    pageId,
    leadgenFormId,
    imageAssetPath,
    callToActionType: 'SIGN_UP',
    objective: 'OUTCOME_LEADS',
    message: orchestrator?.adsAnalyst?.copy || '',
    headline: orchestrator?.adsAnalyst?.hook || '',
    description: orchestrator?.adsAnalyst?.strategicAngle || '',
    link: preview?.url || '',
    callToActionValue: {
      lead_gen_form_id: leadgenFormId,
    },
    objectStorySpec: {
      page_id: pageId,
      link_data: {
        link: preview?.url || '',
        message: orchestrator?.adsAnalyst?.copy || '',
        name: orchestrator?.adsAnalyst?.hook || '',
        description: orchestrator?.adsAnalyst?.strategicAngle || '',
        image_hash: 'PENDIENTE_UPLOAD_META',
        call_to_action: {
          type: 'SIGN_UP',
          value: {
            lead_gen_form_id: leadgenFormId,
          },
        },
      },
    },
    adDraftStatus: 'configured_waiting_asset',
  }
}

function buildDraftAdConfig(preview, creation) {
  const adsetId = String(creation?.adsetId || '').trim()
  const leadgenFormId = String(preview?.creativeDraftConfig?.leadgenFormId || '').trim()
  if (!adsetId || !leadgenFormId) {
    return null
  }

  return {
    adsetId,
    adName: `Ad Borrador | Lead Form ${leadgenFormId}`,
    status: 'PAUSED',
    creativeStatus: 'waiting_image_asset',
    tracking: {
      leadgen_form_id: leadgenFormId,
      page_id: String(preview?.creativeDraftConfig?.pageId || ''),
    },
  }
}

function buildLeadCampaignRunnerContext(preview, orchestrator) {
  const segment = orchestrator?.execution?.segment || getDefaultMarketingSegment()
  const objectiveRule = resolveCampaignObjectiveRule(preview, orchestrator)
  return {
    preview: {
      url: String(preview?.url || '').trim(),
      budget: String(preview?.budget || '').trim(),
      startDate: String(preview?.startDate || '').trim(),
      endDate: String(preview?.endDate || '').trim(),
      formFields: Array.isArray(preview?.formFields)
        ? preview.formFields.map((field) => String(field || '').trim()).filter(Boolean)
        : [],
    },
    execution: {
      accountHint: String(orchestrator?.execution?.accountHint || '').trim(),
      pageId: String(orchestrator?.execution?.pageId || getMetaPageId()).trim(),
      campaignType: String(orchestrator?.execution?.campaignType || '').trim(),
      targetingSummary: String(orchestrator?.execution?.targetingSummary || '').trim(),
      objectiveUiLabel: objectiveRule.uiLabel,
      apiObjective: objectiveRule.apiObjective,
      formFields: Array.isArray(orchestrator?.execution?.formFields)
        ? orchestrator.execution.formFields.map((field) => String(field || '').trim()).filter(Boolean)
        : [],
    },
    segment: {
      shortLabel: String(segment?.shortLabel || '').trim(),
      country: String(segment?.country || '').trim(),
      countryCode: String(segment?.countryCode || '').trim(),
      industry: String(segment?.industry || '').trim(),
      role: String(segment?.role || '').trim(),
      companySize: String(segment?.companySize || '').trim(),
      pain: String(segment?.pain || '').trim(),
      consequence: String(segment?.consequence || '').trim(),
      trigger: String(segment?.trigger || '').trim(),
      strategicAngle: String(segment?.strategicAngle || '').trim(),
      primaryCta: String(segment?.primaryCta || '').trim(),
      hook: String(segment?.hook || '').trim(),
      ageMin: Number(segment?.ageMin) || 0,
      ageMax: Number(segment?.ageMax) || 0,
    },
    agents: {
      orchestrator: {
        task: String(orchestrator?.plan?.task || '').trim(),
        reason: String(orchestrator?.plan?.reason || '').trim(),
      },
      adsAnalyst: {
        objective: String(orchestrator?.adsAnalyst?.objective || '').trim(),
        audience: String(orchestrator?.adsAnalyst?.audience || '').trim(),
        hook: String(orchestrator?.adsAnalyst?.hook || '').trim(),
        copy: String(orchestrator?.adsAnalyst?.copy || '').trim(),
        cta: String(orchestrator?.adsAnalyst?.cta || '').trim(),
        strategicAngle: String(orchestrator?.adsAnalyst?.strategicAngle || '').trim(),
        industry: String(orchestrator?.adsAnalyst?.industry || '').trim(),
        role: String(orchestrator?.adsAnalyst?.role || '').trim(),
        pain: String(orchestrator?.adsAnalyst?.pain || '').trim(),
        trigger: String(orchestrator?.adsAnalyst?.trigger || '').trim(),
      },
      imageCreator: {
        dimensions: String(orchestrator?.imageCreator?.dimensions || '').trim(),
        style: String(orchestrator?.imageCreator?.style || '').trim(),
        prompt: String(orchestrator?.imageCreator?.prompt || '').trim(),
      },
      marketing: {
        status: String(orchestrator?.marketing?.status || '').trim(),
        verdict: String(orchestrator?.marketing?.verdict || '').trim(),
        notes: Array.isArray(orchestrator?.marketing?.notes)
          ? orchestrator.marketing.notes.map((note) => String(note || '').trim()).filter(Boolean)
          : [],
        specialAdCategories: Array.isArray(orchestrator?.marketing?.compliance?.specialAdCategories)
          ? orchestrator.marketing.compliance.specialAdCategories.map((value) => String(value || '').trim()).filter(Boolean)
          : [],
        categoryStatement: String(orchestrator?.marketing?.compliance?.categoryStatement || '').trim(),
      },
    },
  }
}

function buildLeadCampaignBundleSpec(preview, orchestrator) {
  const segment = orchestrator?.execution?.segment || getDefaultMarketingSegment()
  const objectiveRule = resolveCampaignObjectiveRule(preview, orchestrator)
  const campaignName = buildDraftCampaignName(preview, orchestrator)
  const adsetName = `Ad Set | ${segment.shortLabel} | ${preview.startDate} -> ${preview.endDate}`
  const pageId = String(orchestrator?.execution?.pageId || getMetaPageId()).trim()
  const selectedLeadgenFormId = String(preview?.selectedLeadgenFormId || '').trim()
  const creativeDraft = selectedLeadgenFormId
    ? buildDraftCreativeConfig({ ...preview, selectedLeadgenFormId }, orchestrator)
    : null
  const leadFormSpec = buildLeadFormSpec(preview, orchestrator)

  return {
    ad_account_id: String(orchestrator?.execution?.accountHint || `act_${getTargetAdAccountId()}`),
    account_name: orchestrator?.execution?.accountHint || `act_${getTargetAdAccountId()}`,
    page_id: pageId,
    campaign: {
      name: campaignName,
      objective: objectiveRule.apiObjective,
      ui_objective_label: objectiveRule.uiLabel,
      status: 'PAUSED',
      is_adset_budget_sharing_enabled: false,
      special_ad_categories: orchestrator?.marketing?.compliance?.specialAdCategories || [],
    },
    adset: {
      name: adsetName,
      lifetime_budget: toMetaMoney(preview.budget),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'LEAD_GENERATION',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: 'ON_AD',
      status: 'PAUSED',
      start_time: toMetaDateTime(preview.startDate, false),
      end_time: toMetaDateTime(preview.endDate, true),
      promoted_object: pageId
        ? {
          page_id: pageId,
        }
        : undefined,
      targeting: buildLeadTargeting(orchestrator),
    },
    lead_form: leadFormSpec,
    creative: {
      name: `Creative | ${segment.shortLabel} | ${selectedLeadgenFormId || 'auto-form'}`,
      message: orchestrator?.adsAnalyst?.copy || '',
      headline: orchestrator?.adsAnalyst?.hook || '',
      description: orchestrator?.adsAnalyst?.strategicAngle || '',
      link: preview?.url || '',
      call_to_action_type: 'SIGN_UP',
      image_path: String(preview?.imageAsset?.preparedPath || '').trim(),
      object_story_spec: creativeDraft?.objectStorySpec || null,
    },
    ad: {
      name: `Ad | ${segment.shortLabel} | ${selectedLeadgenFormId || 'auto-form'}`,
      status: 'PAUSED',
    },
    runner_context: buildLeadCampaignRunnerContext(preview, orchestrator),
  }
}

function applyMcpBundleResultToPreview(preview, orchestrator, bundleResult) {
  const forms = Array.isArray(bundleResult?.leadgen_forms) ? bundleResult.leadgen_forms : []
  const selectedForm = bundleResult?.selected_leadgen_form || {}
  const creationState = {
    account: bundleResult?.account || null,
    campaignId: String(bundleResult?.campaign?.id || '').trim(),
    campaignName: String(bundleResult?.campaign?.name || '').trim(),
    adsetId: String(bundleResult?.adset?.id || '').trim(),
    adsetName: String(bundleResult?.adset?.name || '').trim(),
    targetingSummary: String(bundleResult?.adset?.targeting_summary || orchestrator?.execution?.targetingSummary || buildTargetingSummary()),
    adsetError: String(bundleResult?.adset?.error || '').trim(),
    adsetDeferredToUi: Boolean(bundleResult?.adset?.deferred_to_ui),
  }

  preview.leadgenFormsLoaded = true
  preview.leadgenForms = forms
  preview.selectedLeadgenFormId = String(selectedForm?.id || '').trim()
  preview.selectedLeadgenFormName = String(selectedForm?.name || '').trim()
  preview.selectedLeadgenFormReason = String(selectedForm?.selectionReason || '').trim()
  preview.creativeDraftConfig = buildDraftCreativeConfig(preview, orchestrator)
  preview.adDraftConfig = buildDraftAdConfig(preview, creationState)
  preview.metaCreative = bundleResult?.creative?.id
    ? {
      creativeId: String(bundleResult.creative.id || ''),
      creativeName: String(bundleResult.creative.name || ''),
      imageHash: String(bundleResult.creative.image_hash || ''),
    }
    : null
  preview.metaAd = bundleResult?.ad?.id
    ? {
      adId: String(bundleResult.ad.id || ''),
      adName: String(bundleResult.ad.name || ''),
    }
    : null

  return creationState
}

async function runLeadCampaignBundleViaMcp(preview, orchestrator) {
  const info = getFacebookAdsMcpInfo()
  if (!info.serverExists || !info.pythonBin || !info.token || !info.helperExists) {
    throw new Error('El MCP no esta listo para ejecutar la creacion unificada de la campana.')
  }

  const payload = JSON.stringify(buildLeadCampaignBundleSpec(preview, orchestrator))

  return new Promise((resolve, reject) => {
    const env = {
      ...getProjectEnv(),
      FB_ACCESS_TOKEN: info.token,
    }
    const child = spawn(info.pythonBin, [info.helperPath, info.serverPath], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8')
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8')
      stderr += text
      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
      for (const line of lines) {
        emitMarketingUpdate({
          type: 'log',
          status: 'running',
          line,
          summary: 'El MCP esta ejecutando el bundle de Meta Ads.',
        })
      }
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      let parsed = null
      try {
        parsed = stdout.trim() ? JSON.parse(stdout.trim()) : null
      } catch (error) {
        reject(new Error(`El helper del MCP devolvio JSON invalido: ${error.message || error}`))
        return
      }

      if (code !== 0 || parsed?.ok === false) {
        reject(new Error(parsed?.error || stderr.trim() || `El helper del MCP finalizo con codigo ${code}`))
        return
      }

      resolve(parsed)
    })

    child.stdin.write(payload)
    child.stdin.end()
  })
}

function postMultipartForm(url, fields = {}, files = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    const boundary = `----NoyeBoundary${Date.now().toString(16)}`
    const chunks = []

    for (const [key, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\n`))
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`))
      chunks.push(Buffer.from(String(value)))
      chunks.push(Buffer.from('\r\n'))
    }

    for (const [key, file] of Object.entries(files)) {
      if (!file?.path) continue
      const fileName = path.basename(file.path)
      const fileContent = fs.readFileSync(file.path)
      chunks.push(Buffer.from(`--${boundary}\r\n`))
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"; filename="${fileName}"\r\n`))
      chunks.push(Buffer.from(`Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`))
      chunks.push(fileContent)
      chunks.push(Buffer.from('\r\n'))
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`))
    const body = Buffer.concat(chunks)

    const request = https.request(url, {
      method: 'POST',
      timeout: 30000,
      headers: {
        Accept: 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'User-Agent': 'noyecode-facebook-ads-mcp/1.0',
        ...headers,
      },
    }, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { raw += chunk })
      response.on('end', () => {
        try {
          const data = raw ? JSON.parse(raw) : {}
          if (response.statusCode >= 200 && response.statusCode < 300 && !data.error) {
            resolve(data)
            return
          }
          reject(new Error(data?.error?.message || `HTTP ${response.statusCode}`))
        } catch (error) {
          reject(new Error(`Respuesta invalida de Meta: ${error.message || error}`))
        }
      })
    })

    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

async function uploadAdImage(accountNode, imagePath, token) {
  const url = new URL(`https://graph.facebook.com/v22.0/${String(accountNode || '').replace(/^\/+/, '')}/adimages`)
  return postMultipartForm(
    url,
    { access_token: token },
    {
      filename: {
        path: imagePath,
        contentType: 'image/png',
      },
    }
  )
}

async function createAdCreativeOnMeta(preview, creation, token) {
  const accountNode = String(creation?.account?.id || '').trim()
  const imagePath = String(preview?.creativeDraftConfig?.imageAssetPath || '').trim()
  const objectStorySpec = preview?.creativeDraftConfig?.objectStorySpec
  if (!accountNode || !imagePath || !objectStorySpec) {
    throw new Error('No tengo datos suficientes para crear el creative en Meta.')
  }

  let upload
  try {
    upload = await uploadAdImage(accountNode, imagePath, token)
  } catch (error) {
    throw new Error(`Fallo subiendo imagen a ${accountNode} | file=${path.basename(imagePath)} | ${error.message || error}`)
  }
  const imageHash = upload?.images
    ? Object.values(upload.images)[0]?.hash || ''
    : upload?.hash || ''

  if (!imageHash) {
    throw new Error('Meta no devolvio image_hash al subir la imagen.')
  }

  const storySpec = JSON.parse(JSON.stringify(objectStorySpec))
  if (storySpec?.link_data) {
    storySpec.link_data.image_hash = imageHash
  }

  const creativeName = `Creative Borrador | ${preview.creativeDraftConfig.leadgenFormId}`
  let created
  try {
    created = await facebookApiRequest(
      'POST',
      `${accountNode}/adcreatives`,
      {
        name: creativeName,
        object_story_spec: storySpec,
      },
      token
    )
  } catch (error) {
    throw new Error(
      `Fallo creando adcreative en ${accountNode} | form_id=${preview.creativeDraftConfig.leadgenFormId} | cta=${preview.creativeDraftConfig.callToActionType} | ${error.message || error}`
    )
  }

  return {
    imageHash,
    creativeId: created?.id || '',
    creativeName,
  }
}

async function createAdOnMeta(preview, creation, creative, token) {
  const accountNode = String(creation?.account?.id || '').trim()
  const adsetId = String(creation?.adsetId || '').trim()
  const creativeId = String(creative?.creativeId || '').trim()
  const adName = String(preview?.adDraftConfig?.adName || '').trim()
  if (!accountNode || !adsetId || !creativeId || !adName) {
    throw new Error('No tengo datos suficientes para crear el anuncio en Meta.')
  }

  let created
  try {
    created = await facebookApiRequest(
      'POST',
      `${accountNode}/ads`,
      {
        name: adName,
        adset_id: adsetId,
        creative: { creative_id: creativeId },
        status: 'PAUSED',
      },
      token
    )
  } catch (error) {
    throw new Error(
      `Fallo creando ad en ${accountNode} | adset_id=${adsetId} | creative_id=${creativeId} | ${error.message || error}`
    )
  }

  return {
    adId: created?.id || '',
    adName,
  }
}

function validateFacebookAdsMcpRuntime(info) {
  if (!info?.pythonBin || !info?.serverPath || !info?.helperPath) {
    return {
      ok: false,
      reason: 'No tengo suficientes datos para validar el runtime del MCP.',
    }
  }

  try {
    execFileSync(
      info.pythonBin,
      [
        '-c',
        [
          'import importlib.util',
          'from pathlib import Path',
          'import requests',
          'import mcp',
          `assert Path(${JSON.stringify(info.serverPath)}).exists()`,
          `assert Path(${JSON.stringify(info.helperPath)}).exists()`,
          'print("ok")',
        ].join('; '),
      ],
      {
        cwd: PROJECT_ROOT,
        timeout: 10000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    return {
      ok: true,
      reason: 'Python puede importar las dependencias base del MCP.',
    }
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim()
    return {
      ok: false,
      reason: `Python no puede cargar el runtime del MCP: ${detail}`,
    }
  }
}

async function runFacebookAdsMcpPreflight() {
  const env = getProjectEnv()
  const info = getFacebookAdsMcpInfo()
  const issues = []

  if (!info.serverExists) {
    issues.push(`No existe el servidor MCP en ${info.serverPath}`)
  }
  if (!info.helperExists) {
    issues.push(`No existe el helper local del MCP en ${info.helperPath}`)
  }
  if (!info.pythonBin) {
    issues.push('Python no esta disponible en PATH para ejecutar el MCP.')
  }
  if (!info.token) {
    issues.push('No existe token de Meta Ads en variables de entorno.')
  }

  let tokenValidation = {
    ok: false,
    reason: 'No se ejecuto validacion remota del token.',
  }
  let runtimeValidation = {
    ok: false,
    reason: 'No se ejecuto validacion local del runtime del MCP.',
  }

  if (info.serverExists && info.helperExists && info.pythonBin) {
    runtimeValidation = validateFacebookAdsMcpRuntime(info)
    if (!runtimeValidation.ok) {
      issues.push(runtimeValidation.reason)
    }
  }

  if (info.serverExists && info.helperExists && info.pythonBin && info.token) {
    tokenValidation = await validateMetaToken(info.token)
    if (!tokenValidation.ok) {
      issues.push(tokenValidation.reason)
    }
  }

  return {
    ready: issues.length === 0,
    issues,
    tokenValidation,
    details: {
      serverPath: info.serverPath,
      serverExists: info.serverExists,
      helperPath: info.helperPath,
      helperExists: info.helperExists,
      pythonBin: info.pythonBin || '',
      hasToken: Boolean(info.token),
      businessWebsite: env.BUSINESS_WEBSITE || 'noyecode.com',
      runtimeValidation,
    },
  }
}

function emitMarketingUpdate(update) {
  if (mainWindow) {
    mainWindow.webContents.send('marketing-run-update', update)
  }
  pushMarketingBrowserEvent(update)
  void pushFacebookVisualEvent(update)
}

async function openMetaAdsManager(creation = null) {
  const accountId = String(creation?.account?.account_id || '').trim()
  const campaignId = String(creation?.campaignId || '').trim()
  const targetUrl =
    accountId && campaignId
      ? `https://www.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(accountId)}&selected_campaign_ids=${encodeURIComponent(campaignId)}`
      : 'https://adsmanager.facebook.com/'
  try {
    if (facebookVisualPage && !facebookVisualPage.isClosed()) {
      await facebookVisualPage.bringToFront()
      await facebookVisualPage.goto(targetUrl, { waitUntil: 'domcontentloaded' })
    } else {
      await shell.openExternal(targetUrl)
    }
    return { ok: true, url: targetUrl }
  } catch (error) {
    return {
      ok: false,
      url: targetUrl,
      reason: error?.message || String(error),
    }
  }
}

function buildCampaignProcess(preflight, preview, creation = null, orchestrator = null) {
  const ready = Boolean(preflight?.ready)
  const issuesText = Array.isArray(preflight?.issues) && preflight.issues.length > 0
    ? preflight.issues.join(' | ')
    : 'Sin observaciones.'
  const created = Boolean(creation?.campaignId)
  const adsetCreated = Boolean(creation?.adsetId)
  const adsetDeferredToUi = Boolean(creation?.adsetDeferredToUi)
  const adsetError = String(creation?.adsetError || '').trim()
  const formsFound = Array.isArray(preview?.leadgenForms) ? preview.leadgenForms.length : 0
  const formsLoaded = Boolean(preview?.leadgenFormsLoaded)
  const selectedLeadgenFormId = String(preview?.selectedLeadgenFormId || '').trim()
  const creativeDraftReady = Boolean(preview?.creativeDraftConfig?.leadgenFormId)
  const creativeCreated = Boolean(preview?.metaCreative?.creativeId)
  const adDraftReady = Boolean(preview?.adDraftConfig?.adsetId)
  const adCreated = Boolean(preview?.metaAd?.adId)
  const hasOrchestrator = Boolean(orchestrator?.plan)
  const qaApproved = Boolean(orchestrator?.marketing?.status)
  const copySummary = orchestrator?.adsAnalyst?.hook || 'Pendiente de brief del ads-analyst.'
    const creativeSummary = orchestrator?.imageCreator?.dimensions
    ? `${orchestrator.imageCreator.style} | ${orchestrator.imageCreator.dimensions}`
    : 'Pendiente de direccion visual.'
  const qaSummary = orchestrator?.marketing?.verdict || 'Pendiente de revision del agente marketing.'

  return [
    {
      id: 'orchestrator-plan',
      title: 'Plan del orquestador',
      detail: hasOrchestrator
        ? `${orchestrator.plan.task} Agentes: orchestrator -> ads-analyst -> image-creator -> marketing.`
        : 'Pendiente de coordinacion del orquestador.',
      status: hasOrchestrator ? 'success' : 'warning',
    },
    {
      id: 'ads-analyst',
      title: 'Brief del ads-analyst',
      detail: hasOrchestrator
        ? `Hook: ${copySummary}`
        : 'Pendiente de brief publicitario.',
      status: hasOrchestrator ? 'success' : 'warning',
    },
    {
      id: 'image-creator',
      title: 'Orden al image-creator',
      detail: hasOrchestrator
        ? `Direccion visual preparada: ${creativeSummary}.`
        : 'Pendiente de prompt visual.',
      status: hasOrchestrator ? 'success' : 'warning',
    },
    {
      id: 'marketing-qa',
      title: 'Revision del agente marketing',
      detail: qaApproved
        ? `${qaSummary}. ${orchestrator.marketing.notes.join(' ')}`
        : 'Pendiente de validacion de marketing.',
      status: qaApproved ? 'success' : 'warning',
    },
    {
      id: 'preflight',
      title: 'Preflight del MCP',
      detail: ready
        ? 'Servidor MCP detectado, Python disponible y token validado contra Meta.'
        : `Faltan requisitos: ${issuesText}`,
      status: ready ? 'success' : 'warning',
    },
    {
      id: 'account',
      title: 'Seleccion de cuenta publicitaria',
      detail: created
        ? `Cuenta seleccionada: ${creation.account?.name || creation.account?.id || 'Sin nombre'}`
        : ready
        ? 'Listo para consultar cuentas publicitarias disponibles con list_ad_accounts.'
        : 'Bloqueado hasta completar el preflight.',
      status: created ? 'success' : ready ? 'pending' : 'warning',
    },
    {
      id: 'campaign',
      title: 'Creacion de campana',
      detail: created
        ? `Campana borrador creada en Meta con ID ${creation.campaignId}. Nombre: ${creation.campaignName}.`
        : `Se crearia una campana con objetivo ${preview.objective} para ${preview.country}.`,
      status: created ? 'success' : ready ? 'pending' : 'warning',
    },
    {
      id: 'adset',
      title: 'Creacion del conjunto de anuncios',
      detail: adsetCreated
        ? `Ad set borrador creado con ID ${creation.adsetId}. Presupuesto maximo ${preview.budget}. Publico base temporal: ${creation.targetingSummary}.`
        : adsetDeferredToUi
        ? 'Meta exigio seleccionar manualmente un objeto promocionado valido; el flujo visual en Ads Manager terminara este paso.'
        : adsetError
        ? `El MCP devolvio un error al crear el ad set: ${adsetError}`
        : `Se configuraria presupuesto ${preview.budget} y fechas ${preview.startDate} -> ${preview.endDate}.`,
      status: adsetCreated ? 'success' : adsetDeferredToUi ? 'warning' : adsetError ? 'error' : ready ? 'pending' : 'warning',
    },
    {
      id: 'leadgen-form',
      title: 'Consulta de formularios Instant Form',
      detail: formsLoaded
        ? formsFound > 0
          ? selectedLeadgenFormId
            ? `Se encontraron ${formsFound} formulario(s) y se selecciono ${preview.selectedLeadgenFormName} (${selectedLeadgenFormId}).`
            : `Se encontraron ${formsFound} formulario(s), pero ninguno cumple exacto con los campos requeridos.`
          : `No se encontraron formularios en la pagina ${orchestrator?.execution?.pageId || getMetaPageId()}.`
        : `Se consultarian los formularios de la pagina ${orchestrator?.execution?.pageId || getMetaPageId()} para obtener el leadgen_form_id.`,
      status: formsLoaded ? (formsFound > 0 ? 'success' : 'warning') : ready ? 'pending' : 'warning',
    },
    {
      id: 'creative',
      title: 'Creacion del creativo',
      detail: hasOrchestrator
        ? creativeCreated
          ? `Creative real creado en Meta con ID ${preview.metaCreative.creativeId} e image_hash ${preview.metaCreative.imageHash}.`
          : creativeDraftReady
          ? `Payload del creativo listo con CTA "${orchestrator.adsAnalyst.cta}", leadgen_form_id ${selectedLeadgenFormId} e imagen ${path.basename(preview.creativeDraftConfig.imageAssetPath)}.`
          : `Brief listo para creativo con CTA "${orchestrator.adsAnalyst.cta}", URL ${preview.url} y formulario ${preview.formFields.join(', ')}.${selectedLeadgenFormId ? ` leadgen_form_id seleccionado: ${selectedLeadgenFormId}.` : ''}`
        : `Se asociaria la URL ${preview.url} y el formulario ${preview.formFields.join(', ')}.`,
      status: creativeCreated || creativeDraftReady ? 'success' : hasOrchestrator && ready ? 'pending' : 'warning',
    },
    {
      id: 'ad',
      title: 'Creacion del anuncio',
      detail: hasOrchestrator
        ? adCreated
          ? `Anuncio real creado en Meta con ID ${preview.metaAd.adId} en estado PAUSED.`
          : adDraftReady
          ? `Payload del anuncio listo en PAUSED para el ad set ${preview.adDraftConfig.adsetId}. Falta subir la imagen a Meta para crear el creative real.`
          : creativeDraftReady
            ? 'El anuncio ya tiene configurado el leadgen_form_id, el object_story_spec base y la imagen local preparada; falta subir el asset a Meta.'
            : 'El orquestador dejo listo el paquete de copy, prompt visual y QA; falta material visual final y leadgen_form_id para enlazar el anuncio.'
        : 'Se enlazarian campana, ad set y creativo en un anuncio listo para revision/publicacion.',
      status: adCreated || adDraftReady || creativeDraftReady ? 'success' : hasOrchestrator && ready ? 'pending' : 'warning',
    },
    {
      id: 'publish',
      title: 'Revision final y publicacion',
      detail: ready
        ? 'El siguiente paso seria ejecutar la creacion real y validar la respuesta de Meta Ads.'
        : 'Pendiente hasta habilitar credenciales y preflight completo.',
      status: ready ? 'pending' : 'warning',
    },
  ]
}

/**
 * Detect external job_poller.py processes (not started by this GUI).
 * Returns array of PIDs running job_poller.py.
 */
function findPollerPids() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*job_poller*\' -and $_.Name -like \'*python*\' } | Select-Object -ExpandProperty ProcessId"',
        { timeout: 8000 },
        (err, stdout) => {
          if (err || !stdout.trim()) return resolve([])
          const pids = stdout.trim().split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(n => n > 0)
          resolve(pids)
        }
      )
    } else {
      exec("pgrep -f 'job_poller\\.py'", { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout.trim()) return resolve([])
        const pids = stdout.trim().split(/\n/).map(s => parseInt(s.trim(), 10)).filter(n => n > 0)
        resolve(pids)
      })
    }
  })
}

/**
 * Check if the poller is running — either our child or an external process.
 */
async function isPollerAlive() {
  // Check our own child first
  if (pollerProcess && pollerProcess.exitCode === null) {
    return { running: true, source: 'gui', pids: [pollerProcess.pid] }
  }
  // Check for external poller processes
  const externalPids = await findPollerPids()
  if (externalPids.length > 0) {
    return { running: true, source: 'external', pids: externalPids }
  }
  return { running: false, source: null, pids: [] }
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-bot-status', async () => {
  const lockPath = path.join(PROJECT_ROOT, '.bot_runner.lock')
  const lockData = readJsonFile(lockPath)
  const poller = await isPollerAlive()

  if (lockData && lockData.pid) {
    return {
      status: 'executing',
      action: lockData.action || 'run_full_cycle',
      started_at: lockData.started_at || 0,
      host: lockData.host || '',
      pid: lockData.pid,
    }
  }

  return {
    status: poller.running ? 'online' : 'offline',
    action: null,
    started_at: null,
    host: null,
    pid: null,
  }
})

ipcMain.handle('get-last-job', async () => {
  return readJsonFile(path.join(PROJECT_ROOT, '.job_poller_state.json'))
})

ipcMain.handle('start-bot', async (_event, profileName) => {
  const lockPath = path.join(PROJECT_ROOT, '.bot_runner.lock')
  if (fs.existsSync(lockPath)) {
    const lock = readJsonFile(lockPath)
    if (lock && lock.pid) {
      return { success: false, error: 'Bot ya esta ejecutando' }
    }
  }

  if (botProcess && botProcess.exitCode === null) {
    return { success: false, error: 'Bot ya esta ejecutando (proceso GUI)' }
  }

  const env = getProjectEnv()
  env['NO_PAUSE'] = '1'
  // Force UTF-8 output from Python
  env['PYTHONIOENCODING'] = 'utf-8'

  const botRunnerPath = path.join(PROJECT_ROOT, 'server', 'bot_runner.py')
  const pythonBin = findPython()
  if (!pythonBin) {
    return { success: false, error: 'Python no encontrado en PATH' }
  }

  const payload = profileName
    ? JSON.stringify({ profile_name: profileName })
    : '{}'
  const args = [botRunnerPath, 'run_full_cycle', payload]

  try {
    botProcess = spawn(pythonBin, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const emitBotLines = (data) => {
      if (!mainWindow) return
      const lines = data.toString('utf-8').split('\n').filter(l => l.trim())
      if (lines.length > 0) {
        mainWindow.webContents.send('bot-log-lines', lines)
      }
    }

    botProcess.stdout.on('data', emitBotLines)
    botProcess.stderr.on('data', emitBotLines)

    botProcess.on('exit', (code) => {
      if (mainWindow) {
        mainWindow.webContents.send('bot-log-lines', [
          `[INFO] Bot finalizo con codigo: ${code}`
        ])
      }
      botProcess = null
    })

    return { success: true, pid: botProcess.pid }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('stop-bot', async () => {
  const lockPath = path.join(PROJECT_ROOT, '.bot_runner.lock')
  const lockData = readJsonFile(lockPath)
  let killed = false

  // Kill from lock file PID
  if (lockData && lockData.pid) {
    try {
      killProcessTree(lockData.pid)
      killed = true
    } catch { /* ignore */ }
    try {
      fs.unlinkSync(lockPath)
    } catch { /* ignore */ }
  }

  // Also kill our GUI-spawned bot process
  if (botProcess && botProcess.exitCode === null) {
    try {
      killProcessTree(botProcess.pid)
      killed = true
    } catch { /* ignore */ }
    botProcess = null
  }

  return killed
    ? { success: true }
    : { success: false, error: 'Bot no esta ejecutando' }
})

ipcMain.handle('start-poller', async () => {
  const poller = await isPollerAlive()
  if (poller.running) {
    return { success: false, error: `Poller ya esta corriendo (${poller.source}, PIDs: ${poller.pids.join(',')})` }
  }

  const env = getProjectEnv()
  const pollerPath = path.join(PROJECT_ROOT, 'server', 'job_poller.py')
  const pythonBin = findPython()
  if (!pythonBin) {
    return { success: false, error: 'Python no encontrado en PATH' }
  }

  try {
    // The poller writes its own logs to logs/job_poller.log via Python logger.
    // We don't pipe stdout to the log file — that causes EBUSY on Windows
    // when the log watcher also reads the file.
    pollerProcess = spawn(pythonBin, [pollerPath], {
      cwd: PROJECT_ROOT,
      env,
      stdio: 'ignore',
    })

    pollerProcess.on('exit', (code) => {
      console.log(`Poller exited with code ${code}`)
      pollerProcess = null
    })

    return { success: true, pid: pollerProcess.pid }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('stop-poller', async () => {
  const poller = await isPollerAlive()
  if (!poller.running) {
    return { success: false, error: 'Poller no esta corriendo' }
  }

  try {
    // Kill all poller PIDs (whether GUI-spawned or external)
    for (const pid of poller.pids) {
      killProcessTree(pid)
    }
    pollerProcess = null
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('is-poller-running', async () => {
  const poller = await isPollerAlive()
  return poller.running
})

ipcMain.handle('read-log-lines', async (_event, count = 200) => {
  const logPath = path.join(PROJECT_ROOT, 'logs', 'job_poller.log')
  try {
    const content = fs.readFileSync(logPath, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim())
    return lines.slice(-count)
  } catch {
    return []
  }
})

ipcMain.handle('get-env-config', async () => {
  return parseEnvFile(path.join(PROJECT_ROOT, '.env'))
})

ipcMain.handle('run-preflight', async (_event, force = false) => {
  const pythonBin = findPython()
  if (!pythonBin) {
    return {
      ok: false,
      checks: [{ name: 'Python', required: '>= 3.10', current: null, ok: false, fix: 'Instala Python 3.10+ desde https://python.org' }],
    }
  }
  const args = ['-m', 'cfg.preflight', '--json']
  if (force) args.push('--force')
  return new Promise((resolve) => {
    const child = spawn(pythonBin, args, {
      cwd: PROJECT_ROOT,
      env: getProjectEnv(),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('close', (code) => {
      try {
        const result = JSON.parse(stdout)
        resolve(result)
      } catch {
        resolve({
          ok: code === 0,
          checks: [{ name: 'Preflight', required: 'ejecutable', current: code === 0 ? 'ok' : `error (code ${code})`, ok: code === 0, fix: stderr || 'Error ejecutando preflight' }],
        })
      }
    })
    child.on('error', (err) => {
      resolve({
        ok: false,
        checks: [{ name: 'Python', required: '>= 3.10', current: null, ok: false, fix: `Error: ${err.message}` }],
      })
    })
  })
})

ipcMain.handle('reset-bot-state', async () => {
  const stateFiles = [
    '.bot_runner.lock',
    '.account_rotation_state.json',
    '.job_poller_state.json',
    '.prompt_last_send.json',
    '.service_rotation_state.json',
  ]
  const logFiles = [
    path.join('logs', 'bot_runner_last.log'),
    path.join('logs', 'job_poller.log'),
  ]
  const memoryFiles = [
    path.join('memory', 'profile', 'memory_profile_change.json'),
  ]

  const deleted = []
  const allFiles = [...stateFiles, ...logFiles, ...memoryFiles]

  for (const file of allFiles) {
    const fullPath = path.join(PROJECT_ROOT, file)
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath)
        deleted.push(file)
      }
    } catch { /* ignore locked files */ }
  }

  return { success: true, deleted }
})

ipcMain.handle('save-env-config', async (_event, config) => {
  try {
    const envPath = path.join(PROJECT_ROOT, '.env')
    let content = ''
    try {
      content = fs.readFileSync(envPath, 'utf-8')
    } catch { /* file may not exist */ }

    // Update existing keys preserving comments and structure
    const updatedKeys = new Set()
    const lines = content.split('\n')
    const newLines = lines.map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return line
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) return line
      const key = trimmed.substring(0, eqIndex).trim()
      if (key in config) {
        updatedKeys.add(key)
        return `${key}=${config[key]}`
      }
      return line
    })

    // Append new keys not in the original file
    for (const [key, value] of Object.entries(config)) {
      if (!updatedKeys.has(key)) {
        newLines.push(`${key}=${value}`)
      }
    }

    fs.writeFileSync(envPath, newLines.join('\n'), 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('run-marketing-campaign-preview', async (_event, payload = {}) => {
  if (marketingRunInProgress) {
    return { success: false, error: 'Ya hay una ejecucion del agente de marketing en curso' }
  }

  const budget = String(payload.budget || '').trim()
  const startDate = String(payload.startDate || '').trim()
  const endDate = String(payload.endDate || '').trim()

  if (!budget || !startDate || !endDate) {
    return { success: false, error: 'Faltan presupuesto y/o fechas para ejecutar el agente' }
  }

  marketingRunInProgress = true
  emitMarketingUpdate({ type: 'status', status: 'running', summary: 'Ejecutando agente de marketing...' })

  const preview = {
    objective: 'Clientes potenciales',
    url: ensureAbsoluteUrl(getProjectEnv().BUSINESS_WEBSITE || 'https://noyecode.com'),
    country: 'Colombia',
    formFields: ['Nombre completo', 'Correo electronico', 'Telefono movil'],
    budget,
    startDate,
    endDate,
    mcpAvailable: false,
    leadgenFormsLoaded: false,
    leadgenForms: [],
    selectedLeadgenFormId: '',
    selectedLeadgenFormName: '',
    selectedLeadgenFormReason: '',
    imageAsset: null,
    creativeDraftConfig: null,
    adDraftConfig: null,
    metaCreative: null,
    metaAd: null,
    browserMonitorUrl: '',
    process: [],
    orchestrator: null,
  }

  try {
    marketingMonitorEvents = []
    marketingMonitorNextId = 1
    preview.browserMonitorUrl = await openMarketingBrowserMonitor()
    preview.imageAsset = prepareLatestMarketingImageAsset()
    const targetActId = getTargetAdAccountId()
    await ensureFacebookVisualBrowser(targetActId)

    const orchestrator = runLocalMarketingOrchestrator(preview)
    preview.orchestrator = orchestrator

    emitMarketingUpdate({
      type: 'log',
      status: 'running',
      line: `[BROWSER] Monitor abierto en ${preview.browserMonitorUrl} para seguir el armado paso a paso.`,
      summary: 'Monitor del navegador abierto.',
    })
    await sleep(450)

    emitMarketingUpdate({
      type: 'log',
      status: 'running',
      line: `[FACEBOOK] Navegador visual abierto en Ads Manager para la cuenta act_${targetActId}. Si Facebook pide login, inicia sesion ahi y el overlay seguira mostrando el paso a paso.`,
      summary: 'Facebook Ads Manager abierto en navegador normal.',
    })
    await sleep(450)

    emitMarketingUpdate({
      type: 'log',
      status: 'running',
      line: preview.imageAsset
        ? `[ASSET] Imagen mas reciente detectada: ${preview.imageAsset.fileName}. ${preview.imageAsset.adjustmentReason}`
        : `[ASSET] No se encontraron imagenes en ${getMarketingImagesDir()}.`,
      summary: 'Preparando asset visual.',
    })
    await sleep(450)

    const preflightSteps = [
      '[1/9] Iniciando agente orquestador...',
      `PLAN: ${orchestrator.plan.task}`,
      `[2/9] Orquestador -> ads-analyst: generando brief para ${orchestrator.execution.campaignType} con cuenta ${orchestrator.execution.accountHint}...`,
      `[3/9] ads-analyst listo: ${orchestrator.adsAnalyst.hook}`,
      `[4/9] Orquestador -> image-creator: preparando direccion visual ${orchestrator.imageCreator.dimensions}...`,
      '[5/9] image-creator listo: prompt creativo preparado para la pieza principal...',
      `[6/9] Orquestador -> marketing: validando copy, CTA y compliance para ${preview.country}...`,
      `[7/9] marketing ${orchestrator.marketing.verdict}.`,
      '[8/9] Verificando disponibilidad del MCP de Facebook Ads...',
    ]

    for (const line of preflightSteps) {
      emitMarketingUpdate({ type: 'log', line })
      await sleep(650)
    }

    const preflight = await runFacebookAdsMcpPreflight()
    preview.mcpAvailable = preflight.ready
    preview.process = buildCampaignProcess(preflight, preview, null, orchestrator)

    emitMarketingUpdate({
      type: 'log',
      line: preflight.ready
        ? `[9/9] Preflight MCP correcto. ${preflight.tokenValidation.reason}`
        : `[9/9] Preflight MCP incompleto. ${preflight.issues[0] || 'Faltan requisitos para publicar.'}`,
    })
    await sleep(650)

    emitMarketingUpdate({
      type: 'log',
      line: '[UI] El brief del orquestador ya esta listo. Comenzando a llenar Facebook Ads Manager paso a paso en el navegador...',
    })
    await sleep(450)

    await tryFacebookUiCreateCampaign(preview)

    if (preflight.ready) {
      emitMarketingUpdate({
        type: 'log',
        line: `[REAL] Orquestador autoriza borrador. El MCP de Facebook Ads recibira el brief y configurara la campaña directamente para ${orchestrator.execution.accountHint}...`,
      })
      await sleep(650)

      let creationState = null
      let bundleError = null
      try {
        const bundleResult = await runLeadCampaignBundleViaMcp(preview, orchestrator)
        creationState = applyMcpBundleResultToPreview(preview, orchestrator, bundleResult)
        preview.process = buildCampaignProcess(preflight, preview, creationState, orchestrator)

        emitMarketingUpdate({
          type: 'log',
          line: preview.leadgenForms.length > 0
            ? `[REAL] El MCP consulto ${preview.leadgenForms.length} formulario(s) Instant Form y selecciono ${preview.selectedLeadgenFormName || 'ninguno'} ${preview.selectedLeadgenFormId ? `(${preview.selectedLeadgenFormId})` : ''}.`
            : bundleResult?.leadgen_forms_error
              ? `[REAL] El MCP no pudo consultar formularios Instant Form: ${bundleResult.leadgen_forms_error}`
              : `[REAL] El MCP no encontro formularios Instant Form utilizables para la pagina ${orchestrator.execution.pageId}.`
        })
        await sleep(650)

        if (creationState.campaignId) {
          emitMarketingUpdate({
            type: 'log',
            line: `[REAL] Campaign creada por el MCP. ID ${creationState.campaignId} en cuenta ${creationState.account?.name || creationState.account?.id}.`,
          })
          await sleep(650)
        }

        if (creationState.adsetId) {
          emitMarketingUpdate({
            type: 'log',
            line: `[REAL] Ad set creado por el MCP. ID ${creationState.adsetId}. Publico temporal ${creationState.targetingSummary}.`,
          })
          await sleep(650)
        } else if (creationState.adsetDeferredToUi) {
          emitMarketingUpdate({
            type: 'log',
            status: 'running',
            line: '[REAL] El ad set se terminara por la UI de Ads Manager porque Meta requiere seleccionar manualmente un objeto promocionado valido.',
          })
          await sleep(650)
        } else if (creationState.adsetError) {
          emitMarketingUpdate({
            type: 'log',
            status: 'warning',
            line: `[REAL] El MCP no pudo crear el ad set, pero la automatizacion visual seguira: ${creationState.adsetError}`,
          })
          await sleep(650)
        }

        if (preview.metaCreative?.creativeId) {
          emitMarketingUpdate({
            type: 'log',
            line: `[REAL] Creative creado por el MCP. ID ${preview.metaCreative.creativeId}. image_hash ${preview.metaCreative.imageHash}.`,
          })
          await sleep(650)
        }

        if (preview.metaAd?.adId) {
          emitMarketingUpdate({
            type: 'log',
            line: `[REAL] Anuncio creado por el MCP. ID ${preview.metaAd.adId} en estado PAUSED.`,
          })
          await sleep(650)
        }
      } catch (error) {
        bundleError = error
        emitMarketingUpdate({
          type: 'log',
          status: 'warning',
          line: `[REAL] El MCP no completo el backend de Meta Ads, pero la automatizacion visual seguira en el navegador: ${error.message || error}`,
        })
        await sleep(650)
      }

      const browserOpen = await openMetaAdsManager(creationState)
      emitMarketingUpdate({
        type: 'log',
        line: browserOpen.ok
          ? `[OPEN] Navegador abierto en ${browserOpen.url} para visualizar Meta Ads Manager.`
          : `[OPEN] No se pudo abrir el navegador automaticamente: ${browserOpen.reason}`,
      })
      await sleep(650)

      if (browserOpen.ok) {
        await tryFacebookUiConfigureCampaignEditor(preview)
        await tryFacebookUiConfigureAdsetSchedule(preview)
      }

      emitMarketingUpdate({
        type: 'done',
        status: bundleError || (creationState?.adsetError && !creationState?.adsetDeferredToUi) ? 'warning' : 'success',
        summary: bundleError
          ? `La automatizacion visual continuo en Facebook Ads Manager, pero el MCP devolvio un error de backend: ${bundleError.message || bundleError}`
          : creationState?.adsetDeferredToUi
            ? 'La campaña se creo y el conjunto de anuncios quedo delegado a la UI de Ads Manager para seleccionar manualmente el objeto promocionado antes de continuar con el anuncio.'
          : creationState?.adsetError
            ? `La automatizacion visual continuo en Facebook Ads Manager, pero el MCP no pudo crear el ad set: ${creationState.adsetError}`
          : browserOpen.ok
            ? 'Orquestador y subagentes dejaron listo el brief; campaña y ad set borrador creados desde el MCP de Meta Ads. Se abrió Ads Manager para continuar la configuración.'
            : 'Orquestador y subagentes dejaron listo el brief; campaña y ad set borrador creados desde el MCP de Meta Ads, pero no se pudo abrir el navegador automáticamente.',
        preview,
      })
    } else {
      emitMarketingUpdate({
        type: 'done',
        status: 'warning',
        summary: `Previsualizacion generada. MCP no listo: ${preflight.issues.join(' | ')}`,
        preview,
      })
    }

    return { success: true }
  } catch (err) {
    emitMarketingUpdate({
      type: 'done',
      status: 'error',
      summary: `La ejecucion del agente fallo: ${err.message || err}`,
      preview,
    })
    return { success: false, error: err.message }
  } finally {
    marketingRunInProgress = false
  }
})

// ─── Log Watcher ──────────────────────────────────────────────────────────────

function startLogWatcher() {
  const logPath = path.join(PROJECT_ROOT, 'logs', 'job_poller.log')

  try {
    lastLogSize = fs.statSync(logPath).size
  } catch {
    lastLogSize = 0
  }

  logWatcherInterval = setInterval(() => {
    if (!mainWindow) return

    try {
      const stat = fs.statSync(logPath)

      if (stat.size < lastLogSize) {
        lastLogSize = 0
      }

      if (stat.size > lastLogSize) {
        // Use shared read mode to avoid EBUSY on Windows
        const bytesToRead = stat.size - lastLogSize
        let fd
        try {
          fd = fs.openSync(logPath, fs.constants.O_RDONLY | 0, 0o444)
          const buffer = Buffer.alloc(bytesToRead)
          fs.readSync(fd, buffer, 0, bytesToRead, lastLogSize)
          fs.closeSync(fd)
          fd = null

          const newLines = buffer.toString('utf-8').split('\n').filter(l => l.trim())
          if (newLines.length > 0) {
            mainWindow.webContents.send('log-new-lines', newLines)
          }
          lastLogSize = stat.size
        } catch (readErr) {
          // File may be locked by another process — skip this cycle
          if (fd) try { fs.closeSync(fd) } catch {}
        }
      }
    } catch { /* file may not exist yet */ }
  }, 500)
}

function startBotLogWatcher() {
  const logPath = path.join(PROJECT_ROOT, 'logs', 'bot_runner_last.log')

  try {
    lastBotLogSize = fs.statSync(logPath).size
  } catch {
    lastBotLogSize = 0
  }

  botLogWatcherInterval = setInterval(() => {
    if (!mainWindow) return

    try {
      const stat = fs.statSync(logPath)

      if (stat.size < lastBotLogSize) {
        lastBotLogSize = 0
      }

      if (stat.size > lastBotLogSize) {
        const bytesToRead = stat.size - lastBotLogSize
        let fd
        try {
          fd = fs.openSync(logPath, fs.constants.O_RDONLY | 0, 0o444)
          const buffer = Buffer.alloc(bytesToRead)
          fs.readSync(fd, buffer, 0, bytesToRead, lastBotLogSize)
          fs.closeSync(fd)
          fd = null

          const newLines = buffer.toString('utf-8').split('\n').filter(l => l.trim())
          if (newLines.length > 0) {
            mainWindow.webContents.send('bot-log-lines', newLines)
          }
          lastBotLogSize = stat.size
        } catch (readErr) {
          if (fd) try { fs.closeSync(fd) } catch {}
        }
      }
    } catch { /* file may not exist yet */ }
  }, 500)
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow()
  startLogWatcher()
  startBotLogWatcher()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (logWatcherInterval) clearInterval(logWatcherInterval)
  if (botLogWatcherInterval) clearInterval(botLogWatcherInterval)

  // Only kill the poller if we spawned it (don't kill external pollers)
  if (pollerProcess && pollerProcess.exitCode === null) {
    killProcessTree(pollerProcess.pid)
  }

  if (process.platform !== 'darwin') app.quit()
})
