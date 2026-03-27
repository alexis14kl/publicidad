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
/**
 * Descarga un archivo desde una URL a disco.
 */
function downloadFile(url, destPath) {
  const fs = require('fs')
  const mod = url.startsWith('https') ? require('https') : require('http')
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(destPath)
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject)
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }).on('error', (err) => {
      fs.unlink(destPath, () => {})
      reject(err)
    })
  })
}

// ── OAuth providers por plataforma ────────────────────────────────────────
const OAUTH_PROVIDERS = {
  facebook: () => require('../oauth/facebook-oauth').startFacebookOAuth(),
  // tiktok: () => require('../oauth/tiktok-oauth').startTikTokOAuth(),
  // linkedin: () => require('../oauth/linkedin-oauth').startLinkedInOAuth(),
}

function registerMetaAuthHandlers(ipcMain) {
  // ── 0. OAuth genérico — despacha al provider correcto ──────────────────
  ipcMain.handle('oauth-start', async (_event, { platform } = {}) => {
    try {
      const provider = OAUTH_PROVIDERS[platform]
      if (!provider) {
        return { success: false, error: `Plataforma OAuth no soportada: ${platform}` }
      }
      return await provider()
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── 0b. Auto-crear empresas desde resultado OAuth ──────────────────────
  ipcMain.handle('oauth-auto-create-accounts', async (_event, { accounts } = {}) => {
    try {
      const { saveCompanyInternal } = require('./company')
      const fs = require('fs')
      const path = require('path')

      if (!Array.isArray(accounts) || accounts.length === 0) {
        return { success: false, error: 'No se recibieron cuentas para crear.' }
      }

      const created = []
      const errors = []
      const logosDir = path.join(require('../config/project-paths').PROJECT_ROOT, 'assets', 'logos')

      for (const account of accounts) {
        try {
          const details = account.details || {}
          const pageName = details.name || account.name || `Pagina ${account.id}`

          // Descargar logo de la pagina si hay picture_url
          let logoPath = ''
          if (details.picture_url) {
            try {
              if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true })
              const logoFile = `page_${account.id}.png`
              const destPath = path.join(logosDir, logoFile)
              await downloadFile(details.picture_url, destPath)
              logoPath = destPath
            } catch { /* logo download failed, continue without */ }
          }

          // Construir payload compatible con saveCompanyInternal
          const platforms = {
            facebook: { enabled: false, syncToConfig: true, accounts: [] },
            instagram: { enabled: false, syncToConfig: true, accounts: [] },
            tiktok: { enabled: false, syncToConfig: true, accounts: [] },
            linkedin: { enabled: false, syncToConfig: true, accounts: [] },
            googleads: { enabled: false, syncToConfig: true, accounts: [] },
          }

          // Facebook account
          if (account.platform === 'facebook') {
            platforms.facebook = {
              enabled: true,
              syncToConfig: true,
              accounts: [{
                account_label: pageName,
                token: account.access_token,
                page_id: account.id,
              }],
            }
          }

          // Instagram auto-link si la pagina tiene IG business
          if (details.instagram && details.instagram.id) {
            platforms.instagram = {
              enabled: true,
              syncToConfig: true,
              accounts: [{
                account_label: details.instagram.username || details.instagram.name || pageName,
                token: account.access_token,
                account_id: details.instagram.id,
              }],
            }
          }

          const savedCompany = saveCompanyInternal({
            nombre: pageName,
            telefono: details.phone || '',
            correo: details.email || '',
            sitio_web: details.website || '',
            descripcion: details.about || '',
            logo: logoPath,
            activo: true,
            platforms,
          })

          created.push(savedCompany)
        } catch (err) {
          errors.push({ account_id: account.id, account_name: account.name, error: err.message })
        }
      }

      return {
        success: true,
        created,
        errors,
        total: accounts.length,
        created_count: created.length,
        error_count: errors.length,
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Backward compat: mantener meta-start-oauth como alias de oauth-start facebook
  ipcMain.handle('meta-start-oauth', async () => {
    try {
      const provider = OAUTH_PROVIDERS.facebook
      return await provider()
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

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
