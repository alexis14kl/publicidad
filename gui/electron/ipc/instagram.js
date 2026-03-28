/**
 * IPC Handlers — Instagram API (publicacion, media, comentarios, insights)
 *
 * Canales registrados:
 *   ig-get-user-id              → Obtener IG Business Account ID
 *   ig-get-account-info         → Info de la cuenta (username, followers, etc.)
 *   ig-create-image-container   → Crear contenedor de imagen
 *   ig-create-reel-container    → Crear contenedor de reel/video
 *   ig-create-story-container   → Crear contenedor de story
 *   ig-create-carousel          → Crear carrusel (items + contenedor)
 *   ig-check-container-status   → Verificar estado de procesamiento
 *   ig-publish-container        → Publicar contenedor
 *   ig-publish-image            → Publicar imagen (2 pasos en 1)
 *   ig-publish-reel             → Publicar reel (crear + esperar + publicar)
 *   ig-list-media               → Listar posts publicados
 *   ig-get-media-detail         → Detalle de un post
 *   ig-get-publishing-limit     → Limite de publicaciones (100/24h)
 *   ig-list-comments            → Listar comentarios de un post
 *   ig-reply-comment            → Responder a un comentario
 *   ig-hide-comment             → Ocultar/mostrar un comentario
 *   ig-toggle-comments          → Activar/desactivar comentarios en un post
 *   ig-get-account-insights     → Metricas de la cuenta
 *   ig-get-media-insights       → Metricas de un post
 */

const {
  getIgUserId,
  getAccountInfo,
  createImageContainer,
  createReelContainer,
  createStoryContainer,
  createCarouselContainers,
  checkContainerStatus,
  publishContainer,
  publishImage,
  publishReel,
  listMedia,
  getMediaDetail,
  getPublishingLimit,
  listComments,
  replyToComment,
  hideComment,
  toggleComments,
  getAccountInsights,
  getMediaInsights,
} = require('../facebook/instagram-api')

function registerInstagramHandlers(ipcMain) {
  // ── 1. IG User ID ───────────────────────────────────────────────────────
  ipcMain.handle('ig-get-user-id', async (_event, payload = {}) => {
    try {
      const accounts = await getIgUserId(payload)
      return { success: true, accounts }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 2. Account Info ──────────────────────────────────────────────────────
  ipcMain.handle('ig-get-account-info', async (_event, payload = {}) => {
    try {
      const info = await getAccountInfo(payload)
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 3. Publishing — Containers ───────────────────────────────────────────
  ipcMain.handle('ig-create-image-container', async (_event, payload = {}) => {
    try {
      const result = await createImageContainer(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-create-reel-container', async (_event, payload = {}) => {
    try {
      const result = await createReelContainer(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-create-story-container', async (_event, payload = {}) => {
    try {
      const result = await createStoryContainer(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-create-carousel', async (_event, payload = {}) => {
    try {
      const result = await createCarouselContainers(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-check-container-status', async (_event, payload = {}) => {
    try {
      const result = await checkContainerStatus(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-publish-container', async (_event, payload = {}) => {
    try {
      const result = await publishContainer(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 3. Publishing — Convenience (multi-step) ────────────────────────────
  ipcMain.handle('ig-publish-image', async (event, payload = {}) => {
    try {
      const result = await publishImage({
        ...payload,
        onStep: (step, msg) => {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('ig-publish-step', { step, message: msg })
          }
        },
      })
      if (result.media_id) {
        try {
          const { insertPublication } = require('../data/publications')
          insertPublication({
            postId: result.media_id,
            platform: 'instagram',
            pageId: payload.igUserId || payload.accountId || '',
            pageName: payload.pageName || '',
            companyName: payload.companyName || '',
            contentType: 'image',
            message: payload.caption || '',
            imageUrl: payload.imageUrl || '',
            status: 'published',
          })
        } catch (err) { console.warn('[Publications] Error recording IG post:', err.message) }
      }
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-publish-reel', async (event, payload = {}) => {
    try {
      const result = await publishReel({
        ...payload,
        onStep: (step, msg) => {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('ig-publish-step', { step, message: msg })
          }
        },
      })
      if (result.media_id) {
        try {
          const { insertPublication } = require('../data/publications')
          insertPublication({
            postId: result.media_id,
            platform: 'instagram',
            pageId: payload.igUserId || payload.accountId || '',
            pageName: payload.pageName || '',
            companyName: payload.companyName || '',
            contentType: 'reel',
            message: payload.caption || '',
            imageUrl: '',
            status: 'published',
          })
        } catch (err) { console.warn('[Publications] Error recording IG post:', err.message) }
      }
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 4. Media ─────────────────────────────────────────────────────────────
  ipcMain.handle('ig-list-media', async (_event, payload = {}) => {
    try {
      const media = await listMedia(payload)
      return { success: true, media }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-get-media-detail', async (_event, payload = {}) => {
    try {
      const detail = await getMediaDetail(payload)
      return { success: true, ...detail }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-get-publishing-limit', async (_event, payload = {}) => {
    try {
      const limit = await getPublishingLimit(payload)
      return { success: true, ...limit }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 5. Comments ──────────────────────────────────────────────────────────
  ipcMain.handle('ig-list-comments', async (_event, payload = {}) => {
    try {
      const comments = await listComments(payload)
      return { success: true, comments }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-reply-comment', async (_event, payload = {}) => {
    try {
      const result = await replyToComment(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-hide-comment', async (_event, payload = {}) => {
    try {
      const result = await hideComment(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-toggle-comments', async (_event, payload = {}) => {
    try {
      const result = await toggleComments(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 6. Insights ──────────────────────────────────────────────────────────
  ipcMain.handle('ig-get-account-insights', async (_event, payload = {}) => {
    try {
      const insights = await getAccountInsights(payload)
      return { success: true, insights }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ig-get-media-insights', async (_event, payload = {}) => {
    try {
      const insights = await getMediaInsights(payload)
      return { success: true, insights }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerInstagramHandlers }
