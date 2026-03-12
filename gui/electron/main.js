const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const https = require('https')
const { spawn, exec } = require('child_process')

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
            reject(new Error(data?.error?.message || `HTTP ${response.statusCode}`))
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

function buildDraftCampaignName(preview) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16)
  return `Borrador Leads ${preview.startDate} a ${preview.endDate} | ${preview.budget} | ${stamp}`
}

async function createDraftCampaign(preview, token) {
  const account = await getPrimaryAdAccount(token)
  const campaignName = buildDraftCampaignName(preview)
  const accountNode = String(account.id || '').trim()
  if (!accountNode) {
    throw new Error('Meta no devolvio el identificador de la cuenta publicitaria.')
  }

  const created = await facebookApiRequest(
    'POST',
    `${accountNode}/campaigns`,
    {
      name: campaignName,
      objective: 'OUTCOME_LEADS',
      status: 'PAUSED',
      special_ad_categories: [],
    },
    token
  )

  return {
    account,
    campaignId: created?.id || '',
    campaignName,
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
  if (!mainWindow) return
  mainWindow.webContents.send('marketing-run-update', update)
}

async function openMetaAdsManager(creation = null) {
  const accountId = String(creation?.account?.account_id || '').trim()
  const campaignId = String(creation?.campaignId || '').trim()
  const targetUrl =
    accountId && campaignId
      ? `https://www.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(accountId)}&selected_campaign_ids=${encodeURIComponent(campaignId)}`
      : 'https://adsmanager.facebook.com/'
  try {
    await shell.openExternal(targetUrl)
    return { ok: true, url: targetUrl }
  } catch (error) {
    return {
      ok: false,
      url: targetUrl,
      reason: error?.message || String(error),
    }
  }
}

function buildCampaignProcess(preflight, preview, creation = null) {
  const ready = Boolean(preflight?.ready)
  const issuesText = Array.isArray(preflight?.issues) && preflight.issues.length > 0
    ? preflight.issues.join(' | ')
    : 'Sin observaciones.'
  const created = Boolean(creation?.campaignId)

  return [
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
      detail: `Se configuraria presupuesto ${preview.budget} y fechas ${preview.startDate} -> ${preview.endDate}.`,
      status: ready ? 'pending' : 'warning',
    },
    {
      id: 'creative',
      title: 'Creacion del creativo',
      detail: `Se asociaria la URL ${preview.url} y el formulario ${preview.formFields.join(', ')}.`,
      status: ready ? 'pending' : 'warning',
    },
    {
      id: 'ad',
      title: 'Creacion del anuncio',
      detail: 'Se enlazarian campana, ad set y creativo en un anuncio listo para revision/publicacion.',
      status: ready ? 'pending' : 'warning',
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
    process: [],
  }

  try {
    const preflightSteps = [
      '[1/6] Iniciando agente de marketing...',
      '[2/6] Cargando reglas activas para Facebook Ads...',
      `[3/6] Preparando campaña con presupuesto ${budget} y ventana ${startDate} -> ${endDate}...`,
      `[4/6] Aplicando objetivo leads, URL ${preview.url} y formulario de contacto...`,
      '[5/6] Verificando disponibilidad del MCP de Facebook Ads...',
    ]

    for (const line of preflightSteps) {
      emitMarketingUpdate({ type: 'log', line })
      await sleep(650)
    }

    const preflight = await runFacebookAdsMcpPreflight()
    preview.mcpAvailable = preflight.ready
    preview.process = buildCampaignProcess(preflight, preview)

    emitMarketingUpdate({
      type: 'log',
      line: preflight.ready
        ? `[6/6] Preflight MCP correcto. ${preflight.tokenValidation.reason}`
        : `[6/6] Preflight MCP incompleto. ${preflight.issues[0] || 'Faltan requisitos para publicar.'}`,
    })
    await sleep(650)

    if (preflight.ready) {
      emitMarketingUpdate({
        type: 'log',
        line: '[REAL] Creando campaña real en Meta Ads como borrador (PAUSED)...',
      })
      await sleep(650)

      const creation = await createDraftCampaign(preview, getFacebookAdsMcpInfo().token)
      preview.process = buildCampaignProcess(preflight, preview, creation)

      emitMarketingUpdate({
        type: 'log',
        line: `[REAL] Campaña borrador creada correctamente. ID ${creation.campaignId} en cuenta ${creation.account?.name || creation.account?.id}.`,
      })
      await sleep(650)

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
          ? 'Campaña borrador creada en Meta Ads. Se abrió Ads Manager para que puedas verla y continuar con la configuración.'
          : 'Campaña borrador creada en Meta Ads, pero no se pudo abrir el navegador automáticamente.',
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
