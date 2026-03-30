/**
 * TikTok Content Posting API
 *
 * Funciones para publicar videos y fotos en TikTok.
 * Ref: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 *
 * Flujo:
 * 1. queryCreatorInfo() — obtener limites y privacy levels permitidos
 * 2. initDirectPostVideo() o initDirectPostPhoto() — iniciar publicacion
 * 3. checkPublishStatus() — verificar estado
 */

const { tiktokApiRequest } = require('./api')

// ─── Creator Info ─────────────────────────────────────────────────────────────

/**
 * Consulta las capacidades y limites del creator autenticado.
 * Obligatorio antes de publicar: retorna privacy_levels permitidos y duracion max.
 *
 * POST /v2/post/publish/creator_info/query/
 */
async function queryCreatorInfo(token) {
  if (!token) throw new Error('Se requiere un access token de TikTok.')

  const result = await tiktokApiRequest('POST', '/v2/post/publish/creator_info/query/', {}, token)
  const data = result?.data || {}

  return {
    creator_avatar_url: data.creator_avatar_url || '',
    creator_username: data.creator_username || '',
    creator_nickname: data.creator_nickname || '',
    privacy_level_options: Array.isArray(data.privacy_level_options) ? data.privacy_level_options : [],
    comment_disabled: Boolean(data.comment_disabled),
    duet_disabled: Boolean(data.duet_disabled),
    stitch_disabled: Boolean(data.stitch_disabled),
    max_video_post_duration_sec: data.max_video_post_duration_sec || 300,
  }
}

// ─── Video Direct Post ────────────────────────────────────────────────────────

/**
 * Inicia la publicacion directa de un video en TikTok.
 *
 * POST /v2/post/publish/video/init/
 *
 * @param {Object} params
 * @param {string} params.token - Access token
 * @param {string} params.title - Titulo/caption (max 2200 UTF-16 chars)
 * @param {string} [params.videoUrl] - URL publica del video (PULL_FROM_URL)
 * @param {number} [params.videoSize] - Tamano en bytes (FILE_UPLOAD)
 * @param {string} [params.privacyLevel] - PUBLIC_TO_EVERYONE | SELF_ONLY | etc.
 * @param {boolean} [params.isAigc] - true si el contenido fue generado por IA
 * @param {number} [params.coverTimestampMs] - Timestamp del frame para thumbnail
 * @returns {Promise<{ publish_id: string, upload_url?: string }>}
 */
async function initDirectPostVideo({
  token,
  title = '',
  videoUrl,
  videoSize,
  privacyLevel = 'SELF_ONLY',
  isAigc = true,
  coverTimestampMs,
} = {}) {
  if (!token) throw new Error('Se requiere un access token de TikTok.')

  const postInfo = {
    title,
    privacy_level: privacyLevel,
    disable_duet: false,
    disable_stitch: false,
    disable_comment: false,
    is_aigc: isAigc,
  }

  if (coverTimestampMs !== undefined) {
    postInfo.video_cover_timestamp_ms = coverTimestampMs
  }

  const sourceInfo = {}

  if (videoUrl) {
    sourceInfo.source = 'PULL_FROM_URL'
    sourceInfo.video_url = videoUrl
  } else if (videoSize) {
    sourceInfo.source = 'FILE_UPLOAD'
    sourceInfo.video_size = videoSize
    sourceInfo.chunk_size = Math.min(videoSize, 10 * 1024 * 1024) // 10MB max chunk
    sourceInfo.total_chunk_count = Math.ceil(videoSize / sourceInfo.chunk_size)
  } else {
    throw new Error('Se requiere videoUrl (PULL_FROM_URL) o videoSize (FILE_UPLOAD).')
  }

  const result = await tiktokApiRequest('POST', '/v2/post/publish/video/init/', {
    post_info: postInfo,
    source_info: sourceInfo,
  }, token)

  return {
    publish_id: result?.data?.publish_id || '',
    upload_url: result?.data?.upload_url || '',
  }
}

// ─── Photo Direct Post ────────────────────────────────────────────────────────

/**
 * Inicia la publicacion directa de fotos en TikTok.
 *
 * POST /v2/post/publish/content/init/
 *
 * @param {Object} params
 * @param {string} params.token - Access token
 * @param {string} params.title - Titulo (max 90 UTF-16 chars)
 * @param {string[]} params.photoUrls - URLs publicas de las imagenes (max 35)
 * @param {string} [params.description] - Descripcion (max 4000 UTF-16 chars)
 * @param {string} [params.privacyLevel]
 * @param {boolean} [params.isAigc]
 * @param {number} [params.photoCoverIndex] - Index de la foto de portada
 * @returns {Promise<{ publish_id: string }>}
 */
async function initDirectPostPhoto({
  token,
  title = '',
  photoUrls = [],
  description = '',
  privacyLevel = 'SELF_ONLY',
  isAigc = true,
  photoCoverIndex = 0,
} = {}) {
  if (!token) throw new Error('Se requiere un access token de TikTok.')
  if (!photoUrls.length) throw new Error('Se requiere al menos una URL de imagen.')
  if (photoUrls.length > 35) throw new Error('TikTok permite maximo 35 fotos por post.')

  const result = await tiktokApiRequest('POST', '/v2/post/publish/content/init/', {
    media_type: 'PHOTO',
    post_mode: 'DIRECT_POST',
    post_info: {
      title,
      description,
      privacy_level: privacyLevel,
      disable_comment: false,
      auto_add_music: true,
      is_aigc: isAigc,
    },
    source_info: {
      source: 'PULL_FROM_URL',
      photo_cover_index: photoCoverIndex,
      photo_images: photoUrls,
    },
  }, token)

  return {
    publish_id: result?.data?.publish_id || '',
  }
}

// ─── Publish Status ───────────────────────────────────────────────────────────

/**
 * Verifica el estado de una publicacion iniciada.
 *
 * POST /v2/post/publish/status/fetch/
 *
 * @param {string} token
 * @param {string} publishId
 * @returns {Promise<{ status: string, publish_id: string, uploaded_bytes?: number, error_code?: string }>}
 */
async function checkPublishStatus(token, publishId) {
  if (!token) throw new Error('Se requiere un access token de TikTok.')
  if (!publishId) throw new Error('Se requiere un publish_id.')

  const result = await tiktokApiRequest('POST', '/v2/post/publish/status/fetch/', {
    publish_id: publishId,
  }, token)

  const data = result?.data || {}
  return {
    status: data.status || 'UNKNOWN',
    publish_id: publishId,
    uploaded_bytes: data.uploaded_bytes || 0,
    error_code: data.fail_reason || '',
  }
}

// ─── User Info ────────────────────────────────────────────────────────────────

/**
 * Obtiene informacion basica del usuario autenticado.
 *
 * GET /v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username
 */
async function getUserInfo(token) {
  if (!token) throw new Error('Se requiere un access token de TikTok.')

  const result = await tiktokApiRequest(
    'GET',
    '/v2/user/info/',
    { fields: 'open_id,union_id,avatar_url,display_name,username' },
    token
  )

  const user = result?.data?.user || {}
  return {
    open_id: user.open_id || '',
    username: user.username || '',
    display_name: user.display_name || '',
    avatar_url: user.avatar_url || '',
  }
}

module.exports = {
  queryCreatorInfo,
  initDirectPostVideo,
  initDirectPostPhoto,
  checkPublishStatus,
  getUserInfo,
}
