/**
 * IPC Handlers — TikTok Business API (Marketing/Ads)
 *
 * Canales registrados:
 *   tiktok-biz-exchange-token         → Auth code → access token
 *   tiktok-biz-get-advertisers        → Listar advertiser accounts
 *   tiktok-biz-create-campaign        → Crear campana
 *   tiktok-biz-get-campaigns          → Listar campanas
 *   tiktok-biz-create-adgroup         → Crear ad group
 *   tiktok-biz-create-ad              → Crear anuncio
 *   tiktok-biz-upload-image           → Subir imagen creativa
 *   tiktok-biz-upload-video           → Subir video creativo
 *   tiktok-biz-create-identity        → Crear identidad para ads
 *   tiktok-biz-get-identities         → Listar identidades
 *   tiktok-biz-update-status          → Actualizar estado (campaign/adgroup/ad)
 */

const {
  exchangeBusinessToken,
  getAuthorizedAdvertisers,
  createCampaign,
  getCampaigns,
  createAdGroup,
  createAd,
  uploadAdImage,
  uploadAdVideo,
  createIdentity,
  getIdentities,
  updateStatus,
} = require('../tiktok/tiktok-business-api')
const { getProjectEnv } = require('../utils/env')

function getBusinessCredentials() {
  const env = getProjectEnv()
  return {
    appId: String(env.TIKTOK_BUSINESS_APP_ID || '').trim(),
    appSecret: String(env.TIKTOK_BUSINESS_SECRET || '').trim(),
    accessToken: String(env.TIKTOK_BUSINESS_ACCESS_TOKEN || '').trim(),
    advertiserId: String(env.TIKTOK_BUSINESS_ADVERTISER_ID || '').trim(),
  }
}

function registerTikTokBusinessHandlers(ipcMain) {
  // ── OAuth ──────────────────────────────────────────────────────────────
  ipcMain.handle('tiktok-biz-exchange-token', async (_event, { authCode } = {}) => {
    try {
      const creds = getBusinessCredentials()
      const result = await exchangeBusinessToken({
        appId: creds.appId,
        appSecret: creds.appSecret,
        authCode,
      })
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('tiktok-biz-get-advertisers', async (_event, { accessToken } = {}) => {
    try {
      const creds = getBusinessCredentials()
      const token = accessToken || creds.accessToken
      const advertisers = await getAuthorizedAdvertisers({
        appId: creds.appId,
        appSecret: creds.appSecret,
        accessToken: token,
      })
      return { success: true, advertisers }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Campaigns ──────────────────────────────────────────────────────────
  ipcMain.handle('tiktok-biz-create-campaign', async (_event, payload = {}) => {
    try {
      const creds = getBusinessCredentials()
      const result = await createCampaign({
        accessToken: payload.accessToken || creds.accessToken,
        advertiserId: payload.advertiserId || creds.advertiserId,
        ...payload,
      })
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('tiktok-biz-get-campaigns', async (_event, payload = {}) => {
    try {
      const creds = getBusinessCredentials()
      const result = await getCampaigns({
        accessToken: payload.accessToken || creds.accessToken,
        advertiserId: payload.advertiserId || creds.advertiserId,
        ...payload,
      })
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Ad Groups ──────────────────────────────────────────────────────────
  ipcMain.handle('tiktok-biz-create-adgroup', async (_event, payload = {}) => {
    try {
      const creds = getBusinessCredentials()
      const result = await createAdGroup({
        accessToken: payload.accessToken || creds.accessToken,
        advertiserId: payload.advertiserId || creds.advertiserId,
        ...payload,
      })
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Ads ────────────────────────────────────────────────────────────────
  ipcMain.handle('tiktok-biz-create-ad', async (_event, payload = {}) => {
    try {
      const creds = getBusinessCredentials()
      const result = await createAd({
        accessToken: payload.accessToken || creds.accessToken,
        advertiserId: payload.advertiserId || creds.advertiserId,
        ...payload,
      })
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Creative Upload ────────────────────────────────────────────────────
  ipcMain.handle('tiktok-biz-upload-image', async (_event, payload = {}) => {
    try {
      const creds = getBusinessCredentials()
      const result = await uploadAdImage({
        accessToken: payload.accessToken || creds.accessToken,
        advertiserId: payload.advertiserId || creds.advertiserId,
        ...payload,
      })
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('tiktok-biz-upload-video', async (_event, payload = {}) => {
    try {
      const creds = getBusinessCredentials()
      const result = await uploadAdVideo({
        accessToken: payload.accessToken || creds.accessToken,
        advertiserId: payload.advertiserId || creds.advertiserId,
        ...payload,
      })
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Identity ───────────────────────────────────────────────────────────
  ipcMain.handle('tiktok-biz-create-identity', async (_event, payload = {}) => {
    try {
      const creds = getBusinessCredentials()
      const result = await createIdentity({
        accessToken: payload.accessToken || creds.accessToken,
        advertiserId: payload.advertiserId || creds.advertiserId,
        ...payload,
      })
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('tiktok-biz-get-identities', async (_event, payload = {}) => {
    try {
      const creds = getBusinessCredentials()
      const result = await getIdentities({
        accessToken: payload.accessToken || creds.accessToken,
        advertiserId: payload.advertiserId || creds.advertiserId,
      })
      return { success: true, identities: result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Status Updates ─────────────────────────────────────────────────────
  ipcMain.handle('tiktok-biz-update-status', async (_event, payload = {}) => {
    try {
      const creds = getBusinessCredentials()
      await updateStatus({
        accessToken: payload.accessToken || creds.accessToken,
        advertiserId: payload.advertiserId || creds.advertiserId,
        ...payload,
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerTikTokBusinessHandlers }
