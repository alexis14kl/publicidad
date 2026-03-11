const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
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
  const env = parseEnvFile(path.join(PROJECT_ROOT, '.env'))
  const sanitized = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret')) {
      sanitized[key] = '********'
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
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
