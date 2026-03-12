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
    const continueButton = page.locator('button, div[role="button"]').filter({
      hasText: /continuar|continue|siguiente|next/i,
    }).first()
    if (await continueButton.count()) {
      await continueButton.click({ timeout: 5000 }).catch(() => {})
      await logFacebookUiStep('Intento de avanzar en el flujo visual de creacion.')
      await page.waitForTimeout(1200)
    }
  } catch {
    // continue silently
  }

  try {
    const campaignName = buildDraftCampaignName(preview)
    const input = page.locator('input[type="text"], input[aria-label], input').first()
    await input.waitFor({ timeout: 8000 })
    await input.fill(campaignName)
    await logFacebookUiStep(`Nombre de campana rellenado en UI: ${campaignName}`)
  } catch (error) {
    await logFacebookUiStep(`No pude rellenar el nombre de la campana en la UI: ${error.message || error}`, 'warning')
  }
}

function getFacebookAdsMcpInfo() {
  const env = getProjectEnv()
  const serverPath = path.join(PROJECT_ROOT, 'utils', 'AgenteMarketing', 'MCP', 'fb-ads-mcp-server', 'server.py')
  const token =
    env.FB_ACCESS_TOKEN ||
    env.FACEBOOK_ACCESS_TOKEN ||
    env.META_ACCESS_TOKEN ||
    ''

  return {
    serverPath,
    serverExists: fs.existsSync(serverPath),
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

function buildDraftCampaignName(preview) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16)
  return `Borrador Leads ${preview.startDate} a ${preview.endDate} | ${preview.budget} | ${stamp}`
}

function buildOrchestratorPlan(preview) {
  return {
    task: `Configurar borrador de campana Facebook Ads para leads con presupuesto maximo ${preview.budget} entre ${preview.startDate} y ${preview.endDate}.`,
    agent: 'orchestrator',
    reason: 'Coordina ads-analyst, image-creator y marketing antes de enviar la configuracion a Meta Ads.',
    cost: 'medio',
    approvedByUser: true,
  }
}

