const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { PROJECT_ROOT } = require('../config/project-paths')
const { getProjectEnv } = require('../utils/env')
const { persistEnvConfig } = require('../utils/helpers')
const { findPython } = require('../utils/process')
const { stopPidBestEffort } = require('../utils/process')
const { IMAGE_FORMATS } = require('../config/image-formats')
const state = require('../state')
const { isPollerAlive } = require('../marketing/campaign-process')
const { isCompanyActive, buildCompanyCredentialEnv, buildFullPrompt } = require('../company/lookup')

function registerPollerHandlers(ipcMain) {
  ipcMain.handle('start-poller', async (_event, payload) => {
    const poller = await isPollerAlive()
    if (poller.running) {
      return { success: false, error: `Poller ya esta corriendo (${poller.source}, PIDs: ${poller.pids.join(',')})` }
    }

    const rawPollerPrompt = typeof payload === 'object' && payload !== null
      ? String(payload.imagePrompt || '').trim()
      : ''
    const pollerFormat = typeof payload === 'object' && payload !== null
      ? String(payload.imageFormat || '').trim()
      : ''
    const pollerService = typeof payload === 'object' && payload !== null
      ? String(payload.imageService || '').trim()
      : ''
    const pollerCompany = typeof payload === 'object' && payload !== null
      ? String(payload.companyName || '').trim()
      : ''
    if (pollerCompany && !isCompanyActive(pollerCompany)) {
      return { success: false, error: `La empresa ${pollerCompany} esta inactiva y no puede generar publicaciones.` }
    }

    const finalPollerPrompt = buildFullPrompt(rawPollerPrompt, pollerCompany, pollerService, pollerFormat)

    const env = getProjectEnv()
    // Persist poller logs so the GUI can tail them.
    env.PUBLICIDAD_LOG_FILE = path.join(PROJECT_ROOT, 'logs', 'job_poller.log')
    env.BOT_CUSTOM_IMAGE_PROMPT = finalPollerPrompt
    const publishPlatforms = Array.isArray(payload?.publishPlatforms)
      ? payload.publishPlatforms.filter(Boolean).join(',')
      : 'facebook'
    env.PUBLISH_PLATFORMS = publishPlatforms
    env.PYTHONIOENCODING = 'utf-8'
    env.PYTHONUNBUFFERED = '1'
    if (pollerCompany) {
      const companyEnv = buildCompanyCredentialEnv(pollerCompany)
      if (!companyEnv) {
        return { success: false, error: `No pude resolver las credenciales activas para ${pollerCompany}.` }
      }
      persistEnvConfig(companyEnv)
      Object.assign(env, companyEnv)
      env.PUBLICIDAD_COMPANY_NAME = pollerCompany
    }

    // Pass image dimensions to overlay_logo.py via env
    const pollerFmt = IMAGE_FORMATS[pollerFormat]
    if (pollerFmt) {
      env.BOT_IMAGE_WIDTH = String(pollerFmt.w)
      env.BOT_IMAGE_HEIGHT = String(pollerFmt.h)
    }
    const pollerPath = path.join(PROJECT_ROOT, 'server', 'job_poller.py')
    const pythonBin = findPython()
    if (!pythonBin) {
      return { success: false, error: 'Python no encontrado en PATH' }
    }

    try {
      // The poller writes its own logs to logs/job_poller.log via Python logger.
      // We don't pipe stdout to the log file — that causes EBUSY on Windows
      // when the log watcher also reads the file.
      state.pollerProcess = spawn(pythonBin, [pollerPath], {
        cwd: PROJECT_ROOT,
        env,
        stdio: 'ignore',
      })

      state.pollerProcess.on('exit', (code, signal) => {
        const detail = code !== null
          ? `codigo: ${code}`
          : `senal: ${signal || 'unknown'}`
        const line = `[INFO] Poller finalizo (${detail})`
        console.log(line)
        if (state.mainWindow) {
          state.mainWindow.webContents.send('log-new-lines', [line])
        }
        state.pollerProcess = null
      })

      return { success: true, pid: state.pollerProcess.pid }
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
        await stopPidBestEffort(pid)
      }
      state.pollerProcess = null
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

  ipcMain.handle('generate-default-prompt', async () => {
    // El textarea ahora solo muestra la idea del usuario, no el seed completo
    // El seed se inyecta internamente en buildFullPrompt()
    return { success: true, prompt: '' }
  })
}

module.exports = { registerPollerHandlers }
