/**
 * IPC Handlers — Historial de Publicaciones
 *
 * Canales:
 *   pub-list     → Listar publicaciones con filtros
 *   pub-get      → Obtener una publicación por post_id
 *   pub-delete   → Eliminar post de la plataforma + marcar deleted en DB
 *   pub-record   → Registrar manualmente una publicación
 */

const {
  insertPublication,
  markPublicationDeleted,
  listPublications,
  listActivePublications,
  getPublicationByPostId,
} = require('../data/publications')

const { deletePagePost } = require('../facebook/meta-marketing-api')
const { facebookApiRequest } = require('../facebook/api')
const { fetchCompanyRowsForPlatform } = require('../data/db')

function registerPublicationHandlers(ipcMain) {
  // ── Listar publicaciones ────────────────────────────────────────────────
  ipcMain.handle('pub-list', async (_event, payload = {}) => {
    try {
      const publications = listPublications(payload)
      return { success: true, publications }
    } catch (err) {
      return { success: false, error: err.message, publications: [] }
    }
  })

  // ── Obtener una publicación ─────────────────────────────────────────────
  ipcMain.handle('pub-get', async (_event, { postId } = {}) => {
    try {
      const publication = getPublicationByPostId(postId)
      return { success: true, publication }
    } catch (err) {
      return { success: false, error: err.message, publication: null }
    }
  })

  // ── Eliminar publicación (plataforma + DB) ──────────────────────────────
  ipcMain.handle('pub-delete', async (_event, { postId, platform, token } = {}) => {
    try {
      if (!postId) throw new Error('post_id requerido.')

      // Resolver token: si no viene, buscar del registro en DB
      let resolvedToken = token
      if (!resolvedToken) {
        const pub = getPublicationByPostId(postId)
        if (pub && pub.page_id) {
          const rows = fetchCompanyRowsForPlatform(platform || 'facebook')
          for (const row of rows) {
            if (row.page_id === pub.page_id || row.account_id === pub.page_id) {
              resolvedToken = row.token
              break
            }
          }
        }
      }

      if (!resolvedToken) {
        throw new Error('No se encontro un token valido para eliminar el post.')
      }

      // Eliminar de la plataforma (FB e IG usan el mismo Graph API DELETE)
      await facebookApiRequest('DELETE', postId, {}, resolvedToken)

      // Marcar como eliminado en DB
      markPublicationDeleted(postId)

      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Registrar publicación manualmente ───────────────────────────────────
  ipcMain.handle('pub-record', async (_event, payload = {}) => {
    try {
      const publication = insertPublication({
        postId: payload.postId,
        platform: payload.platform,
        pageId: payload.pageId,
        pageName: payload.pageName,
        companyName: payload.companyName,
        contentType: payload.contentType,
        message: payload.message,
        imageUrl: payload.imageUrl,
        status: payload.status || 'published',
      })
      return { success: true, publication }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Eliminar TODAS las publicaciones activas ────────────────────────────
  ipcMain.handle('pub-delete-all', async () => {
    try {
      const rows = listActivePublications()
      if (rows.length === 0) return { success: true, deleted: 0, failed: 0, errors: [] }

      // Build token cache from platform DBs
      const tokenCache = {}
      for (const platform of ['facebook', 'instagram']) {
        try {
          const platformRows = fetchCompanyRowsForPlatform(platform)
          for (const r of platformRows) {
            const key = r.page_id || r.account_id
            if (key && r.token) tokenCache[key] = r.token
          }
        } catch (err) {
          console.warn(`[Publications] Error loading ${platform} tokens:`, err.message)
        }
      }

      let deleted = 0
      let failed = 0
      const errors = []

      for (const pub of rows) {
        try {
          const token = tokenCache[pub.page_id]
          if (!token) throw new Error(`No token for page ${pub.page_id}`)

          await facebookApiRequest('DELETE', pub.post_id, {}, token)
          markPublicationDeleted(pub.post_id)
          deleted++
        } catch (err) {
          console.warn(`[Publications] Delete failed for ${pub.post_id}:`, err.message)
          errors.push({ post_id: pub.post_id, page_name: pub.page_name, error: err.message })
          failed++
        }
      }

      return { success: true, deleted, failed, errors }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerPublicationHandlers }
