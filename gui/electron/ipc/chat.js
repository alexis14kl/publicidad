/**
 * Chat Command Handler — Flujo: Genera visual → muestra preview → aprueba → publica.
 *
 * SIEMPRE genera la imagen/video ANTES de mostrar el preview al usuario.
 * Retiene contexto de conversación para acumular instrucciones.
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { PROJECT_ROOT } = require('../config/project-paths')
const { getProjectEnv } = require('../utils/env')
const { findPython } = require('../utils/process')
const { lookupCompanyData, isCompanyActive, buildCompanyCredentialEnv, buildFullPrompt } = require('../data/lookup')
const state = require('../state')

const pendingJobs = new Map()

// ─── Conversation Context — retains what the user has said ──────────────────
const conversationContext = {
  description: '',
  type: 'image',        // image | video | campaign
  platform: 'facebook',
  publishAs: 'post',    // post | story | reel | campaign
  companyName: '',
  budget: '50000',
  messages: [],          // history of user messages
}

function updateContext(text) {
  conversationContext.messages.push(text)
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Accumulate description
  const cleaned = text
    .replace(/^(genera|crea|publica|haz|diseña|lanza|quiero)\s+(una?\s+)?(imagen|foto|video|reel|campana|campaña|anuncio|publicacion)\s*(de|sobre|para|con)?\s*/i, '')
    .trim()
  if (cleaned.length > 3) {
    conversationContext.description = conversationContext.description
      ? `${conversationContext.description}. ${cleaned}`
      : cleaned
  }

  // Detect type (latest wins)
  if (/video|reel|clip|animacion/.test(lower)) conversationContext.type = 'video'
  else if (/campana|campaign|leads|anuncio|ads|pauta/.test(lower)) conversationContext.type = 'campaign'
  else if (/imagen|image|foto|genera|crear|disena/.test(lower)) conversationContext.type = 'image'

  // Detect platform
  if (/instagram|ig/.test(lower)) conversationContext.platform = 'instagram'
  else if (/tiktok/.test(lower)) conversationContext.platform = 'tiktok'
  else if (/facebook|fb/.test(lower)) conversationContext.platform = 'facebook'

  // Detect publish type
  if (/historia|story|stories/.test(lower)) conversationContext.publishAs = 'story'
  else if (/reel/.test(lower)) conversationContext.publishAs = 'reel'
  else if (/campana|campaign/.test(lower)) conversationContext.publishAs = 'campaign'
  else conversationContext.publishAs = 'post'

  // Detect company
  const companyMatch = text.match(/para\s+(?:la\s+empresa\s+)?["']?([A-Za-záéíóúñÁÉÍÓÚÑ0-9]+)["']?/i)
  if (companyMatch) {
    const candidate = companyMatch[1].trim()
    if (lookupCompanyData(candidate)) conversationContext.companyName = candidate
  }
  if (!conversationContext.companyName) {
    conversationContext.companyName = getProjectEnv().PUBLICIDAD_COMPANY_NAME || ''
  }

  // Detect budget
  const budgetMatch = text.match(/\$?\s*([\d,.]+)\s*(?:\/?\s*dia|cop|pesos|diarios)?/i)
  if (budgetMatch) conversationContext.budget = budgetMatch[1].replace(/[,.]/g, '')
}

function resetContext() {
  conversationContext.description = ''
  conversationContext.type = 'image'
  conversationContext.platform = 'facebook'
  conversationContext.publishAs = 'post'
  conversationContext.budget = '50000'
  conversationContext.messages = []
}

// ─── Content Generation (DiCloak + ChatGPT/Veo3) ───────────────────────────

async function generateContent(ctx) {
  const pythonBin = findPython()
  if (!pythonBin) throw new Error('Python no encontrado')

  const env = getProjectEnv()
  const botEnv = {
    ...env,
    PYTHONPATH: PROJECT_ROOT,
    NO_PAUSE: '1',
    PYTHONIOENCODING: 'utf-8',
    BOT_CONTENT_TYPE: ctx.type === 'video' ? 'reel' : 'image',
    PUBLISH_PLATFORMS: ctx.platform,
  }

  if (ctx.companyName) {
    const credEnv = buildCompanyCredentialEnv(ctx.companyName)
    if (credEnv) Object.assign(botEnv, credEnv)
    const company = lookupCompanyData(ctx.companyName)
    botEnv.PUBLICIDAD_COMPANY_NAME = ctx.companyName
    botEnv.BOT_COMPANY_NAME = company?.nombre || ''
    botEnv.BOT_COMPANY_PHONE = company?.telefono || ''
    botEnv.BOT_COMPANY_WEBSITE = company?.sitio_web || ''
  }

  // DON'T publish automatically — just generate
  botEnv.BOT_SKIP_PUBLISH = '1'

  const imagePrompt = buildFullPrompt(ctx.description, ctx.companyName, '', 'fb-vertical')
  const payload = JSON.stringify({
    profile_name: env.INITIAL_PROFILE || '#1 Chat Gpt PRO',
    image_prompt: imagePrompt,
  })

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, ['-m', 'core.server.bot_runner', 'run_full_cycle', payload], {
      cwd: PROJECT_ROOT, env: botEnv, stdio: 'ignore',
    })
    state.botProcess = child
    child.on('exit', (code) => {
      state.botProcess = null
      const outputDir = ctx.type === 'video'
        ? path.join(PROJECT_ROOT, 'output', 'videos')
        : path.join(PROJECT_ROOT, 'output', 'images')
      const latest = findLatestFile(outputDir)
      if (code === 0 && latest) {
        resolve(latest)
      } else if (latest) {
        // Even if exit code != 0, if we have an image, use it
        resolve(latest)
      } else {
        reject(new Error(`Generación terminó con código ${code}. No se encontró archivo generado.`))
      }
    })
  })
}

function findLatestFile(dir) {
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|mp4|webm)$/i.test(f))
    .map(f => ({ name: f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return files[0]?.full || null
}

// ─── Campaign Spec (dry-run) ────────────────────────────────────────────────

async function getCampaignPreview(ctx) {
  const pythonBin = findPython()
  if (!pythonBin) return null

  const env = getProjectEnv()
  const engineInput = {
    name: ctx.description,
    description: ctx.description,
    budget: ctx.budget,
    access_token: env.FB_ACCESS_TOKEN || '',
    ad_account_id: env.FB_AD_ACCOUNT_ID || 'act_438871067037500',
    page_id: env.FB_PAGE_ID || '115406607722279',
  }

  try {
    const stdout = await new Promise((resolve) => {
      let out = ''
      const child = spawn(pythonBin, ['-m', 'core.n8n.meta_campaign_engine', '--dry-run', '--stdin'], {
        cwd: PROJECT_ROOT, env: { ...env, PYTHONPATH: PROJECT_ROOT },
      })
      child.stdin.write(JSON.stringify(engineInput))
      child.stdin.end()
      child.stdout?.on('data', d => { out += d.toString() })
      child.on('exit', () => resolve(out))
    })
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

// ─── Publishing ─────────────────────────────────────────────────────────────

async function publishToMeta(job) {
  const { ctx, filePath } = job

  if (ctx.publishAs === 'campaign') {
    return publishCampaign(ctx)
  }

  // Publish image/video
  const pythonBin = findPython()
  if (!pythonBin) throw new Error('Python no encontrado')

  const env = getProjectEnv()
  const botEnv = { ...env, PYTHONPATH: PROJECT_ROOT, PYTHONIOENCODING: 'utf-8' }
  if (ctx.companyName) {
    const credEnv = buildCompanyCredentialEnv(ctx.companyName)
    if (credEnv) Object.assign(botEnv, credEnv)
  }

  const args = ['--platform', ctx.platform]
  if (filePath) args.push('--image-path', filePath)

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(pythonBin, [path.join(PROJECT_ROOT, 'core', 'n8n', 'public_img.py'), ...args], {
      cwd: PROJECT_ROOT, env: botEnv,
    })
    child.stdout?.on('data', d => { stdout += d.toString() })
    child.stderr?.on('data', d => { stderr += d.toString() })
    child.on('exit', (code) => {
      code === 0
        ? resolve({ success: true, message: `Publicado en ${ctx.platform}.` })
        : reject(new Error(stderr.slice(0, 300) || `exit ${code}`))
    })
  })
}

async function publishCampaign(ctx) {
  const pythonBin = findPython()
  if (!pythonBin) throw new Error('Python no encontrado')

  const env = getProjectEnv()
  const token = env.FB_ACCESS_TOKEN || ''
  if (!token) throw new Error('No hay FB_ACCESS_TOKEN en .env')

  const input = {
    name: ctx.description,
    description: ctx.description,
    budget: ctx.budget,
    access_token: token,
    ad_account_id: env.FB_AD_ACCOUNT_ID || 'act_438871067037500',
    page_id: env.FB_PAGE_ID || '115406607722279',
  }

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(pythonBin, ['-m', 'core.n8n.meta_campaign_engine', '--stdin'], {
      cwd: PROJECT_ROOT, env: { ...env, PYTHONPATH: PROJECT_ROOT },
    })
    child.stdin.write(JSON.stringify(input))
    child.stdin.end()
    child.stdout?.on('data', d => { stdout += d.toString() })
    child.stderr?.on('data', d => { stderr += d.toString() })
    child.on('exit', (code) => {
      try {
        const result = JSON.parse(stdout)
        const r = result.results || {}
        r.ok
          ? resolve({ success: true, message: `Campaña creada (PAUSED). ID: ${r.campaign?.id}` })
          : reject(new Error((r.errors || [])[0] || 'Error'))
      } catch {
        reject(new Error(stderr.slice(0, 300) || `exit ${code}`))
      }
    })
  })
}

// ─── Main Handler ───────────────────────────────────────────────────────────

async function handleChatCommand(text) {
  // Update context with new info from user
  updateContext(text)
  const ctx = { ...conversationContext }

  if (ctx.companyName && !isCompanyActive(ctx.companyName)) {
    return { success: false, error: `La empresa "${ctx.companyName}" está inactiva.` }
  }

  if (!ctx.description || ctx.description.length < 3) {
    return {
      success: true,
      message: 'Entendido. ¿Puedes darme más detalles sobre lo que quieres crear? '
        + 'Describe la imagen, video o campaña que necesitas.',
    }
  }

  const typeLabel = ctx.type === 'video' ? 'video' : ctx.type === 'campaign' ? 'imagen para la campaña' : 'imagen'

  // ── STEP 1: Generate visual content FIRST ──
  let filePath = null
  try {
    filePath = await generateContent(ctx)
  } catch (err) {
    // If generation fails, still show campaign preview without image
    if (ctx.type !== 'campaign') {
      return { success: false, error: `No se pudo generar la ${typeLabel}: ${err.message}` }
    }
  }

  // ── STEP 2: Get campaign spec if it's a campaign (AI analyzes) ──
  let spec = null
  let campaignInfo = ''
  if (ctx.type === 'campaign') {
    spec = await getCampaignPreview(ctx)
    if (spec) {
      const meta = spec.meta || {}
      const schedule = meta.schedule || {}

      // AI analysis and reasoning
      const aiAnalysis = meta.ai_analysis || ''
      const calendarReasoning = meta.ai_calendar_reasoning || ''
      const warnings = meta.ai_warnings || []

      // Extract audiences and their reasoning
      const adsets = spec.adsets || []
      const audienceLines = adsets.map((a) => {
        const dailyCop = Math.round((a.daily_budget || 0) / 100)
        const interestCount = a.interests_resolved || 0
        const cities = (a.targeting?.geo_locations?.cities || []).map(c => c.name).join(', ') || 'Colombia'
        return `• **${a.audience_key}** — $${dailyCop.toLocaleString()}/día | ${cities} | ${interestCount} intereses\n  _${a.reasoning || ''}_`
      }).join('\n')

      // Extract ad angles
      const adLines = adsets.flatMap(a => (a.ads || []).map(ad =>
        `• **${ad.angle || ad.name}**: "${(ad.creative?.object_story_spec?.link_data?.name || '').slice(0, 50)}..."\n  _${ad.reasoning || ''}_`
      )).join('\n')

      campaignInfo = '\n\n**Análisis del experto en marketing:**'
        + (aiAnalysis ? `\n${aiAnalysis}` : '')
        + `\n\n**Presupuesto:** $${schedule.daily_budget_cop?.toLocaleString() || ctx.budget}/día → $${schedule.total_budget_cop?.toLocaleString() || '?'} total`
        + `\n**Duración:** ${schedule.total_days || '?'} días (inicio ${schedule.start_date || '?'})`
        + (calendarReasoning ? `\n_${calendarReasoning}_` : '')
        + `\n\n**Audiencias y segmentación:**\n${audienceLines || '(sin audiencias)'}`
        + `\n\n**Anuncios:**\n${adLines || '(sin anuncios)'}`
        + (warnings.length ? `\n\n**Alertas:**\n${warnings.map(w => `⚠️ ${w}`).join('\n')}` : '')
        + `\n\n**Estado:** Todo se crea en PAUSED`
    }
  }

  // ── STEP 3: Show preview with image + justification ──
  const publishLabel = ctx.publishAs === 'story' ? 'historia' : ctx.publishAs === 'reel' ? 'reel' : ctx.type === 'campaign' ? 'campaña' : 'publicación'

  const jobId = `job-${Date.now()}`
  pendingJobs.set(jobId, { ctx: { ...ctx }, filePath, spec })

  let message = ''
  if (ctx.type === 'campaign') {
    message = `He analizado tu solicitud: **"${ctx.description}"**\n\n`
      + (filePath ? `La imagen promocional está lista (se muestra abajo).` : `No se pudo generar la imagen promocional.`)
      + campaignInfo
      + `\n\n¿Apruebas esta campaña?`
  } else {
    message = filePath
      ? `Tu ${typeLabel} está lista para **${ctx.platform}**${ctx.companyName ? ` (${ctx.companyName})` : ''}.\n\nSe publicará como **${publishLabel}**.\n\n¿Apruebas?`
      : `No se pudo generar la ${typeLabel}. ¿Quieres intentar con otra descripción?`
  }

  return {
    success: true,
    needsApproval: !!filePath || ctx.type === 'campaign',
    jobId,
    message,
    preview: {
      type: ctx.type,
      imagePath: filePath,
      summary: ctx.type === 'campaign'
        ? `${Object.keys(spec?.meta?.budget_distribution || {}).length} audiencias | $${Number(ctx.budget).toLocaleString()}/día | ${[...new Set((spec?.adsets || []).flatMap(a => (a?.targeting?.geo_locations?.cities || []).map(c => c.name)))].join(', ') || 'Colombia'}`
        : `${ctx.platform} | ${publishLabel}`,
      campaignSpec: spec,
    },
  }
}

async function handleChatApprove(jobId) {
  const job = pendingJobs.get(jobId)
  if (!job) return { success: false, error: 'No hay contenido pendiente.' }
  pendingJobs.delete(jobId)

  try {
    const result = await publishToMeta(job)
    resetContext()
    return result
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

// ─── IPC ────────────────────────────────────────────────────────────────────

function registerChatHandlers(ipcMain) {
  ipcMain.handle('chat-command', async (_event, text) => {
    try {
      return await handleChatCommand(String(text || '').trim())
    } catch (err) {
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('chat-approve', async (_event, jobId) => {
    try {
      return await handleChatApprove(String(jobId || ''))
    } catch (err) {
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('chat-reset', async () => {
    resetContext()
    return { success: true }
  })
}

module.exports = { registerChatHandlers }