function runLocalMarketingOrchestrator(preview) {
  const plan = buildOrchestratorPlan(preview)
  const pageId = getMetaPageId()
  const selectedImage = preview?.imageAsset || null
  const adsAnalyst = {
    platform: 'Facebook Ads',
    format: 'Imagen unica para Lead Ads',
    objective: 'Leads',
    audience:
      'Colombia | decisores COO, CTO y Operations Manager | empresas de 20-100 empleados con procesos manuales, sistemas legacy o integraciones rotas.',
    hook: 'Elimina friccion operativa antes de que el crecimiento se convierta en caos.',
    copy:
      'Si tu equipo sigue operando entre hojas de calculo, WhatsApp y sistemas desconectados, Noyecode te ayuda a modernizar, automatizar e integrar procesos para reducir errores y acelerar la operacion.',
    cta: 'Solicita un diagnostico rapido',
    visualReference:
      'Escena corporativa moderna con dashboard, automatizacion de procesos y equipo operativo en contexto B2B LATAM, estilo premium tech.',
    assumptions: [
      'Segmentacion base amplia en Colombia definida por el orquestador por falta de un ICP confirmado por industria.',
      'La promesa se centra en eficiencia operativa y modernizacion, sin metricas inventadas.',
    ],
  }

  const imageCreator = {
    dimensions: '1200x628',
    style: 'Premium tech corporativo',
    prompt:
      'Create a premium Facebook lead ad image for Noyecode, focused on operational efficiency for Colombian growth-stage companies. Show a modern LATAM business team, workflow automation dashboards, connected systems, clean orange-accent brand palette, high contrast, professional lighting, no clutter, no tiny unreadable text, landscape 1200x628.',
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
      'CTA de baja friccion y alineado con lead generation.',
      'Narrativa B2B centrada en problemas operativos concretos.',
      'Pendiente activo visual final y leadgen_form_id para completar creative y anuncio.',
    ],
  }

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
    exactMatch: hasEmail && hasPhone && hasFirstName && hasLastName,
    acceptableMatch: hasEmail && hasPhone && (hasFullName || (hasFirstName && hasLastName)),
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
      selectionReason: 'Seleccionado automaticamente por cumplir exacto con nombre, apellido, correo y telefono.',
    }
  }

  const acceptable = allForms.find((form) => form?.requirements?.acceptableMatch)
  if (acceptable) {
    return {
      id: acceptable.id,
      name: acceptable.name,
      selectionReason: 'No hubo coincidencia exacta; se selecciono el mejor formulario disponible con full_name, correo y telefono.',
    }
  }

  return {
    id: '',
    name: '',
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

async function runFacebookAdsMcpPreflight() {
  const env = getProjectEnv()
  const info = getFacebookAdsMcpInfo()
  const issues = []

  if (!info.serverExists) {
    issues.push(`No existe el servidor MCP en ${info.serverPath}`)
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

  if (info.serverExists && info.pythonBin && info.token) {
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
      pythonBin: info.pythonBin || '',
      hasToken: Boolean(info.token),
      businessWebsite: env.BUSINESS_WEBSITE || 'noyecode.com',
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
        : `Se configuraria presupuesto ${preview.budget} y fechas ${preview.startDate} -> ${preview.endDate}.`,
      status: adsetCreated ? 'success' : ready ? 'pending' : 'warning',
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
    url: getProjectEnv().BUSINESS_WEBSITE || 'noyecode.com',
    country: 'Colombia',
    formFields: ['Nombre', 'Apellido', 'Correo', 'Numero de telefono'],
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

    await tryFacebookUiCreateCampaign(preview)

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

    if (preflight.ready) {
      const token = getFacebookAdsMcpInfo().token
      const pageId = orchestrator.execution.pageId

      try {
        emitMarketingUpdate({
          type: 'log',
          line: `[REAL] Consultando formularios Instant Form en la pagina ${pageId}...`,
        })
        await sleep(650)

        preview.leadgenForms = await listLeadgenForms(token, pageId)
        preview.leadgenForms = await enrichLeadgenFormsWithQuestions(token, preview.leadgenForms)
        preview.leadgenFormsLoaded = true
        const selectedLeadgenForm = selectBestLeadgenForm(preview.leadgenForms)
        preview.selectedLeadgenFormId = selectedLeadgenForm.id
        preview.selectedLeadgenFormName = selectedLeadgenForm.name
        preview.selectedLeadgenFormReason = selectedLeadgenForm.selectionReason
        preview.creativeDraftConfig = buildDraftCreativeConfig(preview, orchestrator)
        preview.process = buildCampaignProcess(preflight, preview, null, orchestrator)

        emitMarketingUpdate({
          type: 'log',
          line: preview.leadgenForms.length > 0
            ? `[REAL] Formularios encontrados: ${preview.leadgenForms.map((form) => {
              const suffix = form.requirements?.exactMatch
                ? 'cumple nombre, apellido, correo y telefono'
                : form.requirements?.acceptableMatch
                  ? 'cumple con nombre completo, correo y telefono'
                  : 'no cumple todos los campos requeridos'
              return `${form.name} (${form.id}) - ${suffix}`
            }).join(' | ')}`
            : `[REAL] No se encontraron formularios para la pagina ${pageId}.`,
        })
        await sleep(650)

        emitMarketingUpdate({
          type: 'log',
          line: preview.selectedLeadgenFormId
            ? `[REAL] Formulario seleccionado automaticamente: ${preview.selectedLeadgenFormName} (${preview.selectedLeadgenFormId}). ${preview.selectedLeadgenFormReason}`
            : `[REAL] ${preview.selectedLeadgenFormReason}`,
        })
        await sleep(650)

        if (preview.creativeDraftConfig) {
          emitMarketingUpdate({
            type: 'log',
            line: `[REAL] Payload del creativo configurado con leadgen_form_id ${preview.creativeDraftConfig.leadgenFormId} y CTA ${preview.creativeDraftConfig.callToActionType}.`,
          })
          await sleep(650)
        }
      } catch (formsError) {
        preview.leadgenFormsLoaded = true
        preview.process = buildCampaignProcess(preflight, preview, null, orchestrator)
        emitMarketingUpdate({
          type: 'log',
          line: `[REAL] No se pudieron consultar los formularios Instant Form: ${formsError.message || formsError}`,
        })
        await sleep(650)
      }

      emitMarketingUpdate({
        type: 'log',
        line: `[REAL] Orquestador autoriza borrador. Creando campaña real en Meta Ads como borrador (PAUSED) para ${orchestrator.execution.accountHint}...`,
      })
      await sleep(650)

      const creation = await createDraftCampaign(preview, token, orchestrator.execution.accountHint)
      preview.process = buildCampaignProcess(preflight, preview, creation, orchestrator)

      emitMarketingUpdate({
        type: 'log',
        line: `[REAL] Campaña borrador creada correctamente. ID ${creation.campaignId} en cuenta ${creation.account?.name || creation.account?.id}.`,
      })
      await sleep(650)

      emitMarketingUpdate({
        type: 'log',
        line: '[REAL] Creando ad set borrador con presupuesto maximo lifetime y publico temporal amplio en Colombia...',
      })
      await sleep(650)

      const adset = await createDraftAdSet(preview, token, creation)
      const creationState = { ...creation, ...adset }
      preview.adDraftConfig = buildDraftAdConfig(preview, creationState)
      preview.process = buildCampaignProcess(preflight, preview, creationState, orchestrator)

      emitMarketingUpdate({
        type: 'log',
        line: `[REAL] Ad set borrador creado correctamente. ID ${adset.adsetId}. Publico temporal alineado al brief del ads-analyst.`,
      })
      await sleep(650)

      if (preview.adDraftConfig) {
        emitMarketingUpdate({
          type: 'log',
          line: `[REAL] Payload del anuncio preparado en estado ${preview.adDraftConfig.status} para el ad set ${preview.adDraftConfig.adsetId}.`,
        })
        await sleep(650)
      }

      if (preview.creativeDraftConfig) {
        emitMarketingUpdate({
          type: 'log',
          line: `[REAL] Subiendo imagen ${path.basename(preview.creativeDraftConfig.imageAssetPath)} a Meta para obtener image_hash...`,
        })
        await sleep(650)

        const metaCreative = await createAdCreativeOnMeta(preview, creationState, token)
        preview.metaCreative = metaCreative
        preview.process = buildCampaignProcess(preflight, preview, creationState, orchestrator)

        emitMarketingUpdate({
          type: 'log',
          line: `[REAL] Creative creado correctamente. ID ${metaCreative.creativeId}. image_hash ${metaCreative.imageHash}.`,
        })
        await sleep(650)

        const metaAd = await createAdOnMeta(preview, creationState, metaCreative, token)
        preview.metaAd = metaAd
        preview.process = buildCampaignProcess(preflight, preview, creationState, orchestrator)

        emitMarketingUpdate({
          type: 'log',
          line: `[REAL] Anuncio creado correctamente. ID ${metaAd.adId} en estado PAUSED.`,
        })
        await sleep(650)
      }

      const browserOpen = await openMetaAdsManager(creation)
      emitMarketingUpdate({
        type: 'log',
        line: browserOpen.ok
          ? `[OPEN] Navegador abierto en ${browserOpen.url} para visualizar Meta Ads Manager.`
          : `[OPEN] No se pudo abrir el navegador automaticamente: ${browserOpen.reason}`,
      })
      await sleep(650)

      emitMarketingUpdate({
        type: 'done',
        status: 'success',
        summary: browserOpen.ok
          ? 'Orquestador y subagentes dejaron listo el brief; campaña y ad set borrador creados en Meta Ads. Se abrió Ads Manager para continuar la configuración.'
          : 'Orquestador y subagentes dejaron listo el brief; campaña y ad set borrador creados en Meta Ads, pero no se pudo abrir el navegador automáticamente.',
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
