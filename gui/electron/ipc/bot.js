const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { PROJECT_ROOT } = require('../config/project-paths')
const { getProjectEnv } = require('../utils/env')
const { readJsonFile, persistEnvConfig } = require('../utils/helpers')
const { findPython, killProcessTree } = require('../utils/process')
const { IMAGE_FORMATS } = require('../config/image-formats')
const state = require('../state')
const { isPollerAlive } = require('../services/campaign-process')
const { lookupCompanyData, isCompanyActive, buildCompanyCredentialEnv, buildFullPrompt, buildBrochurePrompt } = require('../data/lookup')
const { analyzePrePromptServices } = require('../services/service-analyzer')
const { analyzeVideoScenes } = require('../services/video-scene-analyzer')
const workerManager = require('../services/worker-manager')

function registerBotHandlers(ipcMain) {
  ipcMain.handle('get-bot-status', async () => {
    // Check worker manager for active jobs
    const activeJobs = workerManager.listJobs({ status: ['running', 'claimed', 'queued'] })
    const runningJobs = activeJobs.filter(j => j.status === 'running' || j.status === 'claimed')

    if (runningJobs.length > 0) {
      return {
        status: 'executing',
        action: runningJobs[0].action || 'run_full_cycle',
        started_at: runningJobs[0].started_at || 0,
        host: '',
        pid: runningJobs[0].worker_pid || null,
        jobs: activeJobs.map(j => ({
          jobId: j.job_id,
          action: j.action,
          workerType: j.worker_type,
          status: j.status,
          startedAt: j.started_at,
          companyName: j.company_name,
        })),
      }
    }

    // Fallback: check legacy lock file (for external bot_runner invocations)
    const lockPath = path.join(PROJECT_ROOT, '.bot_runner.lock')
    const lockData = readJsonFile(lockPath)
    if (lockData && lockData.pid) {
      return {
        status: 'executing',
        action: lockData.action || 'run_full_cycle',
        started_at: lockData.started_at || 0,
        host: lockData.host || '',
        pid: lockData.pid,
        jobs: [],
      }
    }

    if (state.botProcess && state.botProcess.exitCode === null) {
      return {
        status: 'executing',
        action: 'run_full_cycle',
        started_at: null,
        host: null,
        pid: state.botProcess.pid,
        jobs: [],
      }
    }

    const pollerRunning = state.pollerProcess && state.pollerProcess.exitCode === null

    return {
      status: pollerRunning ? 'online' : 'offline',
      action: null,
      started_at: null,
      host: null,
      pid: null,
      jobs: activeJobs.map(j => ({
        jobId: j.job_id,
        action: j.action,
        workerType: j.worker_type,
        status: j.status,
        startedAt: j.started_at,
        companyName: j.company_name,
      })),
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
    const videoScenePrompts = Array.isArray(payload?.videoScenePrompts)
      ? payload.videoScenePrompts
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      : []

    if (companyName && !isCompanyActive(companyName)) {
      return { success: false, error: `La empresa ${companyName} esta inactiva y no puede generar publicaciones.` }
    }

    // Build environment overrides for the worker
    const envOverrides = {}

    if (companyName) {
      const company = lookupCompanyData(companyName)
      const companyEnv = buildCompanyCredentialEnv(companyName)
      if (!companyEnv || !company) {
        return { success: false, error: `No pude resolver las credenciales activas para ${companyName}.` }
      }
      persistEnvConfig(companyEnv)
      Object.assign(envOverrides, companyEnv)
      envOverrides.PUBLICIDAD_COMPANY_NAME = companyName
      envOverrides.BOT_COMPANY_NAME = String(company.nombre || '')
      envOverrides.BOT_COMPANY_PHONE = String(company.telefono || '')
      envOverrides.BOT_COMPANY_WEBSITE = String(company.sitio_web || '')
      envOverrides.BOT_COMPANY_EMAIL = String(company.correo || '')
      envOverrides.BOT_COMPANY_ADDRESS = String(company.direccion || '')
      if (company.logo) {
        const resolvedLogoPath = path.isAbsolute(company.logo)
          ? company.logo
          : path.join(PROJECT_ROOT, company.logo)
        if (fs.existsSync(resolvedLogoPath)) {
          envOverrides.BOT_COMPANY_LOGO_PATH = resolvedLogoPath
        }
      }
    }

    const botFmt = IMAGE_FORMATS[imageFormat]
    if (botFmt) {
      envOverrides.BOT_IMAGE_WIDTH = String(botFmt.w)
      envOverrides.BOT_IMAGE_HEIGHT = String(botFmt.h)
    }
    envOverrides.PUBLISH_PLATFORMS = publishPlatforms
    envOverrides.BOT_CONTENT_TYPE = contentType
    if (reelTitle) envOverrides.BOT_REEL_TITLE = reelTitle
    if (reelCaption) envOverrides.BOT_REEL_CAPTION = reelCaption
    if (contentType === 'reel' && videoScenePrompts.length > 0) {
      envOverrides.BOT_VIDEO_SCENE_PROMPTS_JSON = JSON.stringify(videoScenePrompts)
    }

    const brochureCustomColors = typeof payload === 'object' && payload !== null
      ? payload.brochureCustomColors || null
      : null
    const brochureLogoPath = typeof payload === 'object' && payload !== null
      ? String(payload.brochureLogoPath || '').trim()
      : ''

    let imagePrompt
    if (contentType === 'brochure') {
      imagePrompt = rawPrompt
      if (brochureLogoPath) envOverrides.BROCHURE_LOGO_PATH = brochureLogoPath
      const company = lookupCompanyData(companyName)
      if (company) {
        envOverrides.BROCHURE_PHONE = company.telefono || ''
        envOverrides.BROCHURE_EMAIL = company.correo || ''
        envOverrides.BROCHURE_WEBSITE = company.sitio_web || ''
        envOverrides.BROCHURE_ADDRESS = company.direccion || ''
        envOverrides.BROCHURE_DESCRIPTION = company.descripcion || ''
        envOverrides.BROCHURE_COLOR_PRIMARIO = brochureCustomColors?.color_primario || company.color_primario || '#3469ED'
        envOverrides.BROCHURE_COLOR_CTA = brochureCustomColors?.color_cta || company.color_cta || '#fd9102'
        envOverrides.BROCHURE_COLOR_ACENTO = brochureCustomColors?.color_acento || company.color_acento || '#00bcd4'
        envOverrides.BROCHURE_COLOR_CHECKS = brochureCustomColors?.color_checks || company.color_checks || '#28a745'
        envOverrides.BROCHURE_COLOR_FONDO = brochureCustomColors?.color_fondo || company.color_fondo || '#f0f0f5'
      }
    } else if (contentType === 'reel') {
      imagePrompt = rawPrompt
    } else {
      imagePrompt = buildFullPrompt(rawPrompt, companyName, imageService, imageFormat)
    }

    // Determine worker type and resource key
    const workerType = contentType === 'reel' ? 'video'
      : contentType === 'brochure' ? 'brochure'
      : 'cdp'
    const resourceKey = workerType === 'cdp' ? `cdp:profile:${profileName || 'default'}`
      : workerType === 'video' ? 'video:slot'
      : ''

    try {
      const jobId = workerManager.enqueueJob({
        action: 'run_full_cycle',
        workerType,
        resourceKey,
        payload: {
          ...(profileName ? { profile_name: profileName } : {}),
          ...(imagePrompt ? { image_prompt: imagePrompt } : {}),
          env: envOverrides,
        },
        priority: 30,
        source: 'gui',
        companyName,
      })
      return { success: true, jobId }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('stop-bot', async () => {
    let killed = false

    // Cancel all active jobs in worker manager
    const activeJobs = workerManager.listJobs({ status: ['running', 'claimed', 'queued'] })
    for (const job of activeJobs) {
      try {
        workerManager.cancelJob(job.job_id)
        killed = true
      } catch { /* ignore */ }
    }

    // Fallback: check legacy lock file
    const lockPath = path.join(PROJECT_ROOT, '.bot_runner.lock')
    const lockData = readJsonFile(lockPath)
    if (lockData && lockData.pid) {
      try {
        killProcessTree(lockData.pid)
        killed = true
      } catch { /* ignore */ }
      try {
        fs.unlinkSync(lockPath)
      } catch { /* ignore */ }
    }

    // Also kill legacy GUI-spawned bot process
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
