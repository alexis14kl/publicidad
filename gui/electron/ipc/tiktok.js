/**
 * IPC Handlers — TikTok Content Posting API
 *
 * Canales registrados:
 *   tiktok-query-creator-info    → Info del creator (limites, privacy levels)
 *   tiktok-publish-video         → Publicar video directo
 *   tiktok-publish-photo         → Publicar foto(s) directo
 *   tiktok-check-publish-status  → Estado de publicacion
 *   tiktok-get-user-info         → Info del usuario autenticado
 *   tiktok-refresh-token         → Renovar access token
 */

const {
  queryCreatorInfo,
  initDirectPostVideo,
  initDirectPostPhoto,
  checkPublishStatus,
  getUserInfo,
} = require('../tiktok/tiktok-content-api')
const { refreshTikTokToken } = require('../tiktok/tiktok-token-refresh')

function registerTikTokHandlers(ipcMain) {
  ipcMain.handle('tiktok-query-creator-info', async (_event, { token } = {}) => {
    try {
      const info = await queryCreatorInfo(token)
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('tiktok-publish-video', async (_event, payload = {}) => {
    try {
      const result = await initDirectPostVideo(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('tiktok-publish-photo', async (_event, payload = {}) => {
    try {
      const result = await initDirectPostPhoto(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('tiktok-check-publish-status', async (_event, { token, publishId } = {}) => {
    try {
      const result = await checkPublishStatus(token, publishId)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('tiktok-get-user-info', async (_event, { token } = {}) => {
    try {
      const info = await getUserInfo(token)
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('tiktok-refresh-token', async (_event, { refreshToken } = {}) => {
    try {
      const result = await refreshTikTokToken(refreshToken)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerTikTokHandlers }
