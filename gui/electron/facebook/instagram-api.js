/**
 * Instagram API — Endpoints para publicar contenido y consultar metricas
 *
 * Reutiliza el token de Facebook (FB_PAGE_ACCESS_TOKEN o FB_ACCESS_TOKEN)
 * para operar Instagram. El IG User ID se auto-resuelve desde la Page
 * vinculada — el usuario solo configura Facebook y funciona para ambos.
 *
 * Flujo:
 * 1. Auto-resolver IG User ID via GET /me/accounts?fields=instagram_business_account
 * 2. Publicar contenido (imagen, reel, story, carrusel) — flujo 2 pasos
 * 3. Consultar media publicada
 * 4. Gestion de comentarios
 * 5. Insights y metricas
 *
 * API version: v25.0
 * Ref: developers.facebook.com/docs/instagram-api
 */

const { facebookApiRequest } = require('./api')
const { getProjectEnv } = require('../utils/env')

// ─── Cache del IG User ID (se resuelve una vez por sesión) ──────────────────

let _cachedIgUserId = ''
let _cachedToken = ''

function _invalidateCache() {
  _cachedIgUserId = ''
  _cachedToken = ''
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _getToken() {
  const env = getProjectEnv()
  return String(
    env.FB_PAGE_ACCESS_TOKEN ||
    env.FB_ACCESS_TOKEN ||
    env.INSTAGRAM_ACCESS_TOKEN ||
    ''
  ).trim()
}

function _getConfiguredIgUserId() {
  const env = getProjectEnv()
  return String(env.INSTAGRAM_BUSINESS_ACCOUNT_ID || env.INSTAGRAM_ACCOUNT_ID || '').trim()
}

/**
 * Auto-resuelve el IG Business Account ID.
 *
 * Prioridad:
 * 1. igUserId pasado como argumento
 * 2. INSTAGRAM_BUSINESS_ACCOUNT_ID o INSTAGRAM_ACCOUNT_ID del .env
 * 3. Cache de sesión (evita llamadas repetidas a la API)
 * 4. Auto-descubrimiento via GET /me/accounts (usando el token de Facebook)
 *
 * Esto permite que el usuario SOLO configure Facebook y funcione Instagram.
 */
async function resolveIgUserId(igUserId, token) {
  // 1. Argumento directo
  if (igUserId) return igUserId

  // 2. Variable de entorno
  const configured = _getConfiguredIgUserId()
  if (configured) return configured

  // 3. Cache
  const resolvedToken = token || _getToken()
  if (_cachedIgUserId && _cachedToken === resolvedToken) {
    return _cachedIgUserId
  }

  // 4. Auto-descubrimiento desde Facebook
  if (!resolvedToken) return ''

  try {
    const env = getProjectEnv()
    const targetPageId = String(env.FB_PAGE_ID || '').trim()

    const result = await facebookApiRequest('GET', 'me/accounts', {
      fields: 'id,name,instagram_business_account',
    }, resolvedToken)

    const pages = Array.isArray(result?.data) ? result.data : []
    const withIg = pages.filter((p) => p.instagram_business_account?.id)

    if (withIg.length === 0) return ''

    // Si hay FB_PAGE_ID configurado, buscar esa página primero
    let match = null
    if (targetPageId) {
      match = withIg.find((p) => String(p.id) === targetPageId)
    }
    // Fallback: primera página con IG vinculado
    if (!match) match = withIg[0]

    const resolved = String(match.instagram_business_account.id)
    _cachedIgUserId = resolved
    _cachedToken = resolvedToken
    return resolved
  } catch {
    return ''
  }
}

/**
 * Configuración resuelta de Instagram — versión sync (solo lee env/cache).
 * Para la versión completa con auto-resolución, usar resolveInstagramConfig().
 */
function getInstagramConfig() {
  return {
    igUserId: _cachedIgUserId || _getConfiguredIgUserId(),
    accessToken: _getToken(),
    pageId: String(getProjectEnv().FB_PAGE_ID || '').trim(),
  }
}

/**
 * Configuración completa con auto-resolución del IG User ID.
 * Usa el token de Facebook para descubrir la cuenta de Instagram vinculada.
 */
async function resolveInstagramConfig({ igUserId, token } = {}) {
  const resolvedToken = token || _getToken()
  const resolvedId = await resolveIgUserId(igUserId, resolvedToken)

  return {
    igUserId: resolvedId,
    accessToken: resolvedToken,
    pageId: String(getProjectEnv().FB_PAGE_ID || '').trim(),
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. OBTENER IG USER ID
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Obtiene el IG Business Account ID desde las paginas del usuario.
 * GET /me/accounts?fields=id,name,instagram_business_account
 */
async function getIgUserId({ token } = {}) {
  const resolvedToken = token || _getToken()

  if (!resolvedToken) {
    throw new Error('Se requiere un Access Token (FB_ACCESS_TOKEN o FB_PAGE_ACCESS_TOKEN).')
  }

  const result = await facebookApiRequest('GET', 'me/accounts', {
    fields: 'id,name,instagram_business_account',
  }, resolvedToken)

  const pages = Array.isArray(result?.data) ? result.data : []
  const accounts = pages
    .filter((p) => p.instagram_business_account?.id)
    .map((p) => ({
      page_id: String(p.id || ''),
      page_name: String(p.name || ''),
      ig_user_id: String(p.instagram_business_account.id),
    }))

  // Cache the first result for future use
  if (accounts.length > 0 && !_cachedIgUserId) {
    _cachedIgUserId = accounts[0].ig_user_id
    _cachedToken = resolvedToken
  }

  return accounts
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. CONSULTAR DATOS DE LA CUENTA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Obtiene informacion de la cuenta de Instagram Business.
 */
async function getAccountInfo({ igUserId, token } = {}) {
  const config = await resolveInstagramConfig({ igUserId, token })

  if (!config.igUserId) throw new Error('No se pudo resolver el IG User ID. Verifica que tu Facebook Page tenga una cuenta de Instagram Business vinculada.')
  if (!config.accessToken) throw new Error('Se requiere un Access Token (FB_ACCESS_TOKEN o FB_PAGE_ACCESS_TOKEN).')

  return await facebookApiRequest('GET', config.igUserId, {
    fields: 'id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url',
  }, config.accessToken)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. PUBLICAR CONTENIDO — Flujo de 2 pasos
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * PASO A: Crear contenedor de imagen.
 * POST /{IG_USER_ID}/media
 */
async function createImageContainer({ igUserId, token, imageUrl, caption } = {}) {
  const config = await resolveInstagramConfig({ igUserId, token })

  if (!config.igUserId) throw new Error('No se pudo resolver el IG User ID. Verifica que tu Facebook Page tenga Instagram Business vinculado.')
  if (!config.accessToken) throw new Error('Se requiere un Access Token.')
  if (!imageUrl) throw new Error('Se requiere una image_url publica.')

  const payload = { image_url: imageUrl }
  if (caption) payload.caption = caption

  const result = await facebookApiRequest('POST', `${config.igUserId}/media`, payload, config.accessToken)
  return { container_id: result.id || '' }
}

/**
 * PASO A: Crear contenedor de reel/video.
 * POST /{IG_USER_ID}/media con media_type=REELS
 */
async function createReelContainer({ igUserId, token, videoUrl, caption, thumbOffset } = {}) {
  const config = await resolveInstagramConfig({ igUserId, token })

  if (!config.igUserId) throw new Error('No se pudo resolver el IG User ID. Verifica que tu Facebook Page tenga Instagram Business vinculado.')
  if (!config.accessToken) throw new Error('Se requiere un Access Token.')
  if (!videoUrl) throw new Error('Se requiere una video_url publica.')

  const payload = {
    media_type: 'REELS',
    video_url: videoUrl,
  }
  if (caption) payload.caption = caption
  if (thumbOffset) payload.thumb_offset = String(thumbOffset)

  const result = await facebookApiRequest('POST', `${config.igUserId}/media`, payload, config.accessToken)
  return { container_id: result.id || '' }
}

/**
 * PASO A: Crear contenedor de story.
 * POST /{IG_USER_ID}/media con media_type=STORIES
 */
async function createStoryContainer({ igUserId, token, imageUrl, videoUrl } = {}) {
  const config = await resolveInstagramConfig({ igUserId, token })

  if (!config.igUserId) throw new Error('No se pudo resolver el IG User ID. Verifica que tu Facebook Page tenga Instagram Business vinculado.')
  if (!config.accessToken) throw new Error('Se requiere un Access Token.')

  const payload = { media_type: 'STORIES' }
  if (videoUrl) {
    payload.video_url = videoUrl
  } else if (imageUrl) {
    payload.image_url = imageUrl
  } else {
    throw new Error('Se requiere image_url o video_url para stories.')
  }

  const result = await facebookApiRequest('POST', `${config.igUserId}/media`, payload, config.accessToken)
  return { container_id: result.id || '' }
}

/**
 * PASO A.1 + A.2: Crear contenedores de carrusel (hasta 10 items).
 */
async function createCarouselContainers({ igUserId, token, items, caption } = {}) {
  const config = await resolveInstagramConfig({ igUserId, token })

  if (!config.igUserId) throw new Error('No se pudo resolver el IG User ID. Verifica que tu Facebook Page tenga Instagram Business vinculado.')
  if (!config.accessToken) throw new Error('Se requiere un Access Token.')
  if (!Array.isArray(items) || items.length < 2) {
    throw new Error('Un carrusel necesita al menos 2 items.')
  }
  if (items.length > 10) {
    throw new Error('Un carrusel permite maximo 10 items.')
  }

  // Crear contenedor para cada item
  const childIds = []
  for (const item of items) {
    const payload = { is_carousel_item: 'true' }
    if (item.videoUrl) {
      payload.media_type = 'VIDEO'
      payload.video_url = item.videoUrl
    } else if (item.imageUrl) {
      payload.image_url = item.imageUrl
    } else {
      throw new Error('Cada item del carrusel necesita imageUrl o videoUrl.')
    }

    const result = await facebookApiRequest('POST', `${config.igUserId}/media`, payload, config.accessToken)
    childIds.push(result.id)
  }

  // Crear contenedor del carrusel
  const carouselPayload = {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
  }
  if (caption) carouselPayload.caption = caption

  const result = await facebookApiRequest('POST', `${config.igUserId}/media`, carouselPayload, config.accessToken)
  return {
    container_id: result.id || '',
    child_ids: childIds,
  }
}

/**
 * Verificar estado de procesamiento de un contenedor (video/reel).
 * GET /{CONTAINER_ID}?fields=status_code
 * Estados: FINISHED | IN_PROGRESS | ERROR | EXPIRED
 */
async function checkContainerStatus({ containerId, token } = {}) {
  const resolvedToken = token || _getToken()

  if (!containerId) throw new Error('Se requiere el container_id.')
  if (!resolvedToken) throw new Error('Se requiere un Access Token.')

  const result = await facebookApiRequest('GET', containerId, {
    fields: 'status_code,status',
  }, resolvedToken)

  return {
    container_id: containerId,
    status_code: String(result.status_code || '').toUpperCase(),
    status: result.status || null,
  }
}

/**
 * PASO B: Publicar un contenedor (aplica a imagen, reel, story, carrusel).
 * POST /{IG_USER_ID}/media_publish
 */
async function publishContainer({ igUserId, token, containerId } = {}) {
  const config = await resolveInstagramConfig({ igUserId, token })

  if (!config.igUserId) throw new Error('No se pudo resolver el IG User ID. Verifica que tu Facebook Page tenga Instagram Business vinculado.')
  if (!config.accessToken) throw new Error('Se requiere un Access Token.')
  if (!containerId) throw new Error('Se requiere el container_id (creation_id).')

  const result = await facebookApiRequest('POST', `${config.igUserId}/media_publish`, {
    creation_id: containerId,
  }, config.accessToken)

  return { media_id: result.id || '' }
}

/**
 * Publicar imagen completa (2 pasos en uno).
 */
async function publishImage({ igUserId, token, imageUrl, caption, onStep } = {}) {
  const log = (step, msg) => { if (typeof onStep === 'function') onStep(step, msg) }

  log(1, 'Creando contenedor de imagen...')
  const container = await createImageContainer({ igUserId, token, imageUrl, caption })
  log(1, `Contenedor creado: ${container.container_id}`)

  log(2, 'Publicando imagen...')
  const published = await publishContainer({ igUserId, token, containerId: container.container_id })
  log(2, `Publicado: media_id=${published.media_id}`)

  return {
    container_id: container.container_id,
    media_id: published.media_id,
  }
}

/**
 * Publicar reel completo (crear + esperar + publicar).
 */
async function publishReel({ igUserId, token, videoUrl, caption, thumbOffset, onStep, maxWaitMs = 120000 } = {}) {
  const log = (step, msg) => { if (typeof onStep === 'function') onStep(step, msg) }

  log(1, 'Creando contenedor de reel...')
  const container = await createReelContainer({ igUserId, token, videoUrl, caption, thumbOffset })
  log(1, `Contenedor creado: ${container.container_id}`)

  // Esperar procesamiento
  log(2, 'Esperando procesamiento del video...')
  const startTime = Date.now()
  while (Date.now() - startTime < maxWaitMs) {
    const status = await checkContainerStatus({ containerId: container.container_id, token })
    if (status.status_code === 'FINISHED') {
      log(2, 'Video procesado correctamente.')
      break
    }
    if (status.status_code === 'ERROR') {
      throw new Error(`El video fallo al procesarse: ${JSON.stringify(status.status)}`)
    }
    if (status.status_code === 'EXPIRED') {
      throw new Error('El contenedor de video expiro (>24h).')
    }
    // IN_PROGRESS — esperar 5s
    await new Promise((r) => setTimeout(r, 5000))
  }

  log(3, 'Publicando reel...')
  const published = await publishContainer({ igUserId, token, containerId: container.container_id })
  log(3, `Publicado: media_id=${published.media_id}`)

  return {
    container_id: container.container_id,
    media_id: published.media_id,
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. CONSULTAR MEDIA PUBLICADA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Listar posts publicados.
 */
async function listMedia({ igUserId, token, limit = 25 } = {}) {
  const config = await resolveInstagramConfig({ igUserId, token })

  if (!config.igUserId) throw new Error('No se pudo resolver el IG User ID.')
  if (!config.accessToken) throw new Error('Se requiere un Access Token.')

  const result = await facebookApiRequest('GET', `${config.igUserId}/media`, {
    fields: 'id,media_type,media_url,caption,timestamp,permalink,like_count,comments_count,media_product_type',
    limit: String(limit),
  }, config.accessToken)

  return Array.isArray(result?.data) ? result.data : []
}

/**
 * Obtener detalle de un post especifico.
 */
async function getMediaDetail({ mediaId, token } = {}) {
  const resolvedToken = token || _getToken()

  if (!mediaId) throw new Error('Se requiere el media_id.')
  if (!resolvedToken) throw new Error('Se requiere un Access Token.')

  return await facebookApiRequest('GET', mediaId, {
    fields: 'id,media_type,media_url,thumbnail_url,caption,timestamp,permalink,like_count,comments_count,is_comment_enabled,media_product_type,shortcode,username',
  }, resolvedToken)
}

/**
 * Consultar limite de publicaciones (100/24h).
 */
async function getPublishingLimit({ igUserId, token } = {}) {
  const config = await resolveInstagramConfig({ igUserId, token })

  if (!config.igUserId) throw new Error('No se pudo resolver el IG User ID.')
  if (!config.accessToken) throw new Error('Se requiere un Access Token.')

  const result = await facebookApiRequest('GET', `${config.igUserId}/content_publishing_limit`, {
    fields: 'config,quota_usage',
  }, config.accessToken)

  return result?.data?.[0] || result || {}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. GESTION DE COMENTARIOS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Listar comentarios de un post.
 */
async function listComments({ mediaId, token, limit = 50 } = {}) {
  const resolvedToken = token || _getToken()

  if (!mediaId) throw new Error('Se requiere el media_id.')
  if (!resolvedToken) throw new Error('Se requiere un Access Token.')

  const result = await facebookApiRequest('GET', `${mediaId}/comments`, {
    fields: 'id,text,timestamp,username,like_count,replies{id,text,timestamp,username}',
    limit: String(limit),
  }, resolvedToken)

  return Array.isArray(result?.data) ? result.data : []
}

/**
 * Responder a un comentario.
 */
async function replyToComment({ commentId, token, message } = {}) {
  const resolvedToken = token || _getToken()

  if (!commentId) throw new Error('Se requiere el comment_id.')
  if (!message) throw new Error('Se requiere el mensaje de respuesta.')
  if (!resolvedToken) throw new Error('Se requiere un Access Token.')

  const result = await facebookApiRequest('POST', `${commentId}/replies`, {
    message,
  }, resolvedToken)

  return { comment_id: result.id || '' }
}

/**
 * Ocultar o mostrar un comentario.
 */
async function hideComment({ commentId, token, hide = true } = {}) {
  const resolvedToken = token || _getToken()

  if (!commentId) throw new Error('Se requiere el comment_id.')
  if (!resolvedToken) throw new Error('Se requiere un Access Token.')

  const result = await facebookApiRequest('POST', commentId, {
    hide: String(hide),
  }, resolvedToken)

  return { success: result.success !== false }
}

/**
 * Activar o desactivar comentarios en un post.
 */
async function toggleComments({ mediaId, token, enabled = true } = {}) {
  const resolvedToken = token || _getToken()

  if (!mediaId) throw new Error('Se requiere el media_id.')
  if (!resolvedToken) throw new Error('Se requiere un Access Token.')

  const result = await facebookApiRequest('POST', mediaId, {
    comment_enabled: String(enabled),
  }, resolvedToken)

  return { success: result.success !== false }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. INSIGHTS Y METRICAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Metricas de la cuenta (impressions, reach, profile_views).
 */
async function getAccountInsights({ igUserId, token, metrics, period = 'day' } = {}) {
  const config = await resolveInstagramConfig({ igUserId, token })

  if (!config.igUserId) throw new Error('No se pudo resolver el IG User ID.')
  if (!config.accessToken) throw new Error('Se requiere un Access Token.')

  const resolvedMetrics = metrics || 'impressions,reach,profile_views'

  const result = await facebookApiRequest('GET', `${config.igUserId}/insights`, {
    metric: resolvedMetrics,
    period,
  }, config.accessToken)

  return Array.isArray(result?.data) ? result.data : []
}

/**
 * Metricas de un post especifico.
 */
async function getMediaInsights({ mediaId, token, metrics } = {}) {
  const resolvedToken = token || _getToken()

  if (!mediaId) throw new Error('Se requiere el media_id.')
  if (!resolvedToken) throw new Error('Se requiere un Access Token.')

  const resolvedMetrics = metrics || 'engagement,impressions,reach'

  const result = await facebookApiRequest('GET', `${mediaId}/insights`, {
    metric: resolvedMetrics,
    period: 'lifetime',
  }, resolvedToken)

  return Array.isArray(result?.data) ? result.data : []
}

module.exports = {
  // Config
  getInstagramConfig,
  resolveInstagramConfig,
  resolveIgUserId,
  // 1. IG User ID
  getIgUserId,
  // 2. Account info
  getAccountInfo,
  // 3. Publishing — containers
  createImageContainer,
  createReelContainer,
  createStoryContainer,
  createCarouselContainers,
  checkContainerStatus,
  publishContainer,
  // 3. Publishing — convenience
  publishImage,
  publishReel,
  // 4. Media
  listMedia,
  getMediaDetail,
  getPublishingLimit,
  // 5. Comments
  listComments,
  replyToComment,
  hideComment,
  toggleComments,
  // 6. Insights
  getAccountInsights,
  getMediaInsights,
}
