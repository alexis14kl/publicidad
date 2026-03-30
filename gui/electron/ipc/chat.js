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
const { lookupCompanyData, isCompanyActive, listActiveCompanies, getCompanyOAuthMeta, buildCompanyCredentialEnv } = require('../data/lookup')
const state = require('../state')
const { insertPublication } = require('../data/publications')

const pendingJobs = new Map()

function _detectLanguage(text) {
  if (/[áéíóúñ¿¡]/.test(text)) return 'es'
  const lower = text.toLowerCase()
  const esWords = /\b(crea|genera|publica|imagen|video|para|con|una|uno|empresa|campaña|campana|quiero|haz|necesito|diseña|vaca|automatico|software|cerveza|desarrollo|android|publicidad|pagina|facebook|instagram|lanza|crear|diseño|web|sitio|negocio|servicio|producto|marca|digital|tecnologia|app|aplicacion)\b/
  if (esWords.test(lower)) return 'es'
  // Default español — la mayoría de usuarios del bot hablan español
  return 'es'
}

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
  platforms: null,       // ['facebook', 'instagram'] — null = default to both
  publishAs: 'post',    // post | story | reel | campaign
  companyName: '',
  targetPageName: '',   // Name of the specific FB page to publish to (from prompt)
  budget: '50000',
  messages: [],          // history of user messages
}

function updateContext(text) {
  conversationContext.messages.push(text)
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Si hay contenido pendiente (publicación falló), o si ya hay descripción
  // pero falta empresa, tratar el mensaje como nombre de empresa sin sobreescribir nada
  const hasPendingContent = pendingJobs.size > 0
  const isAnsweringCompany = conversationContext.description && !conversationContext.companyName
  if (hasPendingContent || isAnsweringCompany) {
    const found = lookupCompanyData(text.trim())
    if (found) {
      conversationContext.companyName = found.nombre
      console.log(`[CONTEXT] Empresa detectada (respuesta): "${found.nombre}"`)
      return // No sobreescribir descripción ni tipo — continuar con contexto existente
    }
  }

  // Set description — use the LATEST message as the full description, don't accumulate
  const cleaned = text
    .replace(/^(genera|crea|publica|haz|diseña|lanza|quiero)\s+(una?\s+)?(imagen|foto|video|reel|campana|campaña|anuncio|publicacion)\s*(de|sobre|para|con)?\s*/i, '')
    .trim()
  if (cleaned.length > 10) {
    conversationContext.description = cleaned
  } else if (cleaned.length > 3 && !conversationContext.description) {
    conversationContext.description = cleaned
  }

  // Detect content type from THIS message only (not accumulated context)
  const isVideo = /video|reel|clip|animacion/.test(lower)
  const isCampaign = /campan[aã]|campaign|leads|anuncio(?:s)?(?:\s+pag(?:ados|ado))?|ads\b|pauta/.test(lower)

  // "campaña con video" or "video para campaña" — explicit dual request
  const explicitVideoCampaign = isVideo && isCampaign && (
    /campan[aã]\s+(con|de|para)\s+(video|reel)/i.test(lower) ||
    /video\s+(para|de)\s+(la\s+)?campan[aã]/i.test(lower) ||
    /campaña.*video|video.*campaña/i.test(lower)
  )

  if (explicitVideoCampaign) {
    conversationContext.type = 'video_campaign'
  } else if (isVideo) {
    // "video publicitario", "genera un reel" — organic video/reel
    conversationContext.type = 'video'
  } else if (isCampaign) {
    // "crea una campaña de X" — campaign (the AI decides if it needs video, image or both)
    conversationContext.type = 'campaign'
  } else if (!conversationContext.type || conversationContext.type === 'image') {
    // Default: image
    conversationContext.type = 'image'
  }
  // If type was already set from a previous message and this one doesn't override, keep it

  // Detect platforms — ONLY publish where the user explicitly says
  const mentionsFb = /facebook|fb\b/.test(lower)
  const mentionsIg = /instagram|ig\b/.test(lower)
  const mentionsTt = /tiktok/.test(lower)
  const mentionsLi = /linkedin/.test(lower)
  if (mentionsFb || mentionsIg || mentionsTt || mentionsLi) {
    const platforms = []
    if (mentionsFb) platforms.push('facebook')
    if (mentionsIg) platforms.push('instagram')
    if (mentionsTt) platforms.push('tiktok')
    if (mentionsLi) platforms.push('linkedin')
    conversationContext.platforms = platforms
  } else if (!conversationContext.platforms) {
    // No platform mentioned — resolve later from the company's configured platforms
    conversationContext.platforms = null
  }
  // Keep legacy .platform for backward compat
  conversationContext.platform = conversationContext.platforms?.[0] || 'facebook'

  // Detect publish type — derived from content type
  if (conversationContext.type === 'video') conversationContext.publishAs = 'reel'
  else if (conversationContext.type === 'video_campaign') conversationContext.publishAs = 'campaign'
  else if (conversationContext.type === 'campaign') conversationContext.publishAs = 'campaign'
  else if (/historia|story|stories/.test(lower)) conversationContext.publishAs = 'story'
  else conversationContext.publishAs = 'post'

  // Detect company — 1) regex "para X", 2) nombre directo en texto, 3) fuzzy match
  const cleanedText = text.replace(/[•·\-–—]/g, ' ').replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ')
  const companyMatch = cleanedText.match(/para\s+(?:la\s+empresa\s+)?["']?([A-Za-záéíóúñÁÉÍÓÚÑ0-9\s&.]+?)["']?\s*(?:$|[,]|\s+(?:en|y|con|que)\s)/i)
  if (companyMatch) {
    const candidate = companyMatch[1].trim().replace(/\.$/, '')
    const found = lookupCompanyData(candidate)
    if (found) {
      conversationContext.companyName = found.nombre
      console.log(`[CONTEXT] Empresa detectada (regex): "${found.nombre}" (del prompt: "${candidate}")`)
    }
  }
  // Fallback: buscar si alguna empresa aparece mencionada directamente en el texto
  if (!conversationContext.companyName) {
    const companies = listActiveCompanies()
    const lowerText = text.toLowerCase()
    const sorted = [...companies].sort((a, b) => (b.nombre || '').length - (a.nombre || '').length)
    for (const c of sorted) {
      if (c.nombre && lowerText.includes(c.nombre.toLowerCase())) {
        conversationContext.companyName = c.nombre
        console.log(`[CONTEXT] Empresa detectada (texto directo): "${c.nombre}"`)
        break
      }
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
  conversationContext.platforms = null
  conversationContext.publishAs = 'post'
  conversationContext.companyName = ''
  conversationContext.targetPageName = ''
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
    botEnv.BUSINESS_WEBSITE = company?.sitio_web || ''
    botEnv.BUSINESS_WHATSAPP = company?.telefono || ''
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
  // Keep browser open for video extension (don't close tabs/browser after generation)
  if (isVideo) botEnv.DEV_MODE = '1'

  if (!ctx.aiImagePrompt) {
    throw new Error('Los agentes expertos no generaron el prompt de imagen. Verifica la conexión con Claude (ANTHROPIC_API_KEY).')
  }
  console.log('[GENERATE] Using Claude AI prompt:', ctx.aiImagePrompt.slice(0, 100))

  // Detectar idioma del usuario a partir del prompt original
  const userLang = _detectLanguage(ctx.description || '')
  const langLabel = userLang === 'es' ? 'Spanish' : 'English'

  let imagePrompt
  if (isVideo) {
    // Inyectar voiceover de la escena 1 como diálogo en español para Veo 3
    const videoScenes = ctx.videoScenes || []
    const scene1Voiceover = videoScenes[0]?.voiceover || ''
    const voiceoverLine = scene1Voiceover
      ? `\n\nDIALOGUE/VOICEOVER (spoken in Spanish, Latin American accent): "${scene1Voiceover}"`
      : ''
    imagePrompt = `Generate this video now:\n\n${ctx.aiImagePrompt}${voiceoverLine}\n\nCRITICAL RULES:\n- Do NOT include any text, titles, subtitles, captions, logos, brand names, phone numbers, URLs, or watermarks in the video.\n- Do NOT render any written words on screen.\n- Focus ONLY on: actors, actions, expressions, environments, objects, lighting, camera movement, transitions.\n- The video must be a clean visual scene without any overlaid text.\n- Professional cinematic quality, smooth transitions.\n- The overall tone, setting, and cultural context of the video must feel ${langLabel}-speaking (Latin American if ${langLabel} is Spanish).${scene1Voiceover ? '\n- The character MUST speak the dialogue/voiceover line in Spanish with a natural Latin American accent.' : ''}`
  } else {
    imagePrompt = `Generate this image now:\n\n${ctx.aiImagePrompt}\n\nCRITICAL RULES:\n- All visible text in the image MUST be in ${langLabel}.\n- Full-bleed design, no margins.\n- The TOP 8% of the image MUST be completely EMPTY (solid background color, no text, no logos, no graphics). This blank area will be used later to overlay a real logo externally. Do NOT generate any logo, brand mark, or company name in this area.\n- Do NOT generate any fake or AI-created logos anywhere in the image. The real logo will be added in post-processing.\n- Deliver exactly ONE final image.`
  }

  const payload = JSON.stringify({
    ...(!isVideo ? { profile_name: env.INITIAL_PROFILE || '#1 Chat Gpt PRO' } : {}),
    image_prompt: imagePrompt,
  })

  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, ['-m', 'core.server.bot_runner', 'run_full_cycle', payload], {
      cwd: PROJECT_ROOT, env: botEnv, stdio: ['ignore', 'pipe', 'ignore'],
    })
    state.botProcess = child
    // Capture stdout to detect CDP port for video extension
    let childStdout = ''
    child.stdout.on('data', d => { childStdout += d.toString() })
    child.on('exit', (code) => {
      state.botProcess = null
      // Save CDP port from bot output for later video extension
      if (isVideo) {
        try {
          const portFile = path.join(PROJECT_ROOT, '.video_cdp_port')
          const cdpInfoFile = path.join(PROJECT_ROOT, 'cdp_debug_info.json')
          if (fs.existsSync(cdpInfoFile)) {
            const info = JSON.parse(fs.readFileSync(cdpInfoFile, 'utf-8'))
            const ports = Object.values(info).map(e => e.debugPort).filter(Boolean)
            if (ports.length) fs.writeFileSync(portFile, String(ports[0]))
          }
        } catch { /* ignore */ }
      }
      const outputDir = isVideo
        ? path.join(PROJECT_ROOT, 'output', 'videos')
        : path.join(PROJECT_ROOT, 'output', 'images')
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

async function generateVideoCampaignContent(ctx) {
  /**
   * Video + Campaña: genera AMBOS assets en secuencia.
   * 1. Genera el VIDEO (Veo 3 via DiCloak)
   * 2. Genera la IMAGEN (ChatGPT/Gemini via DiCloak)
   * Retorna objeto con ambos paths.
   */
  console.log('[GENERATE] video_campaign: Generating VIDEO first...')
  const videoCtx = { ...ctx, type: 'video' }
  let videoPath = null
  try {
    videoPath = await generateSingleContent(videoCtx)
    console.log('[GENERATE] video_campaign: Video OK:', videoPath)
  } catch (err) {
    console.error('[GENERATE] video_campaign: Video failed:', err.message)
    // Continue — the campaign can still be created with just the image
  }

  console.log('[GENERATE] video_campaign: Now generating IMAGE...')
  const imageCtx = { ...ctx, type: 'image' }
  let imagePath = null
  try {
    imagePath = await generateSingleContent(imageCtx)
    console.log('[GENERATE] video_campaign: Image OK:', imagePath)
  } catch (err) {
    console.error('[GENERATE] video_campaign: Image failed:', err.message)
  }

  if (!videoPath && !imagePath) {
    throw new Error('No se pudo generar ni el video ni la imagen. Revisa que DiCloak esté abierto.')
  }

  // Return combined result — the main handler will use both
  return { videoPath, imagePath }
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

// ─── Quick AI Spec (image/video — fast, no campaign engine) ─────────────────

async function getQuickAISpec(ctx) {
  const env = getProjectEnv()
  const apiKey = (env.ANTHROPIC_API_KEY || '').trim()
  if (!apiKey) return null

  const companyName = ctx.companyName || ''
  const company = companyName ? lookupCompanyData(companyName) : null
  const brandName = company?.nombre || companyName || ''
  const brandWebsite = company?.sitio_web || ''
  const brandPhone = company?.telefono || ''
  const brandDescription = company?.descripcion || ''

  const userLang = /[áéíóúñ¿¡]/.test(ctx.description || '') ? 'es' : 'en'
  const langLabel = userLang === 'es' ? 'español' : 'inglés'
  const isVideo = ctx.type === 'video'

  const companyInfo = [
    brandName ? `Empresa: ${brandName}` : '',
    brandWebsite ? `Web: ${brandWebsite}` : '',
    brandPhone ? `WhatsApp: ${brandPhone}` : '',
    brandDescription ? `Descripción: ${brandDescription}` : '',
  ].filter(Boolean).join('. ')

  const systemPrompt = `Eres un director creativo publicitario. Generas prompts para IA de imágenes/video.
Responde SOLO JSON válido. Sin markdown. Sin backticks.`

  const userPrompt = isVideo
    ? `Genera un prompt para un VIDEO/REEL publicitario.

Solicitud: ${ctx.description}
${companyInfo || ''}

JSON: {"image_prompt":"(EN INGLÉS) prompt cinematográfico para video. Solo escenas visuales, actores, acciones, ambiente, cámara. SIN texto ni logos en pantalla.","post_caption":"(EN ESPAÑOL) caption para redes, max 100 palabras","post_hashtags":["8 hashtags"]}`
    : `Genera un prompt para una IMAGEN PUBLICITARIA.

Solicitud: ${ctx.description}
${companyInfo || ''}

JSON: {"image_prompt":"(EN INGLÉS) prompt para imagen publicitaria profesional 1080x1350. El texto visible en la imagen DEBE ser en español. Incluir los datos reales de la empresa si se proporcionaron. Top 15% limpio para logo.","post_caption":"(EN ESPAÑOL) caption para redes, max 100 palabras","post_hashtags":["8 hashtags"]}`

  const https = require('https')
  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [
      { role: 'user', content: userPrompt },
    ],
    system: systemPrompt,
  })

  console.log('[QUICK-AI] Calling Claude Haiku (fast)...')
  const startMs = Date.now()

  try {
    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      }, (res) => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch { reject(new Error('Claude response parse error')) }
        })
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })

    if (response.error) {
      console.error('[QUICK-AI] Claude error:', response.error.message)
      return null
    }

    const text = response.content?.[0]?.text || ''
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
    console.log(`[QUICK-AI] Claude responded in ${elapsed}s`)

    // Parse JSON — Claude might wrap in ```json```
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[QUICK-AI] No JSON found in response')
      return null
    }

    const spec = JSON.parse(jsonMatch[0])
    console.log('[QUICK-AI] image_prompt:', (spec.image_prompt || '').slice(0, 80))

    // Wrap in the same format as campaign engine
    return {
      campaign: { name: spec.campaign_name || ctx.description || '' },
      adsets: [],
      meta: {
        ai_analysis: spec.analysis || spec.post_caption || '',
        ai_warnings: spec.warnings || [],
        image_prompt: spec.image_prompt || '',
        post_caption: spec.post_caption || '',
        post_hashtags: spec.post_hashtags || [],
        video_scenes: spec.video_scenes || [],
      },
    }
  } catch (err) {
    console.error('[QUICK-AI] Error:', err.message)
    return null
  }
}

// ─── Campaign Spec (dry-run) — full analysis for campaigns ──────────────────

async function getCampaignPreview(ctx) {
  const pythonBin = findPython()
  if (!pythonBin) return null

  const env = getProjectEnv()

  // ── Inject company context — sin defaults hardcodeados ──
  const companyName = ctx.companyName || ''
  const company = companyName ? lookupCompanyData(companyName) : null
  const brandName = company?.nombre || companyName || ''
  const brandWebsite = company?.sitio_web || ''
  const brandPhone = company?.telefono || ''
  const brandDescription = company?.descripcion || ''

  const companyContext = [
    `Empresa: ${brandName}`,
    brandWebsite ? `Web: ${brandWebsite}` : '',
    brandPhone ? `Contacto: ${brandPhone}` : '',
    brandDescription ? `Descripcion: ${brandDescription}` : '',
  ].filter(Boolean).join('. ')

  // Resolver page_id y ad_account_id desde la empresa
  let companyPageId = ''
  let companyAdAccountId = ''
  if (company) {
    const fbPlatform = (company.platforms || []).find((p) => p.platform === 'facebook')
    if (fbPlatform) {
      const primary = (fbPlatform.accounts || []).find((a) => a.is_primary) || fbPlatform.accounts?.[0]
      if (primary?.page_id) companyPageId = primary.page_id
    }
  }
  // Datos extra de OAuth (ad_account, user_token)
  const oauthMeta = getCompanyOAuthMeta(companyName) || {}
  if (oauthMeta.ad_account_id) companyAdAccountId = oauthMeta.ad_account_id

  // Detectar idioma del usuario
  const userLang = _detectLanguage(ctx.description || '')

  const engineInput = {
    name: brandName ? `${brandName} - ${ctx.description}` : ctx.description,
    description: (companyContext ? `${companyContext}\n\n` : '') + `Solicitud: ${ctx.description}`,
    budget: ctx.budget,
    content_type: ctx.type === 'video_campaign' ? 'campaign' : ctx.type,
    access_token: oauthMeta.user_token || env.FB_ACCESS_TOKEN || '',
    ad_account_id: companyAdAccountId || '',
    page_id: companyPageId,
    company_name: brandName,
    company_website: brandWebsite,
    company_phone: brandPhone,
    user_language: userLang,
  }

  try {
    const { stdout, stderr } = await new Promise((resolve) => {
      let out = ''
      let err = ''
      const child = spawn(pythonBin, ['-m', 'core.n8n.meta_campaign_engine', '--dry-run', '--stdin'], {
        cwd: PROJECT_ROOT,
        env: {
          ...env,
          PYTHONPATH: PROJECT_ROOT,
          PYTHONIOENCODING: 'utf-8',
          ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || '',
        },
      })
      child.stdin.write(JSON.stringify(engineInput))
      child.stdin.end()
      child.stdout?.on('data', d => { out += d.toString() })
      child.stderr?.on('data', d => { err += d.toString() })
      // Use 'close' instead of 'exit' to ensure all stdio streams are flushed
      child.on('close', () => resolve({ stdout: out, stderr: err }))
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

  // 3. ai_analysis como caption
  const analysis = (meta.ai_analysis || '').trim()
  if (analysis) {
    return analysis.slice(0, 400) + hashtags
  }

  // 4. Sin caption disponible
  return 'Publicación generada con IA' + hashtags
}

// ─── Publishing ─────────────────────────────────────────────────────────────

// ─── Upload image to FreeImage for public URL (needed by Instagram API) ──────
async function uploadToFreeImage(imagePath) {
  const env = getProjectEnv()
  const apiKey = env.FREEIMAGE_API_KEY || ''
  if (!apiKey) throw new Error('FREEIMAGE_API_KEY no configurada en .env')

  const imageBase64 = fs.readFileSync(imagePath).toString('base64')
  const https = require('https')
  const qs = require('querystring')
  const body = qs.stringify({ key: apiKey, source: imageBase64, action: 'upload', format: 'json' })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'freeimage.host',
      path: '/api/1/upload',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (result.image && result.image.url) resolve(result.image.url)
          else reject(new Error('FreeImage: no devolvió URL'))
        } catch { reject(new Error('FreeImage: respuesta inválida')) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─── Temporary HTTP server to serve local video files (needed by Instagram API) ─
function serveVideoTemporarily(videoPath, timeoutMs = 300000) {
  const http = require('http')
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/video.mp4') {
        const stat = fs.statSync(videoPath)
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size })
        fs.createReadStream(videoPath).pipe(res)
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(0, '0.0.0.0', () => {
      const port = server.address().port
      const cleanup = () => { try { server.close() } catch {} }
      setTimeout(cleanup, timeoutMs)
      resolve({ url: `http://localhost:${port}/video.mp4`, cleanup })
    })
  })
}

// ─── Publish to Instagram via Instagram API ──────────────────────────────────
async function publishToInstagram(job) {
  const { ctx, filePath, videoFilePath } = job
  const { publishImage, publishReel, resolveInstagramConfig } = require('../facebook/instagram-api')

  // Auto-resuelve IG User ID desde el token de Facebook — no requiere config separada
  const config = await resolveInstagramConfig()
  if (!config.igUserId) throw new Error('No se pudo detectar la cuenta de Instagram vinculada a tu Facebook Page. Verifica que tu Page tenga Instagram Business conectado.')
  if (!config.accessToken) throw new Error('No hay token configurado. Configura FB_ACCESS_TOKEN o FB_PAGE_ACCESS_TOKEN en .env.')

  const spec = job.spec
  const caption = buildPublishCaption(spec, ctx)
  const isVideo = ctx.type === 'video' || /\.(mp4|mov|webm)$/i.test(filePath || '')
  const effectiveFilePath = (isVideo ? (videoFilePath || filePath) : filePath) || ''

  if (!effectiveFilePath || !fs.existsSync(effectiveFilePath)) {
    throw new Error('No hay archivo para publicar en Instagram.')
  }

  if (isVideo) {
    // Instagram requires a public URL for videos — serve temporarily
    const { url: videoUrl, cleanup } = await serveVideoTemporarily(effectiveFilePath)
    try {
      const result = await publishReel({
        token: config.accessToken,
        videoUrl,
        caption,
        maxWaitMs: 180000,
      })
      try {
        insertPublication({
          postId: result.media_id, platform: 'instagram', pageId: config.igUserId || '',
          pageName: ctx.companyName || '', companyName: ctx.companyName || '', contentType: 'reel',
          message: caption.slice(0, 500), imageUrl: '', status: 'published',
        })
      } catch (err) { console.warn('[Publications] Error recording chat IG reel:', err.message) }
      return { success: true, message: `Reel publicado en Instagram. Media ID: ${result.media_id}` }
    } finally {
      cleanup()
    }
  } else {
    // Instagram requires a public URL for images — upload to FreeImage first
    const imageUrl = await uploadToFreeImage(effectiveFilePath)
    const result = await publishImage({
      token: config.accessToken,
      imageUrl,
      caption,
    })
    try {
      insertPublication({
        postId: result.media_id, platform: 'instagram', pageId: config.igUserId || '',
        pageName: '', companyName: ctx.companyName || '', contentType: 'image',
        message: caption.slice(0, 500), imageUrl, status: 'published',
      })
    } catch (err) { console.warn('[Publications] Error recording chat IG image:', err.message) }
    return { success: true, message: `Imagen publicada en Instagram. Media ID: ${result.media_id}` }
  }
}

/**
 * Resuelve el Page ID y Page Token según el contexto del usuario.
 *
 * Prioridad:
 * 1. targetPageName del prompt ("publica en la página Hell Beers")
 *    → busca en /me/accounts la página cuyo nombre coincida
 * 2. Empresa seleccionada (companyName) → busca en la DB la page_id/token de facebook
 *
 * NO hay fallback a .env — la página DEBE resolverse desde el prompt o la empresa.
 */
