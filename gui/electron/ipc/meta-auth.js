/**
 * IPC Handlers — Meta Marketing API (OAuth, Tokens, Campaign Pipeline, Page Posts)
 *
 * Canales registrados:
 *   meta-get-app-token           → App Access Token (server-to-server)
 *   meta-get-oauth-url           → URL de login OAuth
 *   meta-exchange-code           → Intercambiar code por short-lived token
 *   meta-exchange-long-lived     → Extender a long-lived token (60 dias)
 *   meta-get-page-tokens         → Listar paginas + Page Tokens
 *   meta-debug-token             → Inspeccionar un token
 *   meta-upload-ad-image         → Subir imagen al ad account
 *   meta-create-leadgen-form     → Crear formulario de leads
 *   meta-create-campaign         → Crear campana
 *   meta-create-adset            → Crear ad set
 *   meta-create-ad-creative      → Crear ad creative
 *   meta-create-ad               → Crear anuncio
 *   meta-activate-campaign       → Activar campana (PAUSED → ACTIVE)
 *   meta-execute-lead-pipeline   → Pipeline completo (6 pasos)
 *   meta-publish-page-post       → Publicar post en pagina
 *   meta-publish-page-photo      → Publicar foto en pagina
 */

const {
  getAppAccessToken,
  getOAuthLoginUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getPageAccessTokens,
  debugToken,
  uploadAdImage,
  createLeadgenForm,
  createCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  activateCampaign,
  executeLeadCampaignPipeline,
  publishPagePost,
  publishPagePhoto,
} = require('../facebook/meta-marketing-api')

function registerMetaAuthHandlers(ipcMain) {
  // ── 1. App Access Token ──────────────────────────────────────────────────
  ipcMain.handle('meta-get-app-token', async (_event, payload = {}) => {
    try {
      const result = await getAppAccessToken(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 2. OAuth Flow ────────────────────────────────────────────────────────
  ipcMain.handle('meta-get-oauth-url', async (_event, payload = {}) => {
    try {
      const url = getOAuthLoginUrl(payload)
      return { success: true, url }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-exchange-code', async (_event, payload = {}) => {
    try {
      const result = await exchangeCodeForToken(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-exchange-long-lived', async (_event, payload = {}) => {
    try {
      const result = await exchangeForLongLivedToken(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 3. Page Tokens ───────────────────────────────────────────────────────
  ipcMain.handle('meta-get-page-tokens', async (_event, payload = {}) => {
    try {
      const pages = await getPageAccessTokens(payload)
      return { success: true, pages }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Token Debug ──────────────────────────────────────────────────────────
  ipcMain.handle('meta-debug-token', async (_event, payload = {}) => {
    try {
      const result = await debugToken(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 4. Campaign Pipeline (individual steps) ─────────────────────────────

  ipcMain.handle('meta-upload-ad-image', async (_event, payload = {}) => {
    try {
      const result = await uploadAdImage(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-create-leadgen-form', async (_event, payload = {}) => {
    try {
      const result = await createLeadgenForm(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-create-campaign', async (_event, payload = {}) => {
    try {
      const result = await createCampaign(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-create-adset', async (_event, payload = {}) => {
    try {
      const result = await createAdSet(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-create-ad-creative', async (_event, payload = {}) => {
    try {
      const result = await createAdCreative(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-create-ad', async (_event, payload = {}) => {
    try {
      const result = await createAd(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-activate-campaign', async (_event, payload = {}) => {
    try {
      const result = await activateCampaign(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Pipeline completo (6 pasos en secuencia) ────────────────────────────
  ipcMain.handle('meta-execute-lead-pipeline', async (event, payload = {}) => {
    try {
      const result = await executeLeadCampaignPipeline({
        ...payload,
        onStep: (step, msg) => {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('meta-pipeline-step', { step, message: msg })
          }
        },
      })

      const hasErrors = result.errors.length > 0
      return {
        success: !hasErrors,
        ...result,
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 5. Page Posts ────────────────────────────────────────────────────────
  ipcMain.handle('meta-publish-page-post', async (_event, payload = {}) => {
    try {
      const result = await publishPagePost(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('meta-publish-page-photo', async (_event, payload = {}) => {
    try {
      const result = await publishPagePhoto(payload)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerMetaAuthHandlers }
