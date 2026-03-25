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
const { lookupCompanyData, isCompanyActive, getDefaultActiveCompany, buildCompanyCredentialEnv, buildFullPrompt } = require('../data/lookup')
const state = require('../state')

const pendingJobs = new Map()

/** Simple POST to Meta Graph API (JSON body, returns parsed JSON). */
function metaApiPost(endpoint, params) {
  const https = require('https')
  const qs = require('querystring')
  const body = qs.stringify(params)
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v25.0${endpoint}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (result.error) reject(new Error(`Meta API: ${result.error.message || JSON.stringify(result.error)}`))
          else resolve(result)
        } catch { reject(new Error(`Meta respuesta invalida: ${data.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─── Conversation Context — retains what the user has said ──────────────────
const conversationContext = {
  description: '',
  type: 'image',        // image | video | campaign | video_campaign
  platform: 'facebook',
  publishAs: 'post',    // post | story | reel | campaign
  companyName: '',
  budget: '50000',
  messages: [],          // history of user messages
}

function updateContext(text) {
  conversationContext.messages.push(text)
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Accumulate description within the session
  const cleaned = text
    .replace(/^(genera|crea|publica|haz|diseña|lanza|quiero)\s+(una?\s+)?(imagen|foto|video|reel|campana|campaña|anuncio|publicacion)\s*(de|sobre|para|con)?\s*/i, '')
    .trim()
  if (cleaned.length > 10) {
    // If the new message is substantial (>10 chars), use it as THE description
    conversationContext.description = cleaned
  } else if (cleaned.length > 3 && !conversationContext.description) {
    // Short addition only if we don't have a description yet
    conversationContext.description = cleaned
  }

  // Detect type — image is DEFAULT, campaign/video only if explicitly mentioned
  if (/video|reel|clip|animacion/.test(lower)) {
    conversationContext.type = 'video'
  } else if (/campan[aã]|campaign|leads|anuncio(?:s)?(?:\s+pag(?:ados|ado))?|ads\b|pauta/.test(lower)) {
    conversationContext.type = 'campaign'
  } else {
    // Default: image (including "genera imagen", "crea una foto", or just a description)
    conversationContext.type = 'image'
  }

  // Detect platform
  if (/instagram|ig\b/.test(lower)) conversationContext.platform = 'instagram'
  else if (/tiktok/.test(lower)) conversationContext.platform = 'tiktok'
  else if (!conversationContext.platform) conversationContext.platform = 'facebook'

  // Detect publish type — derived from content type
  if (conversationContext.type === 'video') conversationContext.publishAs = 'reel'
  else if (conversationContext.type === 'video_campaign') conversationContext.publishAs = 'campaign'
  else if (conversationContext.type === 'campaign') conversationContext.publishAs = 'campaign'
  else if (/historia|story|stories/.test(lower)) conversationContext.publishAs = 'story'
  else conversationContext.publishAs = 'post'

  // Detect company
  const companyMatch = text.match(/para\s+(?:la\s+empresa\s+)?["']?([A-Za-záéíóúñÁÉÍÓÚÑ0-9]+)["']?/i)
  if (companyMatch) {
    const candidate = companyMatch[1].trim()
    if (lookupCompanyData(candidate)) conversationContext.companyName = candidate
  }
  if (!conversationContext.companyName) {
    // Auto-detect: use the first active company from the database
    const defaultCompany = getDefaultActiveCompany()
    if (defaultCompany?.nombre) {
      conversationContext.companyName = defaultCompany.nombre
    }
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
  if (ctx.type === 'video_campaign') {
    // Video + Campaign: generate BOTH video and image in sequence
    return generateVideoCampaignContent(ctx)
  }
  return generateSingleContent(ctx)
}

async function generateSingleContent(ctx) {
  const pythonBin = findPython()
  if (!pythonBin) throw new Error('Python no encontrado')

  const env = getProjectEnv()
  const isVideo = ctx.type === 'video' || ctx.type === 'video_campaign'
  const botEnv = {
    ...env,
    PYTHONPATH: PROJECT_ROOT,
    NO_PAUSE: '1',
    PYTHONIOENCODING: 'utf-8',
    BOT_CONTENT_TYPE: isVideo ? 'reel' : 'image',
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
    // For video overlay (ffmpeg branding)
    botEnv.BUSINESS_WEBSITE = company?.sitio_web || env.BUSINESS_WEBSITE || ''
    botEnv.BUSINESS_WHATSAPP = company?.telefono || env.BUSINESS_WHATSAPP || ''
    // Logo for video overlay
    if (company?.logo) {
      const logoDir = path.join(PROJECT_ROOT, 'assets', 'logos', 'companies')
      const logoPath = path.join(logoDir, company.logo)
      if (fs.existsSync(logoPath)) {
        botEnv.BOT_COMPANY_LOGO_PATH = logoPath
      }
    }
  }

  botEnv.BOT_SKIP_PUBLISH = '1'

  // MANDATORY: Claude must provide the image prompt. No fallbacks.
  if (!ctx.aiImagePrompt) {
    throw new Error('Los agentes expertos no generaron el prompt de imagen. Verifica la conexión con Claude (ANTHROPIC_API_KEY).')
  }
  console.log('[GENERATE] Using Claude AI image prompt:', ctx.aiImagePrompt.slice(0, 100))
  const imagePrompt = `Generate this image now:\n\n${ctx.aiImagePrompt}\n\nAll visible text in the image MUST be in Spanish. Full-bleed design, no margins. Reserve top 8% for logo. Deliver exactly ONE final image.`

  const payload = JSON.stringify({
    ...(!isVideo ? { profile_name: env.INITIAL_PROFILE || '#1 Chat Gpt PRO' } : {}),
    image_prompt: imagePrompt,
  })

  // Record timestamp BEFORE generation to distinguish new files from old ones
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, ['-m', 'core.server.bot_runner', 'run_full_cycle', payload], {
      cwd: PROJECT_ROOT, env: botEnv, stdio: 'ignore',
    })
    state.botProcess = child
    child.on('exit', (code) => {
      state.botProcess = null
      const outputDir = isVideo
        ? path.join(PROJECT_ROOT, 'output', 'videos')
        : path.join(PROJECT_ROOT, 'output', 'images')
      // Only accept files created AFTER we started generation
      const newFile = findFileNewerThan(outputDir, startTime)
      if (newFile) {
        resolve(newFile)
      } else {
        reject(new Error(
          code === 0
            ? 'El bot terminó OK pero no se generó un archivo nuevo. Revisa que DiCloak esté abierto y ChatGPT tenga sesión activa.'
            : `El bot terminó con código ${code}. Revisa los logs del bot.`
        ))
      }
    })
  })
}

function findFileNewerThan(dir, afterMs) {
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|mp4|webm)$/i.test(f))
    .map(f => ({ full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .filter(f => f.mtime > afterMs)
    .sort((a, b) => b.mtime - a.mtime)
  return files[0]?.full || null
}

// ─── Campaign Spec (dry-run) ────────────────────────────────────────────────

async function getCampaignPreview(ctx) {
  const pythonBin = findPython()
  if (!pythonBin) return null

  const env = getProjectEnv()

  // ── Inject company context — Claude MUST know the brand ──
  const companyName = ctx.companyName || env.PUBLICIDAD_COMPANY_NAME || ''
  const company = companyName ? lookupCompanyData(companyName) : null
  const brandName = company?.nombre || companyName || 'NoyeCode'
  const brandWebsite = company?.sitio_web || env.BUSINESS_WEBSITE || 'noyecode.com'
  const brandPhone = company?.telefono || env.BUSINESS_WHATSAPP || ''
  const brandDescription = company?.descripcion || ''

  const companyContext = [
    `Empresa: ${brandName}`,
    brandWebsite ? `Web: ${brandWebsite}` : '',
    brandPhone ? `Contacto: ${brandPhone}` : '',
    brandDescription ? `Descripcion: ${brandDescription}` : '',
  ].filter(Boolean).join('. ')

  const engineInput = {
    name: `${brandName} - ${ctx.description}`,
    description: `${companyContext}\n\nSolicitud: ${ctx.description}`,
    budget: ctx.budget,
    content_type: ctx.type,  // image, video, or campaign
    access_token: env.FB_ACCESS_TOKEN || '',
    ad_account_id: env.FB_AD_ACCOUNT_ID || 'act_438871067037500',
    page_id: env.FB_PAGE_ID || '115406607722279',
    company_name: brandName,
    company_website: brandWebsite,
    company_phone: brandPhone,
  }

  try {
    const { stdout, stderr } = await new Promise((resolve) => {
      let out = ''
      let err = ''
      const child = spawn(pythonBin, ['-m', 'core.n8n.meta_campaign_engine', '--dry-run', '--stdin'], {
        cwd: PROJECT_ROOT, env: { ...env, PYTHONPATH: PROJECT_ROOT, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || '' },
      })
      child.stdin.write(JSON.stringify(engineInput))
      child.stdin.end()
      child.stdout?.on('data', d => { out += d.toString() })
      child.stderr?.on('data', d => { err += d.toString() })
      child.on('exit', () => resolve({ stdout: out, stderr: err }))
    })

    // Log stderr (Claude analysis progress)
    if (stderr) {
      for (const line of stderr.split('\n').filter(Boolean)) {
        console.log('[CAMPAIGN-ENGINE]', line)
      }
    }

    if (!stdout.trim()) {
      console.error('[CAMPAIGN-ENGINE] No output from engine. stderr:', stderr.slice(0, 300))
      return null
    }

    const spec = JSON.parse(stdout)
    if (spec?.meta?.image_prompt) {
      console.log('[CAMPAIGN-ENGINE] image_prompt:', spec.meta.image_prompt.slice(0, 100))
    } else {
      console.warn('[CAMPAIGN-ENGINE] No image_prompt in spec')
    }
    return spec
  } catch (err) {
    console.error('[CAMPAIGN-ENGINE] Parse error:', err.message)
    return null
  }
}

// ─── Caption Builder (uses Claude's copywriting) ─────────────────────────────

function buildPublishCaption(spec, _ctx) {
  /**
   * Construye el caption profesional para publicar en redes sociales.
   * SOLO usa copy generado por Claude. NUNCA publica la descripcion cruda del usuario.
   *
   * Prioridad:
   *   1. post_caption de Claude (copywriting con Hook→Contexto→Valor→Prueba→CTA)
   *   2. primary_text del primer anuncio (copy del ads-analyst)
   *   3. ai_analysis resumido (analisis estrategico)
   *   4. Minimo: website de la empresa
   */
  const meta = spec?.meta || {}
  const env = getProjectEnv()
  const website = env.BUSINESS_WEBSITE || 'noyecode.com'

  // Parse hashtags — Claude may return array or string
  let rawHashtags = meta.post_hashtags || []
  if (typeof rawHashtags === 'string') {
    rawHashtags = rawHashtags.split(/[,\s]+/).filter(Boolean)
  }
  const hashtags = Array.isArray(rawHashtags) && rawHashtags.length
    ? '\n\n' + rawHashtags
        .map(h => String(h).trim())
        .filter(h => h.length > 1)
        .map(h => h.startsWith('#') ? h : `#${h}`)
        .join(' ')
    : ''

  // 1. post_caption — el copy profesional del agente copywriting
  const postCaption = (meta.post_caption || '').trim()
  if (postCaption) {
    return postCaption + hashtags
  }

  // 2. primary_text del primer anuncio
  const adsets = spec?.adsets || []
  const firstAd = adsets.flatMap(a => a.ads || []).find(ad => ad.primary_text)
  if (firstAd?.primary_text) {
    return firstAd.primary_text.trim() + hashtags
  }

  // 3. ai_analysis como caption (mejor que nada, pero profesional)
  const analysis = (meta.ai_analysis || '').trim()
  if (analysis) {
    return analysis.slice(0, 400) + `\n\n${website}` + hashtags
  }

  // 4. Solo website — NUNCA la descripcion cruda del usuario
  return website
}

// ─── Publishing ─────────────────────────────────────────────────────────────

async function publishToMeta(job) {
  const { ctx, filePath, spec } = job

  if (ctx.publishAs === 'campaign' || ctx.type === 'campaign') {
    // Use the SAME spec the AI already generated — don't regenerate
    return executeCampaignSpec(spec, filePath)
  }

  // Publish image/video directly via Meta API REST (POST /{PAGE_ID}/photos)
  if (!filePath) throw new Error('No hay imagen para publicar.')

  const env = getProjectEnv()
  const pageToken = env.FB_PAGE_ACCESS_TOKEN || env.FB_ACCESS_TOKEN || ''
  const pageId = env.FB_PAGE_ID || '115406607722279'
  if (!pageToken) throw new Error('No hay FB_ACCESS_TOKEN ni FB_PAGE_ACCESS_TOKEN en .env')

  // Build caption from Claude's analysis
  const analysis = spec?.meta?.ai_analysis || ''
  const caption = analysis
    ? `${ctx.description}\n\n${analysis.slice(0, 200)}\n\nnoyecode.com`
    : `${ctx.description}\n\nnoyecode.com`

  // Read image and convert to base64 for multipart upload
  const imageBuffer = fs.readFileSync(filePath)
  const boundary = '----FormBoundary' + Date.now().toString(36)
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`
    ),
    imageBuffer,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="message"\r\n\r\n${caption}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${pageToken}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="published"\r\n\r\ntrue\r\n` +
      `--${boundary}--\r\n`
    ),
  ])

  const https = require('https')
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v25.0/${pageId}/photos`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (result.id || result.post_id) {
            resolve({ success: true, message: `Publicado en ${ctx.platform}. Post ID: ${result.post_id || result.id}` })
          } else if (result.error) {
            reject(new Error(`Meta API: ${result.error.message || JSON.stringify(result.error)}`))
          } else {
            resolve({ success: true, message: `Publicado en ${ctx.platform}.` })
          }
        } catch {
          reject(new Error(`Respuesta inesperada de Meta: ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function executeCampaignSpec(spec, imagePath) {
  /**
   * Ejecuta el spec que el AI ya generó — NO vuelve a analizar.
   * Pasa la imagen generada por DiCloak al spec para que los creativos la usen.
   */
  const pythonBin = findPython()
  if (!pythonBin) throw new Error('Python no encontrado')

  const env = getProjectEnv()
  const token = env.FB_ACCESS_TOKEN || ''
  if (!token) throw new Error('No hay FB_ACCESS_TOKEN en .env')

  if (!spec || !spec.campaign) {
    throw new Error('No hay spec de campaña para ejecutar.')
  }

  // Inject access_token and image path into the spec
  spec._execute = true
  spec._access_token = token
  if (imagePath) {
    spec._image_path = imagePath
  }

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    // Pass the FULL spec via stdin with --execute flag
    const child = spawn(pythonBin, ['-m', 'core.n8n.meta_campaign_engine', '--stdin', '--execute-spec'], {
      cwd: PROJECT_ROOT, env: { ...env, PYTHONPATH: PROJECT_ROOT, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || '' },
    })
    child.stdin.write(JSON.stringify(spec))
    child.stdin.end()
    child.stdout?.on('data', d => { stdout += d.toString() })
    child.stderr?.on('data', d => { stderr += d.toString() })
    child.on('exit', (code) => {
      try {
        const result = JSON.parse(stdout)
        const r = result.results || result
        if (r.ok) {
          const adsets = (r.adsets || []).filter(a => a.id)
          const adCount = adsets.reduce((sum, a) => sum + (a.ads || []).length, 0)
          resolve({
            success: true,
            message: `Campaña creada en Meta Ads (PAUSED).\n\n`
              + `• ID Campaña: ${r.campaign?.id}\n`
              + `• ${adsets.length} conjuntos de anuncios\n`
              + `• ${adCount} anuncios\n`
              + (imagePath ? `• Imagen incluida en los creativos` : ''),
          })
        } else {
          reject(new Error((r.errors || [])[0] || 'Error creando campaña'))
        }
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

  const typeLabel = ctx.type === 'video_campaign' ? 'video + campaña'
    : ctx.type === 'video' ? 'video'
    : ctx.type === 'campaign' ? 'imagen para la campaña'
    : 'imagen'

  // ══════════════════════════════════════════════════════════════════════
  // STEP 1: MANDATORY — Claude analyzes via skills/agents
  // Sin respuesta de Claude = no continuar. NADA se genera sin análisis.
  // ══════════════════════════════════════════════════════════════════════
  console.log('[CHAT] Step 1: Sending to Claude for analysis...')
  const spec = await getCampaignPreview(ctx)

  if (!spec || !spec.meta || spec.meta.error) {
    const reason = spec?.meta?.error || 'Claude no respondió'
    return {
      success: false,
      error: `Los agentes expertos no pudieron analizar tu solicitud: ${reason}.\n\nVerifica que ANTHROPIC_API_KEY esté configurada en .env y que el servicio esté disponible. Intenta de nuevo.`,
    }
  }

  if (!spec.meta.image_prompt) {
    return {
      success: false,
      error: 'Claude analizó la solicitud pero no generó el prompt de imagen. Intenta con una descripción más detallada.',
    }
  }

  ctx.aiImagePrompt = spec.meta.image_prompt
  console.log('[CHAT] Step 1 OK: image_prompt =', spec.meta.image_prompt.slice(0, 80))
  console.log('[CHAT] Step 1 OK: analysis =', (spec.meta.ai_analysis || '').slice(0, 80))
  console.log('[CHAT] Step 1 OK: adsets =', (spec.adsets || []).length)

  // ══════════════════════════════════════════════════════════════════════
  // STEP 2: Generate visual content via DiCloak using Claude's prompt
  // ══════════════════════════════════════════════════════════════════════
  console.log('[CHAT] Step 2: Generating visual content with DiCloak...')
  let filePath = null
  try {
    filePath = await generateContent(ctx)
    console.log('[CHAT] Step 2 OK: filePath =', filePath)
  } catch (err) {
    console.error('[CHAT] Step 2 FAILED:', err.message)
    // For campaigns, continue without image. For standalone images, fail.
    if (ctx.type !== 'campaign') {
      return { success: false, error: `No se pudo generar la ${typeLabel}: ${err.message}` }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP 3: Build campaign info from Claude's analysis
  // ══════════════════════════════════════════════════════════════════════
  let campaignInfo = ''

  // ══════════════════════════════════════════════════════════════════════
  // STEP 3: Build the full message with ALL info from Claude's analysis
  // ══════════════════════════════════════════════════════════════════════
  console.log('[CHAT] Step 3: Building message...')
  const meta = spec.meta
  const adsets = spec.adsets || []

  // Start with Claude's strategic analysis
  campaignInfo = '\n\n**Análisis de los agentes expertos:**\n' + (meta.ai_analysis || 'Sin análisis disponible.')

  // Campaign-specific info: audiences, ads, schedule
  if (adsets.length > 0) {
    const schedule = meta.schedule || {}

    const audienceLines = adsets.map((a) => {
      const dailyCop = Math.round((a.daily_budget || 0) / 100)
      const interestCount = a.interests_resolved || 0
      const cities = (a.targeting?.geo_locations?.cities || []).map(c => c.name).join(', ') || 'Colombia'
      return `• **${a.audience_key}** — $${dailyCop.toLocaleString()}/día | ${cities} | ${interestCount} intereses\n  _${a.reasoning || ''}_`
    }).join('\n')

    const adLines = adsets.flatMap(a => (a.ads || []).map(ad =>
      `• **${ad.angle || ad.name}**: "${(ad.creative?.object_story_spec?.link_data?.name || '').slice(0, 50)}"\n  _${ad.reasoning || ''}_`
    )).join('\n')
    const adLines = adsets.flatMap(a => (a.ads || []).map(ad =>
      `• **${ad.angle || ad.name}**: "${(ad.creative?.object_story_spec?.link_data?.name || '').slice(0, 50)}"\n  _${ad.reasoning || ''}_`
    )).join('\n')

    campaignInfo += `\n\n**Presupuesto:** $${schedule.daily_budget_cop?.toLocaleString() || ctx.budget}/día → $${schedule.total_budget_cop?.toLocaleString() || '?'} total`
      + `\n**Duración:** ${schedule.total_days || '?'} días`
      + (meta.ai_calendar_reasoning ? `\n_${meta.ai_calendar_reasoning}_` : '')
      + `\n\n**Audiencias (${adsets.length}):**\n${audienceLines}`
      + `\n\n**Anuncios (${adsets.reduce((s, a) => s + (a.ads || []).length, 0)}):**\n${adLines}`
  }

  // Warnings
  const warnings = meta.ai_warnings || []
  if (warnings.length) {
    campaignInfo += `\n\n**Alertas del experto:**\n${warnings.map(w => `⚠️ ${w}`).join('\n')}`
  }

  // Campaign state
  if (ctx.type === 'campaign') {
    campaignInfo += '\n\n**Estado inicial:** Todo se crea en PAUSED (no se activa sin tu confirmación)'
  }

  // ── Build final message ──
  const publishLabel = ctx.publishAs === 'story' ? 'historia' : ctx.publishAs === 'reel' ? 'reel' : ctx.type === 'campaign' ? 'campaña' : 'publicación'

  const jobId = `job-${Date.now()}`
  pendingJobs.set(jobId, { ctx: { ...ctx }, filePath, videoFilePath, imageFilePath, spec })

  let message = ''
  if (ctx.type === 'campaign') {
    message = `He analizado tu campaña: **"${ctx.description}"**`
    message += campaignInfo
    if (filePath) {
      message += '\n\n**Imagen promocional** generada (se muestra abajo).'
    } else {
      message += '\n\n_No se pudo generar la imagen, pero la campaña se puede crear sin ella._'
    }
    message += '\n\n¿Apruebas la campaña?'
  } else if (ctx.type === 'video') {
    message = `He preparado tu video publicitario: **"${ctx.description}"**`
    message += campaignInfo
    if (filePath) {
      message += '\n\n**Video** generado (se muestra abajo).'
    }
    message += '\n\n¿Apruebas para publicar?'
  } else {
    // Image
    message = `He creado tu imagen publicitaria: **"${ctx.description}"**`
    message += campaignInfo
    if (filePath) {
      message += '\n\n**Imagen** lista (se muestra abajo).'
    } else {
      message += '\n\nNo se pudo generar la imagen. Verifica que DiCloak esté abierto.'
    }
    message += '\n\n¿Apruebas para publicar en ' + ctx.platform + '?'
  }

  // Convert image to data URL so Electron renderer can display it
  let imageDataUrl = ''
  if (filePath && fs.existsSync(filePath)) {
    try {
      const ext = path.extname(filePath).toLowerCase().replace('.', '')
      const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
      const base64 = fs.readFileSync(filePath).toString('base64')
      imageDataUrl = `data:${mime};base64,${base64}`
    } catch { /* ignore */ }
  }

  return {
    success: true,
    needsApproval: !!filePath || !!videoFilePath || ctx.type === 'campaign' || ctx.type === 'video_campaign',
    jobId,
    message,
    preview: {
      type: ctx.type,
      imagePath: filePath,
      imageDataUrl,
      summary: ctx.type === 'campaign'
        ? `${(spec?.adsets || []).length} audiencias | $${Number(ctx.budget).toLocaleString()}/día`
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
