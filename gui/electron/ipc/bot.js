const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { PROJECT_ROOT } = require('../config/project-paths')
const { getProjectEnv } = require('../utils/env')
const { readJsonFile, persistEnvConfig } = require('../utils/helpers')
const { findPython, killProcessTree } = require('../utils/process')
const { IMAGE_FORMATS } = require('../config/image-formats')
const state = require('../state')
const { isPollerAlive } = require('../marketing/campaign-process')
const { lookupCompanyData, isCompanyActive, buildCompanyCredentialEnv, buildFullPrompt, buildBrochurePrompt } = require('../company/lookup')
const { analyzePrePromptServices } = require('../marketing/service-analyzer')
const { analyzeVideoScenes } = require('../marketing/video-scene-analyzer')

function registerBotHandlers(ipcMain) {
  ipcMain.handle('get-bot-status', async () => {
    const lockPath = path.join(PROJECT_ROOT, '.bot_runner.lock')
    const lockData = readJsonFile(lockPath)

    // Check bot process (lock file or GUI-spawned process)
    if (lockData && lockData.pid) {
      return {
        status: 'executing',
        action: lockData.action || 'run_full_cycle',
        started_at: lockData.started_at || 0,
        host: lockData.host || '',
        pid: lockData.pid,
      }
    }

    if (state.botProcess && state.botProcess.exitCode === null) {
      return {
        status: 'executing',
        action: 'run_full_cycle',
        started_at: null,
        host: null,
        pid: state.botProcess.pid,
      }
    }

    // Check poller ONLY by GUI-spawned process (no PowerShell scan)
    const pollerRunning = state.pollerProcess && state.pollerProcess.exitCode === null

    return {
      status: pollerRunning ? 'online' : 'offline',
      action: null,
      started_at: null,
      host: null,
      pid: null,
    }
  })

  ipcMain.handle('get-last-job', async () => {
    return readJsonFile(path.join(PROJECT_ROOT, '.job_poller_state.json'))
  })

  ipcMain.handle('analyze-image-services', async (_event, payload = {}) => {
    try {
      const prePrompt = typeof payload === 'object' && payload !== null
        ? String(payload.prePrompt || '').trim()
        : ''
      return analyzePrePromptServices(prePrompt)
    } catch (error) {
      return {
        suggestions: [],
        error: error instanceof Error ? error.message : 'No pude analizar el pre-prompt.',
      }
    }
  })

  ipcMain.handle('analyze-video-scenes', async (_event, payload = {}) => {
    try {
      const prePrompt = typeof payload === 'object' && payload !== null
        ? String(payload.prePrompt || '').trim()
        : ''
      return analyzeVideoScenes(prePrompt)
    } catch (error) {
      return {
        agentName: 'video-scene-creator',
        sourcePath: '',
        summary: 'No pude analizar el prompt del video.',
        scenes: [],
        compiledPrompt: '',
        error: error instanceof Error ? error.message : 'No pude analizar el prompt del video.',
      }
    }
  })

  ipcMain.handle('start-bot', async (_event, payload) => {
    const lockPath = path.join(PROJECT_ROOT, '.bot_runner.lock')
    if (fs.existsSync(lockPath)) {
      const lock = readJsonFile(lockPath)
      if (lock && lock.pid) {
        return { success: false, error: 'Bot ya esta ejecutando' }
      }
    }

    if (state.botProcess && state.botProcess.exitCode === null) {
      return { success: false, error: 'Bot ya esta ejecutando (proceso GUI)' }
    }

    const env = getProjectEnv()
    env['NO_PAUSE'] = '1'
    // Force UTF-8 output from Python
    env['PYTHONIOENCODING'] = 'utf-8'

    const profileName = typeof payload === 'string'
      ? payload
      : String(payload?.profileName || '').trim()
    const rawPrompt = typeof payload === 'object' && payload !== null
      ? String(payload.imagePrompt || '').trim()
      : ''
    const imageFormat = typeof payload === 'object' && payload !== null
      ? String(payload.imageFormat || '').trim()
      : ''
    const imageService = typeof payload === 'object' && payload !== null
      ? String(payload.imageService || '').trim()
      : ''
    const companyName = typeof payload === 'object' && payload !== null
      ? String(payload.companyName || '').trim()
      : ''
    const publishPlatforms = Array.isArray(payload?.publishPlatforms)
      ? payload.publishPlatforms.filter(Boolean).join(',')
      : 'facebook'
    const contentType = typeof payload === 'object' && payload !== null
      ? String(payload.contentType || 'image').trim()
      : 'image'
    const reelTitle = typeof payload === 'object' && payload !== null
      ? String(payload.reelTitle || '').trim()
      : ''
    const reelCaption = typeof payload === 'object' && payload !== null
      ? String(payload.reelCaption || '').trim()
      : ''

    if (companyName && !isCompanyActive(companyName)) {
      return { success: false, error: `La empresa ${companyName} esta inactiva y no puede generar publicaciones.` }
    }

    if (companyName) {
      const companyEnv = buildCompanyCredentialEnv(companyName)
      if (!companyEnv) {
        return { success: false, error: `No pude resolver las credenciales activas para ${companyName}.` }
      }
      persistEnvConfig(companyEnv)
      Object.assign(env, companyEnv)
      env.PUBLICIDAD_COMPANY_NAME = companyName
    }

    // Pass image dimensions to overlay_logo.py via env
    const botFmt = IMAGE_FORMATS[imageFormat]
    if (botFmt) {
      env.BOT_IMAGE_WIDTH = String(botFmt.w)
      env.BOT_IMAGE_HEIGHT = String(botFmt.h)
    }
    env.PUBLISH_PLATFORMS = publishPlatforms
    env.BOT_CONTENT_TYPE = contentType
    if (reelTitle) env.BOT_REEL_TITLE = reelTitle
    if (reelCaption) env.BOT_REEL_CAPTION = reelCaption

    // Extraer colores custom para brochure (si los hay)
    const brochureCustomColors = typeof payload === 'object' && payload !== null
      ? payload.brochureCustomColors || null
      : null
    const brochureLogoPath = typeof payload === 'object' && payload !== null
      ? String(payload.brochureLogoPath || '').trim()
      : ''

    let imagePrompt
    if (contentType === 'brochure') {
      imagePrompt = buildBrochurePrompt(rawPrompt, companyName, brochureCustomColors)
      if (brochureLogoPath) env.BROCHURE_LOGO_PATH = brochureLogoPath
    } else if (contentType === 'reel') {
      imagePrompt = rawPrompt
    } else {
      imagePrompt = buildFullPrompt(rawPrompt, companyName, imageService, imageFormat)
    }

    const botRunnerPath = path.join(PROJECT_ROOT, 'server', 'bot_runner.py')
    const pythonBin = findPython()
    if (!pythonBin) {
      return { success: false, error: 'Python no encontrado en PATH' }
    }

    const runnerPayload = (profileName || imagePrompt)
      ? JSON.stringify({
        ...(profileName ? { profile_name: profileName } : {}),
        ...(imagePrompt ? { image_prompt: imagePrompt } : {}),
      })
      : '{}'
    const args = [botRunnerPath, 'run_full_cycle', runnerPayload]

    try {
      state.botProcess = spawn(pythonBin, args, {
        cwd: PROJECT_ROOT,
        env,
        stdio: 'ignore',
      })

      state.botProcess.on('exit', (code) => {
        if (state.mainWindow) {
          state.mainWindow.webContents.send('bot-log-lines', [
            `[INFO] Bot finalizo con codigo: ${code}`
          ])
        }
        state.botProcess = null
      })

      return { success: true, pid: state.botProcess.pid }
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
    if (state.botProcess && state.botProcess.exitCode === null) {
      try {
        killProcessTree(state.botProcess.pid)
        killed = true
      } catch { /* ignore */ }
      state.botProcess = null
    }

    return killed
      ? { success: true }
      : { success: false, error: 'Bot no esta ejecutando' }
  })
}

module.exports = { registerBotHandlers }