async function resolveTargetPage(ctx) {
  const env = getProjectEnv()
  const userToken = env.FB_ACCESS_TOKEN || ''
  let pageId = ''
  let pageToken = ''
  let pageName = ''

  // ── Obtener todas las páginas del usuario autenticado (una vez) ──
  let userPages = []
  if (userToken) {
    try {
      const { facebookApiRequest } = require('../facebook/api')
      const result = await facebookApiRequest('GET', 'me/accounts', {
        fields: 'id,name,access_token',
      }, userToken)
      userPages = Array.isArray(result?.data) ? result.data : []
    } catch (err) {
      // El token puede ser Page Token (no soporta me/accounts) — no es error fatal
      console.log(`[PUBLISH] No se pudo listar páginas (token puede ser Page Token): ${err.message}`)
    }
  }

  // 1. Si el usuario mencionó una página específica en el prompt
  if (ctx.targetPageName && userPages.length > 0) {
    const target = ctx.targetPageName.toLowerCase()
    const match =
      userPages.find((p) => String(p.name || '').toLowerCase() === target) ||
      userPages.find((p) => String(p.name || '').toLowerCase().includes(target)) ||
      userPages.find((p) => target.includes(String(p.name || '').toLowerCase()))

    if (match) {
      pageId = String(match.id)
      pageToken = String(match.access_token || '')
      pageName = String(match.name || '')
      console.log(`[PUBLISH] Página detectada del prompt: "${pageName}" (ID: ${pageId})`)
    } else {
      const available = userPages.map(p => p.name).join(', ')
      console.log(`[PUBLISH] No se encontró página "${ctx.targetPageName}". Disponibles: ${available}`)
    }
  }

  // 2. Si hay empresa seleccionada con facebook configurado y no se encontró por nombre
  if (!pageId && ctx.companyName) {
    const company = lookupCompanyData(ctx.companyName)
    if (company) {
      const fbPlatform = (company.platforms || []).find((p) => p.platform === 'facebook')
      if (fbPlatform) {
        const primary = (fbPlatform.accounts || []).find((a) => a.is_primary) || fbPlatform.accounts?.[0]
        if (primary?.page_id) {
          pageId = primary.page_id
          pageToken = primary.token || ''
          console.log(`[PUBLISH] Página de empresa "${ctx.companyName}": page_id=${pageId} token_len=${pageToken.length}`)
        }
      }
    }
  }

  // 3. Si tenemos pageId pero no pageToken, buscar el Page Token en las páginas del usuario
  if (pageId && !pageToken && userPages.length > 0) {
    const pageMatch = userPages.find((p) => String(p.id) === pageId)
    if (pageMatch?.access_token) {
      pageToken = String(pageMatch.access_token)
      console.log(`[PUBLISH] Page Token obtenido de /me/accounts para page_id=${pageId}`)
    }
  }

  // 4. Si tenemos pageId pero no pageToken, buscar en la DB de facebook por page_id
  if (pageId && !pageToken) {
    try {
      const { fetchCompanyRowsForPlatform } = require('../data/db')
      const rows = fetchCompanyRowsForPlatform('facebook')
      const match = rows.find(r => r.page_id === pageId)
      if (match?.token) {
        pageToken = match.token
        pageName = pageName || match.nombre || ''
        console.log(`[PUBLISH] Page Token obtenido de DB para page_id=${pageId}`)
      }
    } catch (err) {
      console.warn(`[PUBLISH] Error buscando token en DB:`, err.message)
    }
  }

  // NUNCA usar FB_ACCESS_TOKEN del .env como fallback — puede ser de otra página
  if (pageId && !pageToken) {
    console.error(`[PUBLISH] No se encontró Page Token para page_id=${pageId}. Reconecta la cuenta en Empresas.`)
  }

  return { pageId, pageToken, pageName }
}

async function publishToMeta(job) {
  const { ctx } = job

  // Si no hay empresa en el contexto, pedir al usuario que especifique
  if (!ctx.companyName) {
    let names = ''
    try {
      const { aggregateCompanyRows, fetchCompanyRowsForPlatform } = require('../data/db')
      const { COMPANY_PLATFORMS } = require('../config/company-platforms')
      const records = aggregateCompanyRows(
        Object.fromEntries([...COMPANY_PLATFORMS].map(p => [p, fetchCompanyRowsForPlatform(p)]))
      ).filter(c => c.activo)
      names = records.map(c => `• ${c.nombre}`).join('\n')
    } catch { /* ignore */ }
    throw new Error(
      'No se detectó la empresa destino en tu mensaje.\n\n'
      + 'Indica la empresa en tu prompt, por ejemplo:\n"Genera una imagen **para Nygsoft** en facebook"\n\n'
      + (names ? `Empresas disponibles:\n${names}` : 'No hay empresas configuradas. Conecta una en la sección de Empresas.')
    )
  }

  // Resolver página destino UNA vez
  const targetPage = await resolveTargetPage(ctx)

  // Resolver plataformas: si el usuario no especificó, usar las que la empresa tiene configuradas
  console.log(`[PUBLISH] ctx.companyName="${ctx.companyName}", ctx.platforms=${JSON.stringify(ctx.platforms)}`)
  let platforms = ctx.platforms
  if (!platforms || platforms.length === 0) {
    platforms = []
    const companyName = ctx.companyName
    if (companyName) {
      const company = lookupCompanyData(companyName)
      if (company) {
        for (const p of company.platforms || []) {
          if (p.platform === 'facebook' && p.accounts?.some(a => a.page_id || a.token)) {
            platforms.push('facebook')
          }
          if (p.platform === 'instagram' && p.accounts?.some(a => a.account_id || a.token)) {
            platforms.push('instagram')
          }
          if (p.platform === 'tiktok' && p.accounts?.some(a => a.token)) {
            platforms.push('tiktok')
          }
          if (p.platform === 'linkedin' && p.accounts?.some(a => a.token)) {
            platforms.push('linkedin')
          }
        }
      }
    }
    if (platforms.length === 0) {
      console.error(`[PUBLISH] No platforms found. companyName="${ctx.companyName}"`)
      const companies = listActiveCompanies()
      const names = companies.map(c => `• ${c.nombre}`).join('\n')
      throw new Error(
        'No se pudo determinar dónde publicar. Escribe el nombre de la empresa para publicar el contenido ya generado:\n\n'
        + names
      )
    }
    console.log(`[PUBLISH] Plataformas resueltas desde empresa "${ctx.companyName}": ${platforms.join(', ')}`)
  }

  const results = []
  const errors = []
  for (const plat of platforms) {
    try {
      console.log(`[PUBLISH] Publicando en ${plat}... (pageId=${targetPage.pageId}, token_len=${(targetPage.pageToken||'').length}, filePath=${job.filePath || 'none'})`)
      if (plat === 'instagram') {
        const igResult = await publishToInstagram({ ...job, ctx: { ...ctx, platform: 'instagram' }, targetPage })
        results.push(igResult.message || 'Publicado en Instagram.')
      } else if (plat === 'facebook') {
        const fbResult = await publishToFacebook({ ...job, ctx: { ...ctx, platform: 'facebook' }, targetPage })
        results.push(fbResult.message || 'Publicado en Facebook.')
      } else {
        console.log(`[PUBLISH] ${plat}: plataforma pendiente de implementación.`)
        continue
      }
      console.log(`[PUBLISH] ${plat} OK: ${results[results.length - 1].slice(0, 80)}`)
    } catch (err) {
      console.error(`[PUBLISH] ${plat} ERROR: ${err.message}`)
      errors.push(`${plat}: ${err.message}`)
    }
  }

  // Si al menos una plataforma publicó, es éxito. Los errores secundarios se muestran como info.
  if (results.length > 0) {
    const msg = results.join('\n\n') + (errors.length ? `\n\n_Nota: ${errors.join('; ')}_` : '')
    return { success: true, message: msg }
  }
  return { success: false, message: errors.join('\n\n') || 'No se pudo publicar en ninguna plataforma.' }
}

async function publishToFacebook(job) {
  const { ctx, filePath, videoFilePath, imageFilePath, spec } = job

  // Página resuelta desde el prompt o la empresa — sin fallback a .env
  const tp = job.targetPage || {}
  const pageId = tp.pageId || ''
  const pageToken = tp.pageToken || ''

  // DEBUG: verificar que el token corresponde a la página correcta
  console.log(`[PUBLISH-FB] pageId=${pageId}, pageName=${tp.pageName}, token_start=${pageToken.slice(0,15)}...`)

  if (!pageId) {
    const companies = listActiveCompanies()
    const names = companies.map(c => `• ${c.nombre}`).join('\n')
    throw new Error(
      'No se pudo determinar la página destino. Escribe el nombre de la empresa:\n\n' + names
    )
  }
  if (!pageToken) {
    throw new Error(
      `Página "${tp.pageName || pageId}" detectada pero sin token de acceso. `
      + 'Reconecta la cuenta de Facebook en la sección de Empresas.'
    )
  }
  if (tp.pageName) {
    console.log(`[PUBLISH-FB] Publicando en página: "${tp.pageName}" (${pageId})`)
  }

  if (ctx.type === 'video_campaign') {
    // VIDEO + CAMPAIGN: execute both in sequence
    // 1. Create campaign with the IMAGE as creative
    // 2. Publish the VIDEO as a reel
    const results = []

    const campaignImagePath = imageFilePath || filePath
    if (spec && spec.campaign) {
      try {
        const campaignResult = await executeCampaignSpec(spec, campaignImagePath, pageToken)
        results.push(campaignResult.message || 'Campaña creada.')
      } catch (err) {
        results.push(`Error creando campaña: ${err.message}`)
      }
    }

    const reelVideoPath = videoFilePath || (filePath && /\.(mp4|mov|webm)$/i.test(filePath) ? filePath : null)
    if (reelVideoPath) {
      try {
        const caption = buildPublishCaption(spec, ctx)
        const reelResult = await publishVideoToMeta(pageId, pageToken, reelVideoPath, caption, { ...ctx, publishAs: 'reel' })
        results.push(reelResult.message || 'Reel publicado.')
      } catch (err) {
        results.push(`Error publicando reel: ${err.message}`)
      }
    }

    return {
      success: results.length > 0,
      message: results.join('\n\n'),
    }
  }

  if (ctx.publishAs === 'campaign' || ctx.type === 'campaign') {
    // Campaña: primero publicar la imagen como post, luego crear campaña de ads
    const results = []

    // 1. Publicar imagen como post orgánico
    if (filePath && fs.existsSync(filePath)) {
      try {
        const caption = buildPublishCaption(spec, ctx)
        const imageBuffer = fs.readFileSync(filePath)
        const boundary = '----FormBoundary' + Date.now().toString(36)
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`),
          imageBuffer,
          Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="message"\r\n\r\n${caption}\r\n--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${pageToken}\r\n--${boundary}\r\nContent-Disposition: form-data; name="published"\r\n\r\ntrue\r\n--${boundary}--\r\n`),
        ])
        const https = require('https')
        const postResult = await new Promise((resolve, reject) => {
          const req = https.request({
            hostname: 'graph.facebook.com',
            path: `/v25.0/${pageId}/photos`,
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
          }, (res) => {
            let data = ''
            res.on('data', chunk => { data += chunk })
            res.on('end', () => {
              try {
                const r = JSON.parse(data)
                if (r.id || r.post_id) resolve(r)
                else if (r.error) reject(new Error(r.error.message))
                else resolve(r)
              } catch { reject(new Error(data.slice(0, 200))) }
            })
          })
          req.on('error', reject)
          req.write(body)
          req.end()
        })
        results.push(`Imagen publicada en Facebook. Post ID: ${postResult.post_id || postResult.id}`)
      } catch (err) {
        results.push(`Error publicando imagen: ${err.message}`)
      }
    }

    // 2. Crear campaña de ads (si hay spec de campaña)
    if (spec && spec.campaign) {
      try {
        const campaignResult = await executeCampaignSpec(spec, filePath, pageToken)
        results.push(campaignResult.message || 'Campaña creada.')
      } catch (err) {
        results.push(`Error creando campaña de ads: ${err.message}`)
      }
    }

    return { success: results.some(r => !r.startsWith('Error')), message: results.join('\n\n') }
  }

  // Publish image or video directly via Meta API REST
  if (!filePath) throw new Error('No hay archivo para publicar.')

  // Siempre usar el token de la DB para el pageId — nunca confiar en el token resuelto
  let effectiveToken = pageToken
  if (pageId) {
    try {
      const { fetchCompanyRowsForPlatform } = require('../data/db')
      const rows = fetchCompanyRowsForPlatform('facebook')
      const dbRow = rows.find(r => r.page_id === pageId)
      if (dbRow?.token) {
        effectiveToken = dbRow.token
        console.log(`[PUBLISH-FB] Token de DB para page_id=${pageId} (${dbRow.nombre})`)
      }
    } catch (err) {
      console.warn('[PUBLISH-FB] Error buscando token en DB, usando resuelto:', err.message)
    }
  }

  if (!effectiveToken) throw new Error('No hay token de acceso para la página.')

  // Build caption from Claude's copywriting skill
  const caption = buildPublishCaption(spec, ctx)

  const isVideo = ctx.type === 'video' || /\.(mp4|mov|webm)$/i.test(filePath)

  if (isVideo) {
    // ── Video/Reel: POST /{PAGE_ID}/videos ──
    return publishVideoToMeta(pageId, pageToken, filePath, caption, ctx)
  }

  // ── Image: POST /{PAGE_ID}/photos ──
  const imageBuffer = fs.readFileSync(filePath)
  const boundary = '----FormBoundary' + Date.now().toString(36)
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`
    ),
    imageBuffer,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="message"\r\n\r\n${caption}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${effectiveToken}\r\n` +
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
            const postId = result.post_id || result.id
            try {
              insertPublication({
                postId, platform: 'facebook', pageId, pageName: tp.pageName || ctx.companyName || '',
                companyName: ctx.companyName || '', contentType: 'image',
                message: caption.slice(0, 500), imageUrl: '', status: 'published',
              })
            } catch (err) { console.warn('[Publications] Error recording chat FB image:', err.message) }
            resolve({ success: true, message: `Imagen publicada en ${ctx.platform}. Post ID: ${postId}` })
          } else if (result.error) {
            reject(new Error(`Meta API: ${result.error.message || JSON.stringify(result.error)}`))
          } else {
            resolve({ success: true, message: `Imagen publicada en ${ctx.platform}.` })
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

async function publishVideoToMeta(pageId, pageToken, filePath, caption, ctx) {
  /**
   * Publica un video en Facebook.
   *
   * Para REELS (9:16, 3-90s) — 3 fases segun la documentacion oficial:
   *   1. POST /{page_id}/video_reels?upload_phase=start → video_id + upload_url
   *   2. POST upload_url con binary (application/octet-stream, headers: Authorization, offset, file_size)
   *   3. POST /{page_id}/video_reels?upload_phase=finish&video_state=PUBLISHED → publish
   *
   * Para VIDEO NORMAL — multipart form-data a graph-video.facebook.com:
   *   POST /{page_id}/videos con source=@file, description, access_token
   *
   * Ref: https://developers.facebook.com/docs/video-api/guides/reels-publishing
   * Ref: https://developers.facebook.com/docs/video-api/guides/publishing
   */
  const https = require('https')
  const publishAs = ctx.publishAs === 'reel' || ctx.publishAs === 'story' ? 'reel' : 'post'

  if (publishAs === 'reel') {
    // ══════════════════════════════════════════════════════════════════════
    // REEL: 3-phase upload (official Graph API Reels Publishing flow)
    // ══════════════════════════════════════════════════════════════════════

    // Phase 1: Initialize — POST /{page_id}/video_reels?upload_phase=start
    const initResult = await metaApiPost(`/${pageId}/video_reels`, {
      upload_phase: 'start',
      access_token: pageToken,
    })
    const videoId = initResult.video_id
    if (!videoId) throw new Error('Meta no devolvio video_id al iniciar el upload del Reel.')

    // Phase 2: Upload binary — POST to rupload.facebook.com
    // Content-Type: application/octet-stream (raw binary, NOT multipart)
    // Headers: Authorization: OAuth {token}, offset: 0, file_size: {bytes}
    const videoBuffer = fs.readFileSync(filePath)

    await new Promise((resolve, reject) => {
      const uploadReq = https.request({
        hostname: 'rupload.facebook.com',
        path: `/video-upload/v25.0/${videoId}`,
        method: 'POST',
        headers: {
          'Authorization': `OAuth ${pageToken}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': videoBuffer.length,
          'offset': '0',
          'file_size': String(videoBuffer.length),
        },
      }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const result = JSON.parse(data)
            if (result.success !== false && !result.error) {
              resolve(result)
            } else if (result.error) {
              reject(new Error(`Reel upload fase 2: ${result.error.message || JSON.stringify(result.error)}`))
            } else {
              resolve(result)
            }
          } catch {
            reject(new Error(`Reel upload respuesta invalida: ${data.slice(0, 300)}`))
          }
        })
      })
      uploadReq.on('error', reject)
      uploadReq.on('timeout', () => uploadReq.destroy(new Error('Timeout subiendo video a rupload.facebook.com')))
      uploadReq.setTimeout(120000)
      uploadReq.write(videoBuffer)
      uploadReq.end()
    })

    // Phase 3: Finish & Publish — POST /{page_id}/video_reels?upload_phase=finish
    const finishResult = await metaApiPost(`/${pageId}/video_reels`, {
      upload_phase: 'finish',
      video_id: videoId,
      video_state: 'PUBLISHED',
      title: (ctx.description || '').slice(0, 100) || 'Video publicitario',
      description: caption,
      access_token: pageToken,
    })

    try {
      insertPublication({
        postId: videoId, platform: 'facebook', pageId, pageName: ctx.companyName || '',
        companyName: ctx.companyName || '', contentType: 'reel',
        message: caption.slice(0, 500), imageUrl: '', status: 'published',
      })
    } catch (err) { console.warn('[Publications] Error recording chat FB reel:', err.message) }

    return {
      success: true,
      message: `Reel publicado en ${ctx.platform}. Video ID: ${videoId}${finishResult.success ? ' (procesando por Meta)' : ''}`,
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // VIDEO NORMAL: multipart form-data a graph-video.facebook.com
  // POST /{page_id}/videos con source=@archivo
  // Ref: https://developers.facebook.com/docs/video-api/guides/publishing
  // ══════════════════════════════════════════════════════════════════════
  const videoBuffer = fs.readFileSync(filePath)
  const boundary = '----FormBoundary' + Date.now().toString(36)
  const ext = path.extname(filePath).toLowerCase()
  const contentType = ext === '.mov' ? 'video/quicktime' : 'video/mp4'
  const fileName = path.basename(filePath)

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    videoBuffer,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${(ctx.description || '').slice(0, 100)}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${caption}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${pageToken}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="published"\r\n\r\ntrue\r\n` +
      `--${boundary}--\r\n`
    ),
  ])

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph-video.facebook.com',
      path: `/v25.0/${pageId}/videos`,
      method: 'POST',
      timeout: 120000,
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
          if (result.id) {
            try {
              insertPublication({
                postId: result.id, platform: 'facebook', pageId, pageName: ctx.companyName || '',
                companyName: ctx.companyName || '', contentType: 'video',
                message: caption.slice(0, 500), imageUrl: '', status: 'published',
              })
            } catch (err) { console.warn('[Publications] Error recording chat FB video:', err.message) }
            resolve({ success: true, message: `Video publicado en ${ctx.platform}. Video ID: ${result.id}` })
          } else if (result.error) {
            reject(new Error(`Meta API: ${result.error.message || JSON.stringify(result.error)}`))
          } else {
            resolve({ success: true, message: `Video publicado en ${ctx.platform}.` })
          }
        } catch {
          reject(new Error(`Respuesta inesperada de Meta: ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('Timeout publicando video en Meta')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function executeCampaignSpec(spec, imagePath, pageToken = '') {
  /**
   * Ejecuta el spec que el AI ya generó — NO vuelve a analizar.
   * Pasa la imagen generada por DiCloak al spec para que los creativos la usen.
   */
  const pythonBin = findPython()
  if (!pythonBin) throw new Error('Python no encontrado')

  const env = getProjectEnv()
  const token = pageToken || env.FB_ACCESS_TOKEN || ''
  if (!token) throw new Error('No hay token de acceso para crear la campaña. Reconecta Facebook en Empresas.')

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
      cwd: PROJECT_ROOT,
      env: {
        ...env,
        PYTHONPATH: PROJECT_ROOT,
        PYTHONIOENCODING: 'utf-8',
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || '',
      },
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

async function handleChatCommand(text, sendStep = () => {}) {
  // Update context with new info from user
  updateContext(text)
  const ctx = { ...conversationContext }

  // ══════════════════════════════════════════════════════════════════════
  // RETRY: si hay contenido pendiente (publicación falló), el usuario puede
  // dar el nombre de la empresa/página para reintentar sin regenerar.
  // ══════════════════════════════════════════════════════════════════════
  if (pendingJobs.size > 0) {
    const [lastJobId, lastJob] = [...pendingJobs.entries()].pop()
    if (lastJob) {
      // Detectar si el usuario está dando una empresa o página para el job pendiente
      const userText = text.trim()
      const foundCompany = lookupCompanyData(userText)

      if (foundCompany) {
        lastJob.ctx.companyName = foundCompany.nombre
        // Restaurar la descripción original del job (no la que updateContext sobreescribió)
        conversationContext.description = lastJob.ctx.description
        conversationContext.companyName = foundCompany.nombre
        console.log(`[CHAT] Retry: empresa "${foundCompany.nombre}" asignada al job pendiente ${lastJobId}. Publicando contenido existente.`)
        try {
          return await handleChatApprove(lastJobId, '')
        } catch (err) {
          return { success: false, error: err.message || String(err) }
        }
      }
    }
  }

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

  // ══════════════════════════════════════════════════════════════════════
  // EMPRESA OBLIGATORIA — si no se detectó, preguntar antes de continuar
  // ══════════════════════════════════════════════════════════════════════
  if (!ctx.companyName) {
    const companies = listActiveCompanies()
    if (companies.length === 0) {
      return {
        success: false,
        error: 'No hay empresas configuradas. Ve a la sección de Empresas para crear una y conectar su cuenta de Facebook.',
      }
    }
    const names = companies.map(c => `• ${c.nombre}`).join('\n')
    return {
      success: true,
      message: `¿Para qué empresa quieres crear esto?\n\n${names}\n\nEscribe el nombre de la empresa y continuaré con tu solicitud.`,
      _waitingForCompany: true,
    }
  }

  const typeLabel = ctx.type === 'video_campaign' ? 'video + campaña'
    : ctx.type === 'video' ? 'video'
    : ctx.type === 'campaign' ? 'imagen para la campaña'
    : 'imagen'

  // ══════════════════════════════════════════════════════════════════════
  // STEP 1: Claude analyzes
  // Imagen/Video → flujo rápido (API directa, ~3-5s)
  // Campaña → flujo completo (Python engine, ~10-15s)
  // ══════════════════════════════════════════════════════════════════════
  const useFastPath = ctx.type === 'image' || ctx.type === 'video'
  sendStep(`Analizando tu solicitud con IA...`)
  console.log(`[CHAT] Step 1: ${useFastPath ? 'Quick AI (fast)' : 'Campaign engine (full)'}...`)
  const spec = useFastPath
    ? await getQuickAISpec(ctx)
    : await getCampaignPreview(ctx)

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
  ctx.videoScenes = spec.meta.video_scenes || []
  console.log('[CHAT] Step 1 OK: image_prompt =', spec.meta.image_prompt.slice(0, 80))
  console.log('[CHAT] Step 1 OK: analysis =', (spec.meta.ai_analysis || '').slice(0, 80))
  console.log('[CHAT] Step 1 OK: adsets =', (spec.adsets || []).length)
  console.log('[CHAT] Step 1 OK: video_scenes =', ctx.videoScenes.length)

  // ══════════════════════════════════════════════════════════════════════
  // STEP 2: Generate visual content via DiCloak using Claude's prompt
  // ══════════════════════════════════════════════════════════════════════
  sendStep(`Generando ${typeLabel} con IA...`)
  console.log('[CHAT] Step 2: Generating visual content with DiCloak...')
  let filePath = null       // Primary file (image for campaign/image, video for video)
  let videoFilePath = null  // Video file (only for video_campaign)
  let imageFilePath = null  // Image file (only for video_campaign)
  try {
    const result = await generateContent(ctx)
    if (ctx.type === 'video_campaign' && result && typeof result === 'object' && !Buffer.isBuffer(result)) {
      // video_campaign returns { videoPath, imagePath }
      videoFilePath = result.videoPath || null
      imageFilePath = result.imagePath || null
      filePath = imageFilePath || videoFilePath // primary = image for campaign creative
      console.log('[CHAT] Step 2 OK: videoPath =', videoFilePath, '| imagePath =', imageFilePath)
    } else {
      filePath = result
      console.log('[CHAT] Step 2 OK: filePath =', filePath)
    }
  } catch (err) {
    console.error('[CHAT] Step 2 FAILED:', err.message)
    // For campaigns/video_campaign, continue without assets. For standalone, fail.
    if (ctx.type !== 'campaign' && ctx.type !== 'video_campaign') {
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
  sendStep('Preparando vista previa...')
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
  if (ctx.type === 'campaign' || ctx.type === 'video_campaign') {
    campaignInfo += '\n\n**Estado inicial:** La campaña se crea en PAUSED (no se activa sin tu confirmación)'
  }

  // ── Build final message ──
  const publishLabel = ctx.type === 'video_campaign' ? 'video + campaña'
    : ctx.publishAs === 'story' ? 'historia'
    : ctx.publishAs === 'reel' ? 'reel'
    : ctx.type === 'campaign' ? 'campaña'
    : 'publicación'

  const jobId = `job-${Date.now()}`
  // videoFilePath and imageFilePath are set in Step 2 (lines 798-812)
  // Guardar video_scenes del spec para extensiones automáticas
  const videoScenes = (spec?.meta?.video_scenes || []).filter(s => s && s.visual_description)
  pendingJobs.set(jobId, { ctx: { ...ctx }, filePath, videoFilePath, imageFilePath, spec, videoScenes, currentSceneIndex: 0 })

  let message = ''
  if (ctx.type === 'video_campaign') {
    message = `He preparado tu campaña con video: **"${ctx.description}"**`
    message += campaignInfo
    const parts = []
    if (videoFilePath) parts.push('**Video** generado para publicar como reel')
    if (imageFilePath) parts.push('**Imagen** generada para el creativo de la campaña')
    if (parts.length) message += '\n\n' + parts.join('\n') + '\n\n(se muestran abajo)'
    if (!imageFilePath && !videoFilePath) message += '\n\n_No se pudieron generar los assets. La campaña se puede crear sin ellos._'
    message += '\n\nAl aprobar:\n1. Se crea la **campaña** en Meta Ads (PAUSED) con la imagen\n2. Se publica el **video como reel** en tu página\n\n¿Apruebas?'
  } else if (ctx.type === 'campaign') {
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
    if (videoScenes.length > 1) {
      const nextScene = videoScenes[1]
      message += `\n\n**Escena 1 de ${videoScenes.length} completada.**`
      message += `\n\nSiguiente escena: _"${nextScene.voiceover || nextScene.visual_description?.slice(0, 80)}"_`
    }
    message += '\n\n¿Apruebas para publicar como reel?'
  } else {
    message = `He creado tu imagen publicitaria: **"${ctx.description}"**`
    message += campaignInfo
    if (filePath) {
      message += '\n\n**Imagen** lista (se muestra abajo).'
    } else {
      message += '\n\nNo se pudo generar la imagen. Verifica que DiCloak esté abierto.'
    }
    message += '\n\n¿Apruebas para publicar en ' + ctx.platform + '?'
  }

  // Convert image/video for preview in Electron renderer
  let imageDataUrl = ''
  let videoDataUrl = ''

  // For video_campaign: show both video and image previews
  const effectiveVideoPath = videoFilePath || (ctx.type === 'video' && filePath ? filePath : null)
  const effectiveImagePath = imageFilePath || (ctx.type !== 'video' && filePath ? filePath : null)

  if (effectiveVideoPath && fs.existsSync(effectiveVideoPath)) {
    videoDataUrl = `local-video://${effectiveVideoPath}`
  }
  if (effectiveImagePath && fs.existsSync(effectiveImagePath)) {
    try {
      const ext = path.extname(effectiveImagePath).toLowerCase().replace('.', '')
      const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
      const base64 = fs.readFileSync(effectiveImagePath).toString('base64')
      imageDataUrl = `data:${mime};base64,${base64}`
    } catch { /* ignore */ }
  }

  const hasMoreScenes = videoScenes.length > 1
  const nextScenePreview = hasMoreScenes ? (videoScenes[1]?.voiceover || videoScenes[1]?.visual_description?.slice(0, 100) || '') : ''

  return {
    success: true,
    needsApproval: !!filePath || !!videoFilePath || ctx.type === 'campaign' || ctx.type === 'video_campaign',
    jobId,
    message,
    hasMoreScenes,
    nextScenePreview,
    preview: {
      type: ctx.type,
      imagePath: effectiveImagePath,
      imageDataUrl,
      videoDataUrl,
      summary: ctx.type === 'video_campaign'
        ? `${(spec?.adsets || []).length} audiencias | video + campaña`
        : ctx.type === 'campaign'
          ? `${(spec?.adsets || []).length} audiencias | $${Number(ctx.budget).toLocaleString()}/día`
          : `${ctx.platform} | ${publishLabel}`,
      campaignSpec: spec,
    },
  }
}

async function handleChatExtendVideo(jobId, extendPrompt) {
  const job = pendingJobs.get(jobId)
  if (!job) return { success: false, error: 'No hay contenido pendiente.' }

  const ctx = job.ctx
  if (ctx.type !== 'video' && ctx.type !== 'video_campaign') {
    return { success: false, error: 'Solo se puede extender contenido de video.' }
  }

  // Si hay escenas pre-generadas, usar la siguiente automáticamente
  const scenes = job.videoScenes || []
  const sceneIdx = (job.currentSceneIndex || 0) + 1
  let resolvedPrompt = (extendPrompt || '').trim()
  let isPregenerated = false

  if (!resolvedPrompt && sceneIdx < scenes.length) {
    const nextScene = scenes[sceneIdx]
    const visualDesc = nextScene.visual_description || nextScene.prompt || ''
    const voiceover = nextScene.voiceover || ''
    // Inyectar voiceover como diálogo en español dentro del prompt visual
    resolvedPrompt = voiceover
      ? `${visualDesc}\n\nDIALOGUE/VOICEOVER (spoken in Spanish, Latin American accent): "${voiceover}". The character MUST speak this line naturally in Spanish.`
      : visualDesc
    isPregenerated = true
    console.log(`[EXTEND] Usando escena pre-generada ${sceneIdx + 1}/${scenes.length}: ${resolvedPrompt.slice(0, 80)}`)
  }

  if (!resolvedPrompt) {
    return { success: false, error: 'No hay más escenas pre-generadas y no se proporcionó un prompt.' }
  }

  // Read last download state for previous video URL
  const lastDownloadFile = path.join(PROJECT_ROOT, 'output', 'videos', 'last_download.json')
  let previousVideoUrl = ''
  try {
    if (fs.existsSync(lastDownloadFile)) {
      const dlState = JSON.parse(fs.readFileSync(lastDownloadFile, 'utf-8'))
      previousVideoUrl = dlState.video_url || ''
    }
  } catch { /* ignore */ }

  const pythonBin = findPython()
  if (!pythonBin) return { success: false, error: 'Python no encontrado.' }

  const env = getProjectEnv()
  const cdpPort = env.CDP_PROFILE_PORT || env.CDP_CHATGPT_PORT || '9225'

  const botEnv = {
    ...env,
    PYTHONPATH: PROJECT_ROOT,
    PYTHONIOENCODING: 'utf-8',
    BOT_VIDEO_EXTEND_PROMPT: resolvedPrompt,
    BOT_VIDEO_EXTEND_PREGENERATED: isPregenerated ? '1' : '0',
    BOT_VIDEO_PREVIOUS_VIDEO_URL: previousVideoUrl,
    CDP_PROFILE_PORT: cdpPort,
  }

  // Add company env if available
  if (ctx.companyName) {
    const credEnv = buildCompanyCredentialEnv(ctx.companyName)
    if (credEnv) Object.assign(botEnv, credEnv)
    const company = lookupCompanyData(ctx.companyName)
    if (company) {
      botEnv.BOT_COMPANY_NAME = company.nombre || ''
      botEnv.BUSINESS_WEBSITE = company.sitio_web || env.BUSINESS_WEBSITE || ''
      botEnv.BUSINESS_WHATSAPP = company.telefono || env.BUSINESS_WHATSAPP || ''
      if (company.logo) {
        const logoPath = path.join(PROJECT_ROOT, 'assets', 'logos', 'companies', company.logo)
        if (fs.existsSync(logoPath)) botEnv.BOT_COMPANY_LOGO_PATH = logoPath
      }
    }
  }

  const startTime = Date.now()
  const videoDir = path.join(PROJECT_ROOT, 'output', 'videos')

  try {
    const newFilePath = await new Promise((resolve, reject) => {
      const child = spawn(pythonBin, ['-m', 'core.video_rpa.extend_video', cdpPort], {
        cwd: PROJECT_ROOT, env: botEnv, stdio: ['ignore', 'pipe', 'pipe'],
      })
      state.botProcess = child
      let stdout = '', stderr = ''
      child.stdout.on('data', d => { stdout += d.toString(); console.log('[EXTEND]', d.toString().trim()) })
      child.stderr.on('data', d => { stderr += d.toString(); console.error('[EXTEND]', d.toString().trim()) })
      child.on('exit', (code) => {
        state.botProcess = null
        // Read the extended video path from last_download.json (most reliable)
        let newFile = null
        try {
          const dlState = JSON.parse(fs.readFileSync(path.join(videoDir, 'last_download.json'), 'utf-8'))
          if (dlState.output_path && fs.existsSync(dlState.output_path)) {
            const dlMtime = fs.statSync(dlState.output_path).mtimeMs
            if (dlMtime > startTime) {
              newFile = dlState.output_path
              console.log('[EXTEND] Using video from last_download.json:', newFile)
            }
          }
        } catch { /* ignore */ }
        // Fallback: find newest file
        if (!newFile) {
          newFile = findFileNewerThan(videoDir, startTime)
          if (newFile) console.log('[EXTEND] Using newest video file:', newFile)
        }
        if (newFile) {
          resolve(newFile)
        } else {
          const detail = stderr.trim().split('\n').filter(l => l.includes('[ERROR]')).pop() || stderr.trim().split('\n').pop() || ''
          reject(new Error(
            code === 0
              ? 'Extension completada pero no se encontró archivo nuevo.'
              : `Error al extender video (código ${code}). ${detail}`
          ))
        }
      })
      child.on('error', (err) => {
        state.botProcess = null
        reject(err)
      })
    })

    // Update the pending job with the new file and advance scene index
    const newJobId = `job-${Date.now()}`
    const newSceneIndex = sceneIdx
    pendingJobs.delete(jobId)
    pendingJobs.set(newJobId, {
      ctx: { ...ctx },
      filePath: newFilePath,
      videoFilePath: newFilePath,
      imageFilePath: null,
      spec: job.spec,
      videoScenes: scenes,
      currentSceneIndex: newSceneIndex,
    })

    // Build video preview URL with cache buster so Electron loads the NEW file
    let videoDataUrl = ''
    if (newFilePath && fs.existsSync(newFilePath)) {
      videoDataUrl = `local-video://${newFilePath}?t=${Date.now()}`
    }

    // Construir mensaje con info de siguiente escena
    const completedScene = newSceneIndex + 1
    const totalScenes = scenes.length
    const hasMoreScenes = (newSceneIndex + 1) < totalScenes
    let extMessage = `**Escena ${completedScene} de ${totalScenes || '?'} completada.**`

    if (hasMoreScenes) {
      const upcoming = scenes[newSceneIndex + 1]
      const upcomingVoiceover = upcoming.voiceover || upcoming.visual_description?.slice(0, 80) || ''
      extMessage += `\n\nSiguiente escena: _"${upcomingVoiceover}"_`
    } else {
      extMessage += '\n\nTodas las escenas completadas.'
    }

    return {
      success: true,
      jobId: newJobId,
      message: extMessage,
      hasMoreScenes,
      nextScenePreview: hasMoreScenes ? (scenes[newSceneIndex + 1]?.voiceover || scenes[newSceneIndex + 1]?.visual_description?.slice(0, 100) || '') : '',
      preview: {
        type: 'video',
        imagePath: newFilePath,
        videoDataUrl,
        summary: `${ctx.platform} | escena ${completedScene}/${totalScenes || '?'}`,
      },
    }
  } catch (err) {
    return { success: false, error: `Error al extender video: ${err.message || err}` }
  }
}

async function handleChatApprove(jobId, platform) {
  const job = pendingJobs.get(jobId)
  if (!job) return { success: false, error: 'No hay contenido pendiente.' }

  if (platform === 'instagram' || platform === 'facebook') {
    job.ctx.platform = platform
  }

  console.log(`[APPROVE] Job ${jobId}: type=${job.ctx.type} company=${job.ctx.companyName} file=${job.filePath || 'none'} spec_has_campaign=${!!(job.spec?.campaign)}`)

  try {
    const result = await publishToMeta(job)
    console.log(`[APPROVE] Success: ${(result.message || '').slice(0, 100)}`)
    pendingJobs.delete(jobId)
    resetContext()
    return result
  } catch (err) {
    console.error(`[APPROVE] Failed: ${err.message}`)
    return { success: false, error: err.message || String(err) }
  }
}

// ─── IPC ────────────────────────────────────────────────────────────────────

function registerChatHandlers(ipcMain) {
  ipcMain.handle('chat-command', async (event, text) => {
    try {
      const sendStep = (step) => {
        try { if (event.sender && !event.sender.isDestroyed()) event.sender.send('chat-step', step) } catch {}
      }
      return await handleChatCommand(String(text || '').trim(), sendStep)
    } catch (err) {
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('chat-approve', async (_event, jobId, platform) => {
    try {
      return await handleChatApprove(String(jobId || ''), String(platform || ''))
    } catch (err) {
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('chat-extend-video', async (_event, jobId, extendPrompt) => {
    try {
      return await handleChatExtendVideo(String(jobId || ''), String(extendPrompt || ''))
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
